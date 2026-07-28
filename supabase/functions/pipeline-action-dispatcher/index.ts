// Stage-driven action dispatcher (cron, every 5 min).
// Processes public.pipeline_action_queue rows — but ONLY inside each org's
// saved calling window (organization_settings.calling_windows, read live so it
// stays configurable). Fires AI calls (Bolna) and WhatsApp templates (Exotel),
// and records the disposition. WhatsApp delivery/read progress is reflected by
// the whatsapp-webhook updating whatsapp_messages.status.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  isInsideCustomWindow,
  normalizePhone,
  WindowSlot,
} from "../_shared/aiCalling.ts";
import { orgServiceGate } from "../_shared/billingGate.ts";
import {
  WA_SENDER_BY_ORG,
  sendWhatsAppTemplate as sharedSendWhatsAppTemplate,
  triggerCall,
} from "../_shared/pipelineActions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many of each action to fire per org per tick.
// WhatsApp sends run with bounded concurrency (WA_SEND_CONCURRENCY) so a tick can
// push a large batch quickly without exceeding the function's wall-clock limit.
// Spend is still hard-capped by the per-message floor-guarded reserve, never by this.
const MAX_WA_PER_TICK = 150;
const WA_SEND_CONCURRENCY = 12;
const WHATSAPP_UTILITY_COST_PER_MSG = 0.20;

// Run an async fn over items with bounded concurrency, preserving result order.
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
function callConcurrency(): number {
  const v = parseInt(Deno.env.get("PIPELINE_CALL_CONCURRENCY") ?? "3", 10);
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 20) : 3;
}

interface QueueRow {
  id: string;
  org_id: string;
  contact_id: string;
  stage_id: string;
  action_type: "call" | "whatsapp";
  template_name: string | null;
  language_code: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending } = await supabase
    .from("pipeline_action_queue")
    .select("org_id")
    .eq("status", "pending");

  const orgIds = [...new Set((pending || []).map((r: any) => r.org_id as string))];
  if (orgIds.length === 0) {
    return done(200, { ok: true, acted: false, reason: "nothing pending" });
  }

  const results: unknown[] = [];
  for (const orgId of orgIds) {
    results.push(await processOrg(supabase, orgId));
  }
  return done(200, { ok: true, results });
});

