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
  triggerBolnaCall,
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
const MAX_WA_PER_TICK = 25;
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
    .select("calling_windows, act_today_only, enforce_wallet_in_trial")
    .eq("org_id", orgId)
    .maybeSingle();

  const win = isInsideCustomWindow(os?.calling_windows as WindowSlot[] | null);
  if (!win.inside) {
    return { org_id: orgId, acted: false, reason: win.reason };
  }

  // No money, no service: stop all sends when an external org is locked for
  // non-payment or its wallet has hit the ₹500 reserve — trial included.
  // Internal/demo orgs are exempt (handled inside the gate).
  const gate = await orgServiceGate(supabase, orgId);
  if (!gate.allowed) {
    return { org_id: orgId, acted: false, reason: gate.reason };
  }

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
    .select("id, first_name, last_name, name_hi, company, job_title, phone, do_not_call, created_at")
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

  // ---- WhatsApp -------------------------------------------------------------
  const waRows = activeQueue.filter((r) => r.action_type === "whatsapp").slice(0, MAX_WA_PER_TICK);
  if (waRows.length > 0) {
    const sender = WA_SENDER_BY_ORG[orgId] || Deno.env.get("EXOTEL_SENDER_NUMBER") || "";
    for (const r of waRows) {
      const contact = contactById.get(r.contact_id);
      const phone = normalizePhone(contact?.phone);
      if (!contact || !phone || !r.template_name) {
        await markQueue(supabase, r.id, "skipped", "missing phone/template");
        skipped++;
        continue;
      }
      const res = await sendWhatsAppTemplate(supabase, { orgId, sender, contact, phone, row: r });
      if (res.ok) { await markQueue(supabase, r.id, "sent", null); waSent++; }
      else { await markQueue(supabase, r.id, "failed", res.error); waFailed++; }
    }
  }

  // ---- Calls (concurrency-capped) ------------------------------------------
  const callRows = activeQueue.filter((r) => r.action_type === "call");
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
  args: { orgId: string; sender: string; contact: any; phone: string; row: QueueRow },
): Promise<{ ok: boolean; error?: string }> {
  const { orgId, sender, contact, phone, row } = args;
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
    const cost = waCostFor(row.template_name);
    const category = MARKETING_TEMPLATES.has(row.template_name || "") ? "marketing" : "utility";
    await supabase.from("whatsapp_logs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        exotel_msg_sid: exoSid,
        cost_charged: cost,
      })
      .eq("id", waLogId);
    await recordUsage(supabase, {
      orgId,
      serviceType: "whatsapp",
      referenceId: waLogId,
      quantity: 1,
      cost,
      description: `WhatsApp ${category} template ${row.template_name} → ${cleanTo}`,
    });
    return { ok: true };
  }

  if (waLogId) {
    await supabase.from("whatsapp_logs")
      .update({ status: "failed", failed_at: new Date().toISOString(), error_text: respText.slice(0, 500) })
      .eq("id", waLogId);
  }
  return { ok: false, error: respText.slice(0, 300) };
}

// Records a usage row and atomically decrements the org's wallet. Idempotent on
// (service_type, reference_id). Mirrors recordUsage in ai-bolna-webhook.
async function recordUsage(
  supabase: any,
  args: { orgId: string; serviceType: "call" | "whatsapp" | "email"; referenceId: string; quantity: number; cost: number; description: string },
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("service_usage_logs")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("service_type", args.serviceType)
      .eq("reference_id", args.referenceId)
      .maybeSingle();
    if (existing) return;

    const { data: usageRow } = await supabase
      .from("service_usage_logs")
      .insert({ org_id: args.orgId, service_type: args.serviceType, reference_id: args.referenceId, quantity: args.quantity, cost: args.cost, wallet_deducted: false })
      .select("id")
      .single();
    if (!usageRow) return;

    const { data: sub } = await supabase
      .from("organization_subscriptions")
      .select("wallet_balance")
      .eq("org_id", args.orgId)
      .maybeSingle();
    if (!sub) return;

    const balanceBefore = Number(sub.wallet_balance || 0);
    const balanceAfter = balanceBefore - args.cost;

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

    await supabase.from("organization_subscriptions")
      .update({ wallet_balance: balanceAfter, updated_at: new Date().toISOString() })
      .eq("org_id", args.orgId);
    await supabase.from("service_usage_logs")
      .update({ wallet_deducted: true, wallet_transaction_id: walletTxn?.id })
      .eq("id", usageRow.id);
  } catch (e) {
    console.error("recordUsage exception:", String(e));
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

  const result = await triggerBolnaCall(bolnaKey, {
    agentId,
    toNumber: phone,
    fromNumber,
    callLogId: inserted.id,
    contact: {
      id: contact.id,
      first_name: contact.first_name,
      last_name: contact.last_name,
      name_hi: contact.name_hi,
      company: contact.company,
      job_title: contact.job_title,
    },
  });

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
