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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per-org Exotel WhatsApp sender (WABA from-number). Mirrors the IEDUP override
// used by the post-call WA auto-send in ai-bolna-webhook.
const WA_SENDER_BY_ORG: Record<string, string> = {
  "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": "+918808359820", // IEDUP
};

// How many of each action to fire per org per tick.
// WhatsApp sends run with bounded concurrency (WA_SEND_CONCURRENCY) so a tick can
// push a large batch quickly without exceeding the function's wall-clock limit.
// Spend is still hard-capped by the per-message floor-guarded reserve, never by this.
const MAX_WA_PER_TICK = 150;
const WA_SEND_CONCURRENCY = 12;
// Exotel WhatsApp price per message (₹). Utility = ₹0.20, Marketing = ₹1.00.
const WHATSAPP_UTILITY_COST_PER_MSG = 0.20;
const WHATSAPP_MARKETING_COST_PER_MSG = 1.00;
// Templates Meta classifies as MARKETING (charged at the marketing rate).
// Kept empty by policy: IEDUP now runs UTILITY-only templates (the old MARKETING
// versions — registration_steps_v2, training_helpdesk_v2, training_link_v4 —
// have been retired/deleted in favour of their utility v3/v5/v6 replacements).
const MARKETING_TEMPLATES = new Set<string>([]);
function waCostFor(templateName: string | null): number {
  return templateName && MARKETING_TEMPLATES.has(templateName)
    ? WHATSAPP_MARKETING_COST_PER_MSG
    : WHATSAPP_UTILITY_COST_PER_MSG;
}

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
  if (!win.inside) {
    const { data: exempt } = await supabase
      .from("pipeline_stage_actions")
      .select("stage_id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .eq("ignore_window", true);
    const exemptStages = new Set<string>((exempt || []).map((e: any) => e.stage_id));
    activeQueue = activeQueue.filter((r) => exemptStages.has(r.stage_id));
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
      const res = await sendWhatsAppTemplate(supabase, { orgId, sender, contact, phone, row: r, floor });
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

// ---- WhatsApp send ----------------------------------------------------------
// Logs to whatsapp_logs (the billing/usage table the IEDUP dashboard reads and
// the DLR webhook advances) and charges the wallet — same path as the post-call
// sender. Recipient is digits-with-country-code, no '+', as that path proved out.
async function sendWhatsAppTemplate(
  supabase: any,
  args: { orgId: string; sender: string; contact: any; phone: string; row: QueueRow; floor: number | null },
): Promise<{ ok: boolean; error?: string; insufficientFunds?: boolean }> {
  const { orgId, sender, contact, phone, row, floor } = args;
  const apiKey = Deno.env.get("EXOTEL_API_KEY");
  const apiToken = Deno.env.get("EXOTEL_API_TOKEN");
  const sid = Deno.env.get("EXOTEL_SID");
  const subdomain = Deno.env.get("EXOTEL_SUBDOMAIN") || "api.exotel.com";
  if (!apiKey || !apiToken || !sid || !sender) {
    return { ok: false, error: "Exotel WA creds/sender not configured" };
  }

  const cleanTo = phone.replace(/^\+/, "").replace(/^0+/, "");

  // Only the help-desk template carries a {{1}} name variable; the rest are generic.
  // Match by prefix so the name is filled across help-desk versions (v1, v2, …).
  const name = contact.name_hi || contact.first_name || "प्रतिभागी";
  const params: string[] = (row.template_name || "").startsWith("iedup_cmyuva_training_helpdesk") ? [name] : [];
  const components = params.length > 0
    ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }]
    : [];

  // Pre-insert a queued row so the dashboard sees the attempt immediately.
  const { data: waLogRow } = await supabase
    .from("whatsapp_logs")
    .insert({
      org_id: orgId,
      contact_id: row.contact_id,
      to_number: cleanTo,
      template_name: row.template_name,
      language_code: row.language_code || "hi",
      body_params: params,
      status: "queued",
    })
    .select("id")
    .single();
  const waLogId = waLogRow?.id as string | undefined;

  // Charge BEFORE sending: atomically reserve the message cost from the wallet,
  // refusing if it would breach the org's floor. Refunded below if the send fails.
  const cost = waCostFor(row.template_name);
  const category = MARKETING_TEMPLATES.has(row.template_name || "") ? "marketing" : "utility";
  if (waLogId) {
    const reserved = await reserveFunds(supabase, {
      orgId, serviceType: "whatsapp", referenceId: waLogId, quantity: 1, cost, floor,
      description: `WhatsApp ${category} template ${row.template_name} → ${cleanTo}`,
    });
    if (!reserved.ok) {
      await supabase.from("whatsapp_logs")
        .update({ status: "failed", failed_at: new Date().toISOString(), error_text: "insufficient wallet balance (floor)" })
        .eq("id", waLogId);
      return { ok: false, error: "insufficient wallet balance", insufficientFunds: true };
    }
  }

  const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
  const payload = {
    custom_data: row.contact_id,
    status_callback: callbackUrl,
    whatsapp: {
      messages: [{
        from: sender,
        to: cleanTo,
        content: {
          type: "template",
          template: {
            name: row.template_name,
            language: { code: row.language_code || "hi" },
            ...(components.length > 0 ? { components } : {}),
          },
        },
      }],
    },
  };

  const auth = btoa(`${apiKey}:${apiToken}`);
  let respText = "";
  let httpOk = false;
  try {
    const resp = await fetch(`https://${subdomain}/v2/accounts/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(payload),
    });
    respText = await resp.text();
    httpOk = resp.ok;
  } catch (e: any) {
    if (waLogId) {
      await refundFunds(supabase, { orgId, serviceType: "whatsapp", referenceId: waLogId, cost, description: `Refund — WhatsApp send failed (${row.template_name})` });
      await supabase.from("whatsapp_logs")
        .update({ status: "failed", failed_at: new Date().toISOString(), error_text: `fetch failed: ${String(e?.message || e)}` })
        .eq("id", waLogId);
    }
    return { ok: false, error: `fetch failed: ${e?.message || e}` };
  }

  let exoSid: string | null = null;
  try {
    const j = JSON.parse(respText);
    const msgResp = j?.response?.whatsapp?.messages?.[0];
    exoSid = msgResp?.data?.sid || null;
    httpOk = httpOk && (msgResp?.code === 200 || msgResp?.code === 202);
  } catch { /* keep raw */ }

  if (httpOk && waLogId) {
    // Already charged at reserve time — just mark the log sent.
    await supabase.from("whatsapp_logs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        exotel_msg_sid: exoSid,
        cost_charged: cost,
      })
      .eq("id", waLogId);
    return { ok: true };
  }

  if (waLogId) {
    await refundFunds(supabase, { orgId, serviceType: "whatsapp", referenceId: waLogId, cost, description: `Refund — WhatsApp send failed (${row.template_name})` });
    await supabase.from("whatsapp_logs")
      .update({ status: "failed", failed_at: new Date().toISOString(), error_text: respText.slice(0, 500) })
      .eq("id", waLogId);
  }
  return { ok: false, error: respText.slice(0, 300) };
}

// Reserve (charge) funds BEFORE sending. Atomically debits the wallet via the
// reserve_wallet_funds RPC, which only succeeds if balance − cost stays at/above
// the org's floor (passing null floor = unlimited, for internal/demo orgs). On
// success, writes the deduction ledger + usage row so the dashboard reflects the
// charge. Idempotent on (service_type, reference_id): a retry for the same message
// is a no-op success. Returns { ok:false } when the wallet can't fund it.
async function reserveFunds(
  supabase: any,
  args: { orgId: string; serviceType: "call" | "whatsapp" | "email"; referenceId: string; quantity: number; cost: number; floor: number | null; description: string },
): Promise<{ ok: boolean; balanceAfter?: number }> {
  try {
    const { data: existing } = await supabase
      .from("service_usage_logs")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("service_type", args.serviceType)
      .eq("reference_id", args.referenceId)
      .maybeSingle();
    if (existing) return { ok: true }; // already charged

    // Atomic, floor-guarded debit. NULL floor → effectively unlimited (internal orgs).
    const effectiveFloor = args.floor ?? -1e15;
    const { data: newBal, error } = await supabase.rpc("reserve_wallet_funds", {
      p_org: args.orgId, p_amount: args.cost, p_floor: effectiveFloor,
    });
    if (error) { console.error("reserve_wallet_funds error:", error.message); return { ok: false }; }
    if (newBal === null || newBal === undefined) return { ok: false }; // insufficient — would breach floor

    const balanceAfter = Number(newBal);
    const balanceBefore = balanceAfter + args.cost;
    const { data: walletTxn } = await supabase
      .from("wallet_transactions")
      .insert({
        org_id: args.orgId,
        transaction_type: `deduction_${args.serviceType}`,
        amount: -args.cost,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reference_id: args.referenceId,
        reference_type: args.serviceType,
        quantity: args.quantity,
        unit_cost: args.cost / Math.max(1, args.quantity),
        description: args.description,
      })
      .select("id")
      .single();
    await supabase.from("service_usage_logs")
      .insert({ org_id: args.orgId, service_type: args.serviceType, reference_id: args.referenceId, quantity: args.quantity, cost: args.cost, wallet_deducted: true, wallet_transaction_id: walletTxn?.id });
    return { ok: true, balanceAfter };
  } catch (e) {
    console.error("reserveFunds exception:", String(e));
    return { ok: false };
  }
}

// Credit a previously-reserved charge back when the send fails. Atomic increment
// via credit_wallet_funds, plus a refund ledger row, and removes the usage row so
// the reserve becomes re-chargeable (and so reporting doesn't count a sent message
// that never went out). Idempotent: if the usage row is already gone, does nothing.
async function refundFunds(
  supabase: any,
  args: { orgId: string; serviceType: "call" | "whatsapp" | "email"; referenceId: string; cost: number; description: string },
): Promise<void> {
  try {
    const { data: usage } = await supabase
      .from("service_usage_logs")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("service_type", args.serviceType)
      .eq("reference_id", args.referenceId)
      .maybeSingle();
    if (!usage) return; // nothing was charged (or already refunded)

    const { data: newBal, error } = await supabase.rpc("credit_wallet_funds", {
      p_org: args.orgId, p_amount: args.cost,
    });
    if (error) { console.error("credit_wallet_funds error:", error.message); return; }
    const balanceAfter = Number(newBal ?? 0);
    const balanceBefore = balanceAfter - args.cost;
    await supabase.from("wallet_transactions").insert({
      org_id: args.orgId,
      transaction_type: `refund_${args.serviceType}`,
      amount: args.cost,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reference_id: args.referenceId,
      reference_type: args.serviceType,
      quantity: 1,
      unit_cost: args.cost,
      description: args.description,
    });
    await supabase.from("service_usage_logs").delete().eq("id", usage.id);
  } catch (e) {
    console.error("refundFunds exception:", String(e));
  }
}

// ---- AI call trigger --------------------------------------------------------
async function triggerCall(
  supabase: any,
  args: {
    orgId: string; bolnaKey: string; agentId: string; scriptId: string | null;
    fromNumber?: string | null; dispositionId: string | null; contact: any; phone: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { orgId, bolnaKey, agentId, scriptId, dispositionId, contact, phone } = args;
  const fromNumber = args.fromNumber || "+911169323462";

  const { data: inserted, error: insErr } = await supabase
    .from("call_logs")
    .insert({
      org_id: orgId,
      caller_type: "ai",
      ai_script_id: scriptId,
      contact_id: contact.id,
      status: "queued",
      call_type: "outbound",
      direction: "outbound",
      from_number: fromNumber,
      to_number: phone,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !inserted) return { ok: false, error: `call_logs insert: ${insErr?.message || "unknown"}` };

  // Call Bolna directly (not the shared helper) so we can also pass the demo
  // preferences captured on the form — the agent confirms them instead of asking.
  const firstNameForBolna = contact.name_hi || contact.first_name || "";
  const userData: Record<string, unknown> = {
    contact_id: contact.id,
    call_log_id: inserted.id,
    first_name: firstNameForBolna,
    last_name: contact.last_name ?? "",
    company: contact.company ?? "your company",
    job_title: contact.job_title ?? "",
    team_size: contact.team_size ?? "",
    preferred_date: contact.preferred_demo_date ?? "",
    preferred_time: contact.preferred_demo_time ?? "",
  };
  let result: { execution_id?: string; error?: string };
  try {
    const br = await fetch("https://api.bolna.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${bolnaKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, recipient_phone_number: phone, from_phone_number: fromNumber, user_data: userData }),
    });
    const bt = await br.text();
    let bj: Record<string, unknown> = {};
    try { bj = JSON.parse(bt); } catch { /* keep raw */ }
    const execId = (bj.execution_id as string) || (bj.run_id as string);
    result = br.ok && execId ? { execution_id: execId } : { error: `${br.status}: ${bt.slice(0, 200)}` };
  } catch (e) {
    result = { error: String(e) };
  }

  if (result.error) {
    await supabase.from("call_logs").update({ status: "error", notes: result.error }).eq("id", inserted.id);
    return { ok: false, error: result.error };
  }

  // "Call made" the moment the call is placed.
  await supabase
    .from("call_logs")
    .update({
      status: "in_progress",
      bolna_execution_id: result.execution_id,
      started_at: new Date().toISOString(),
      ...(dispositionId ? { disposition_id: dispositionId } : {}),
    })
    .eq("id", inserted.id);

  return { ok: true };
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