async function processOrg(supabase: any, orgId: string): Promise<unknown> {
  // Window is read live from the saved org setting — fully configurable.
  const { data: os } = await supabase
    .from("organization_settings")
    .select("calling_windows, act_today_only, enforce_wallet_in_trial, dialing_active")
    .eq("org_id", orgId)
    .maybeSingle();

  // Window is computed but NOT an early exit: stages flagged ignore_window (e.g.
  // inbound demo-request qualify calls) must fire regardless of the cold-calling
  // window. Out-of-window filtering happens after the queue is loaded.
  const win = isInsideCustomWindow(os?.calling_windows as WindowSlot[] | null);

  // No money, no service: stop all sends when an external org is locked for
  // non-payment or its wallet has hit the ₹500 reserve — trial included.
  // Internal/demo orgs are exempt (handled inside the gate).
  const gate = await orgServiceGate(supabase, orgId);
  if (!gate.allowed) {
    return { org_id: orgId, acted: false, reason: gate.reason };
  }

  // Self-heal: release rows a crashed tick left mid-claim (status 'processing' but
  // never finished) back to 'pending' so they retry. 10 min > any real tick.
  await supabase
    .from("pipeline_action_queue")
    .update({ status: "pending", processed_at: null })
    .eq("org_id", orgId)
    .eq("status", "processing")
    .lt("processed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const todayOnly = !!os?.act_today_only;
  const istTodayStart = todayOnly ? istStartOfTodayMs() : 0;

  const { data: rows } = await supabase
    .from("pipeline_action_queue")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  const queue = (rows || []) as QueueRow[];
  if (queue.length === 0) {
    return { org_id: orgId, acted: false, reason: "nothing pending in window" };
  }

  // Pre-fetch the contacts referenced by this batch.
  const contactIds = [...new Set(queue.map((r) => r.contact_id))];
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, name_hi, company, job_title, phone, do_not_call, created_at, team_size, preferred_demo_date, preferred_demo_time")
    .in("id", contactIds);
  const contactById = new Map<string, any>((contactRows || []).map((c: any) => [c.id, c]));

  let waSent = 0, waFailed = 0, callsTriggered = 0, skipped = 0;

  // Today-only: when the org opts in (IEDUP), drop (and mark skipped) any queued
  // action whose contact was uploaded before today (IST), so automation only ever
  // acts on the day's data.
  let activeQueue = queue;
  if (todayOnly) {
    const keep: QueueRow[] = [];
    for (const r of queue) {
      const c = contactById.get(r.contact_id);
      const createdMs = c?.created_at ? Date.parse(c.created_at) : 0;
      if (createdMs >= istTodayStart) {
        keep.push(r);
      } else {
        await markQueue(supabase, r.id, "skipped", "past-day data (act_today_only)");
        skipped++;
      }
    }
    activeQueue = keep;
  }

  // Calling window: outside the window, only stages flagged ignore_window (the
  // inbound demo-request qualify call) run now; everything else stays pending
  // for the next in-window tick. Inside the window, all rows run.
  // WhatsApp is never gated by this — the window (incl. the Sunday no-call rule)
  // exists to avoid ringing someone's phone off-hours; it doesn't apply to a
  // WhatsApp message, so those rows always pass through untouched.
  if (!win.inside) {
    const { data: exempt } = await supabase
      .from("pipeline_stage_actions")
      .select("stage_id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .eq("ignore_window", true);
    const exemptStages = new Set<string>((exempt || []).map((e: any) => e.stage_id));
    activeQueue = activeQueue.filter((r) => r.action_type === "whatsapp" || exemptStages.has(r.stage_id));
    if (activeQueue.length === 0) {
      return { org_id: orgId, acted: false, reason: win.reason };
    }
  }

  // ---- WhatsApp -------------------------------------------------------------
  // Charge-before-send: each message RESERVES its cost from the wallet first, via
  // an atomic floor-guarded debit (reserve_wallet_funds) — so the balance can never
  // dip below the org's minimum even though many sends share one wallet and the
  // gate only checks the balance once per tick. If the send then fails, the
  // reserved amount is credited straight back. When the wallet can't fund the next
  // message without breaching the floor, the reserve is refused: stop and leave the
  // rest pending until the client tops up (wallet-alert-check reminds them).
  // Internal/demo orgs have no floor on the gate → never blocked.
  const waRows = activeQueue.filter((r) => r.action_type === "whatsapp").slice(0, MAX_WA_PER_TICK);
  // Pre-check funds ONCE per tick: if the wallet can't cover even the cheapest
  // message above the floor, skip WhatsApp entirely. Without this, a wallet sitting
  // at its floor would still claim + log + fail 150 rows every cron tick forever.
  const floor = typeof gate.floor === "number" ? gate.floor : null;
  const canAffordWa = floor === null || typeof gate.balance !== "number" ||
    (gate.balance - floor) >= WHATSAPP_UTILITY_COST_PER_MSG;
  if (waRows.length > 0 && canAffordWa) {
    const sender = WA_SENDER_BY_ORG[orgId] || Deno.env.get("EXOTEL_SENDER_NUMBER") || "";
    // Send concurrently (bounded) for throughput. Each row is independently claimed
    // (atomic pending→processing CAS) and charged (atomic floor-guarded reserve), so
    // parallel sends — and a concurrent cron tick — can never double-send or push the
    // wallet below the floor. A row that can't be funded is released back to pending.
    const outcomes = await mapPool(waRows, WA_SEND_CONCURRENCY, async (r) => {
      const { data: claimed } = await supabase
        .from("pipeline_action_queue")
        .update({ status: "processing", processed_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) return "raced"; // another runner already took this row
      const contact = contactById.get(r.contact_id);
      const phone = normalizePhone(contact?.phone);
      if (!contact || !phone || !r.template_name) {
        await markQueue(supabase, r.id, "skipped", "missing phone/template");
        return "skipped";
      }
      const res = await sharedSendWhatsAppTemplate(supabase, {
        orgId, sender, contact, phone,
        templateName: r.template_name || "",
        languageCode: r.language_code,
        floor,
      });
      if (res.ok) { await markQueue(supabase, r.id, "sent", null); return "sent"; }
      if (res.insufficientFunds) {
        // Wallet at floor — release the claim so it retries after the client tops up.
        await supabase.from("pipeline_action_queue").update({ status: "pending" }).eq("id", r.id);
        return "nofunds";
      }
      await markQueue(supabase, r.id, "failed", res.error);
      return "failed";
    });
    waSent = outcomes.filter((o) => o === "sent").length;
    waFailed = outcomes.filter((o) => o === "failed").length;
    skipped += outcomes.filter((o) => o === "skipped").length;
  }

  // ---- Calls (concurrency-capped) ------------------------------------------
  // AI-call kill switch: when an org's dialing is explicitly paused
  // (organization_settings.dialing_active = false), defer ALL pipeline call
  // actions — leave the rows pending so they fire automatically once dialing is
  // re-enabled. Only orgs with the flag explicitly false are affected; orgs that
  // never set it (null) behave exactly as before. WhatsApp actions are untouched.
  const callsPaused = os?.dialing_active === false;
  const callRows = callsPaused
    ? []
    : activeQueue.filter((r) => r.action_type === "call");
  if (callRows.length > 0) {
    const bolnaKey = Deno.env.get("BOLNA_API_KEY");
    const { data: script } = await supabase
      .from("ai_call_scripts")
      .select("id, bolna_agent_id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .not("bolna_agent_id", "is", null)
      .limit(1)
      .maybeSingle();
    const { data: dispo } = await supabase
      .from("call_dispositions")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", "Call made")
      .eq("is_active", true)
      .maybeSingle();

    // Per-stage dedicated agent/caller-id (e.g. the WorkSync demo-confirm agent
    // on the "Demo Requested" stage). Falls back to the org's default script.
    const { data: stageActs } = await supabase
      .from("pipeline_stage_actions")
      .select("stage_id, agent_id, from_number")
      .eq("org_id", orgId)
      .eq("action_type", "call")
      .eq("is_active", true)
      .not("agent_id", "is", null);
    const agentByStage = new Map<string, { agent: string; from: string | null }>(
      (stageActs || []).map((a: any) => [a.stage_id, { agent: a.agent_id, from: a.from_number }]),
    );

    if (!bolnaKey || (!script?.bolna_agent_id && agentByStage.size === 0)) {
      for (const r of callRows) { await markQueue(supabase, r.id, "failed", "no Bolna key/agent for org"); }
    } else {
      // Cap total in-flight calls for the org.
      const { count: inFlight } = await supabase
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("caller_type", "ai")
        .eq("status", "in_progress");
      const slots = Math.max(0, callConcurrency() - (inFlight || 0));
      const candidateRows = callRows.slice(0, slots);

      // Idempotency guard against duplicate dialing: a contact can be enqueued
      // more than once (re-upload, repeated stage change), and a freshly-queued
      // call has no started_at yet — so without this guard the same person gets
      // dialed twice. Skip any contact that already has an AI call TODAY (IST) or
      // one currently queued/in-flight. Keys on the call_logs row existing, not on
      // started_at, so it is race-proof across 5-min ticks. (Next-day retries are
      // unaffected — only same-day repeats are blocked.)
      const candidateContactIds = [...new Set(candidateRows.map((r) => r.contact_id))];
      const alreadyCalled = new Set<string>();
      if (candidateContactIds.length > 0) {
        const todayStartIso = new Date(istStartOfTodayMs()).toISOString();
        const { data: priorCalls } = await supabase
          .from("call_logs")
          .select("contact_id")
          .eq("org_id", orgId)
          .eq("caller_type", "ai")
          .in("contact_id", candidateContactIds)
          .or(`created_at.gte.${todayStartIso},status.in.(queued,in_progress)`);
        for (const c of (priorCalls || [])) {
          if (c.contact_id) alreadyCalled.add(c.contact_id as string);
        }
      }

      const seenThisTick = new Set<string>();
      for (const r of candidateRows) {
        const contact = contactById.get(r.contact_id);
        const phone = normalizePhone(contact?.phone);
        if (!contact || !phone || contact.do_not_call) {
          await markQueue(supabase, r.id, "skipped", contact?.do_not_call ? "do_not_call" : "missing phone");
          skipped++;
          continue;
        }
        // Already dialed today / in-flight, or a duplicate queue row this tick.
        if (alreadyCalled.has(r.contact_id) || seenThisTick.has(r.contact_id)) {
          await markQueue(supabase, r.id, "skipped", "duplicate — already called today / in progress");
          skipped++;
          continue;
        }
        seenThisTick.add(r.contact_id);
        const stageAgent = agentByStage.get(r.stage_id);
        const agentId = stageAgent?.agent || script?.bolna_agent_id;
        if (!agentId) {
          await markQueue(supabase, r.id, "failed", "no agent for stage/org");
          skipped++;
          continue;
        }
        const res = await triggerCall(supabase, {
          orgId, bolnaKey, agentId, scriptId: script?.id ?? null,
          fromNumber: stageAgent?.from ?? null,
          dispositionId: dispo?.id ?? null, contact, phone,
        });
        if (res.ok) { await markQueue(supabase, r.id, "sent", null); callsTriggered++; }
        else { await markQueue(supabase, r.id, "failed", res.error); }
      }
      // remaining call rows stay pending for the next tick
    }
  }

  return {
    org_id: orgId, acted: true, window: win.reason,
    wa_sent: waSent, wa_failed: waFailed, calls_triggered: callsTriggered, skipped,
  };
}

async function markQueue(supabase: any, id: string, status: string, error: string | null) {
  await supabase
    .from("pipeline_action_queue")
    .update({ status, last_error: error, processed_at: new Date().toISOString(), attempts: 1 })
    .eq("id", id);
}

// UTC epoch-ms for the start of "today" in IST (UTC+5:30).
function istStartOfTodayMs(now: Date = new Date()): number {
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  const istMidnight = Math.floor((now.getTime() + offsetMs) / 86400000) * 86400000;
  return istMidnight - offsetMs;
}

function done(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
