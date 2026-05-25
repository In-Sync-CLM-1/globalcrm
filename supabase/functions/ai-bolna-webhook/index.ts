import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  isInsideWorkingWindow,
  triggerBolnaCall,
  BILLABLE_CALL_ORG_IDS,
} from "../_shared/aiCalling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TERMINAL_STATUSES = new Set([
  "completed", "failed", "no-answer", "busy", "canceled",
  "stopped", "balance-low", "error", "call-disconnected",
]);

// Pricing — keep in sync with subscription_pricing active row. Per-minute call,
// per-message WhatsApp utility. These are charged via service_usage_logs and a
// wallet_balance decrement on organization_subscriptions.
const CALL_COST_PER_MINUTE = 3.0;
const WHATSAPP_UTILITY_COST_PER_MSG = 0.20;

// Org-specific post-call WhatsApp template config.
// from_number overrides the default EXOTEL_SENDER_NUMBER env when set —
// used when an org has its own WhatsApp sender on the same WABA.
const POST_CALL_WA_BY_ORG: Record<string, {
  template_name: string;
  language_code: string;
  from_number?: string;
  body_params: (ctx: { firstName: string }) => string[];
}> = {
  "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": {
    template_name: "iedup_cmyuva_training_link_v2",
    language_code: "hi",
    from_number: "+918808359820",
    body_params: ({ firstName }) => [firstName],
  },
};

const POST_CALL_WA_DELAY_MS = 5000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return json200({ ok: false, error: "invalid json" });
  }

  const status = (payload.status as string) || "unknown";
  const executionId = (payload.execution_id as string) || (payload.id as string) || null;
  const telephony = (payload.telephony_data as Record<string, unknown>) || {};
  const contextDetails = (payload.context_details as Record<string, unknown>) || {};
  const callLogIdFromContext = contextDetails?.call_log_id as string | undefined;

  if (!executionId) return json200({ ok: true, warning: "missing execution_id" });

  // Find the call_logs row
  const callLogSelect = "id, batch_id_proxy:bolna_batch_id, queue_position:bolna_queue_position, status, org_id, contact_id, started_at, customer_message_sent_at";
  let callLog: any = null;
  {
    const { data } = await supabase
      .from("call_logs")
      .select(callLogSelect)
      .eq("bolna_execution_id", executionId)
      .maybeSingle();
    callLog = data;
  }
  if (!callLog && callLogIdFromContext) {
    const { data } = await supabase
      .from("call_logs")
      .select(callLogSelect)
      .eq("id", callLogIdFromContext)
      .maybeSingle();
    callLog = data;
    if (callLog) {
      await supabase
        .from("call_logs")
        .update({ bolna_execution_id: executionId })
        .eq("id", callLog.id);
    }
  }

  if (!callLog) return json200({ ok: true, warning: "unknown execution" });

  const isTerminal = TERMINAL_STATUSES.has(status);
  const durationSec = telephony.duration != null ? Number(telephony.duration) : null;
  const recordingUrl = (telephony.recording_url as string) || null;
  const providerCallSid = (telephony.provider_call_id as string) || null;
  const transcript = (payload.transcript as string) || null;

  let normalizedStatus = status;
  if (status === "in-progress" || status === "ringing" || status === "initiated") {
    normalizedStatus = "in_progress";
  } else if (status === "call-disconnected") {
    normalizedStatus = "completed";
  }

  const update: Record<string, unknown> = { status: normalizedStatus };
  if (durationSec != null) {
    update.call_duration = durationSec;
    update.conversation_duration = durationSec;
  }
  if (recordingUrl) update.recording_url = recordingUrl;
  if (providerCallSid) update.exotel_call_sid = providerCallSid;
  if (isTerminal) update.ended_at = new Date().toISOString();
  if (!callLog.started_at && (status === "in-progress" || status === "initiated")) {
    update.started_at = new Date().toISOString();
  }
  if (transcript && isTerminal) {
    update.transcript = transcript;
    update.transcript_status = "ok";
    update.transcribed_at = new Date().toISOString();
  }

  await supabase.from("call_logs").update(update).eq("id", callLog.id);

  if (!isTerminal) return json200({ ok: true, status, terminal: false });

  // On terminal: log usage (call cost) — only when duration is known and > 0.
  // Atomic claim against double-logging: write a service_usage_logs row keyed
  // on reference_id=call_log.id. Cost = ceil(seconds/60) * Rs 3.
  if (durationSec != null && durationSec > 0 && BILLABLE_CALL_ORG_IDS.has(callLog.org_id as string)) {
    const minutes = Math.ceil(durationSec / 60);
    const cost = +(minutes * CALL_COST_PER_MINUTE).toFixed(2);
    // @ts-ignore EdgeRuntime is a Supabase runtime global
    EdgeRuntime.waitUntil(
      recordUsage(supabase, {
        orgId: callLog.org_id as string,
        serviceType: "call",
        referenceId: callLog.id as string,
        quantity: minutes,
        cost,
        description: `AI call ${callLog.id} — ${minutes} min × Rs ${CALL_COST_PER_MINUTE}/min`,
      }),
    );
  }

  // Org-specific post-call WhatsApp send (5s after hangup, fire-and-forget).
  // Atomic claim: only the FIRST terminal webhook per call_log fires the send.
  const waConfig = POST_CALL_WA_BY_ORG[callLog.org_id as string];
  if (waConfig && !callLog.customer_message_sent_at) {
    const { data: claimed } = await supabase
      .from("call_logs")
      .update({ customer_message_sent_at: new Date().toISOString() })
      .eq("id", callLog.id)
      .is("customer_message_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimed) {
      const toNumber = (telephony.to_number as string)
        || (payload.to_number as string)
        || null;
      // @ts-ignore EdgeRuntime is a Supabase runtime global
      EdgeRuntime.waitUntil(
        sendPostCallWhatsApp(supabase, {
          orgId: callLog.org_id as string,
          callLogId: callLog.id,
          contactId: callLog.contact_id as string | null,
          toNumber,
          config: waConfig,
        }),
      );
    }
  }

  // Dispatch the next queued call in the same batch — only inside working window
  const window = isInsideWorkingWindow();
  if (!window.inside) {
    return json200({ ok: true, terminal: true, dispatched_next: false, reason: window.reason });
  }
  const batchId = (callLog as any).batch_id_proxy as string | null;
  if (!batchId) {
    return json200({ ok: true, terminal: true, dispatched_next: false, reason: "no batch id" });
  }
  await dispatchNextInBatch(supabase, batchId);
  return json200({ ok: true, terminal: true, dispatched_next: true });
});

async function sendPostCallWhatsApp(
  supabase: any,
  args: {
    orgId: string;
    callLogId: string;
    contactId: string | null;
    toNumber: string | null;
    config: typeof POST_CALL_WA_BY_ORG[string];
  },
): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, POST_CALL_WA_DELAY_MS));

    let firstName = "प्रतिभागी";
    let toNumber = args.toNumber;

    if (args.contactId) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("first_name, name_hi, phone")
        .eq("id", args.contactId)
        .maybeSingle();
      if (contact) {
        // Prefer Devanagari name for template; fall back to first_name.
        if ((contact as any).name_hi) firstName = (contact as any).name_hi;
        else if (contact.first_name) firstName = contact.first_name;
        if (!toNumber && contact.phone) toNumber = contact.phone as string;
      }
    }

    if (!toNumber) {
      console.warn("post-call-wa skip: no to_number for call_log", args.callLogId);
      return;
    }

    const cleanTo = String(toNumber).replace(/^\+/, "").replace(/^0+/, "");
    const params = args.config.body_params({ firstName });

    // Pre-insert a whatsapp_logs row in "queued" state so the dashboard can see
    // attempts even before Exotel responds.
    const { data: waLogRow } = await supabase
      .from("whatsapp_logs")
      .insert({
        org_id: args.orgId,
        contact_id: args.contactId,
        call_log_id: args.callLogId,
        to_number: cleanTo,
        template_name: args.config.template_name,
        language_code: args.config.language_code,
        body_params: params,
        status: "queued",
      })
      .select("id")
      .single();
    const waLogId = waLogRow?.id as string | undefined;

    const apiKey = Deno.env.get("EXOTEL_API_KEY");
    const apiToken = Deno.env.get("EXOTEL_API_TOKEN");
    const sid = Deno.env.get("EXOTEL_SID");
    const subdomain = Deno.env.get("EXOTEL_SUBDOMAIN") || "api.exotel.com";
    const from = args.config.from_number || Deno.env.get("EXOTEL_SENDER_NUMBER");

    if (!apiKey || !apiToken || !sid || !from) {
      console.error("post-call-wa skip: missing Exotel creds");
      if (waLogId) {
        await supabase
          .from("whatsapp_logs")
          .update({ status: "failed", failed_at: new Date().toISOString(), error_text: "missing Exotel creds" })
          .eq("id", waLogId);
      }
      return;
    }

    const url = `https://${subdomain}/v2/accounts/${sid}/messages`;
    const auth = btoa(`${apiKey}:${apiToken}`);
    const payload = {
      whatsapp: {
        messages: [{
          from,
          to: cleanTo,
          content: {
            type: "template",
            template: {
              name: args.config.template_name,
              language: { code: args.config.language_code },
              components: [{
                type: "body",
                parameters: params.map((t) => ({ type: "text", text: t })),
              }],
            },
          },
        }],
      },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await r.json();
    const msgResp = result?.response?.whatsapp?.messages?.[0];
    const ok = r.ok && (msgResp?.code === 200 || msgResp?.code === 202);

    if (ok) {
      const msgSid = msgResp?.data?.sid as string | undefined;
      console.log(`post-call-wa sent: msg_sid=${msgSid} template=${args.config.template_name} to=${cleanTo}`);
      if (waLogId) {
        await supabase
          .from("whatsapp_logs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            exotel_msg_sid: msgSid,
            cost_charged: WHATSAPP_UTILITY_COST_PER_MSG,
          })
          .eq("id", waLogId);
      }
      // Log usage + decrement wallet
      await recordUsage(supabase, {
        orgId: args.orgId,
        serviceType: "whatsapp",
        referenceId: waLogId || args.callLogId,
        quantity: 1,
        cost: WHATSAPP_UTILITY_COST_PER_MSG,
        description: `WhatsApp utility template ${args.config.template_name} → ${cleanTo}`,
      });
    } else {
      console.error("post-call-wa send failed:", JSON.stringify(result));
      if (waLogId) {
        await supabase
          .from("whatsapp_logs")
          .update({
            status: "failed",
            failed_at: new Date().toISOString(),
            error_text: JSON.stringify(result).slice(0, 500),
          })
          .eq("id", waLogId);
      }
    }
  } catch (e) {
    console.error("post-call-wa exception:", String(e));
  }
}

// Records a usage row and atomically decrements the org's wallet balance.
// Idempotent on (service_type, reference_id) — duplicate webhooks won't double-charge.
async function recordUsage(
  supabase: any,
  args: {
    orgId: string;
    serviceType: "call" | "whatsapp" | "email";
    referenceId: string;
    quantity: number;
    cost: number;
    description: string;
  },
): Promise<void> {
  try {
    // Idempotency check
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
      .insert({
        org_id: args.orgId,
        service_type: args.serviceType,
        reference_id: args.referenceId,
        quantity: args.quantity,
        cost: args.cost,
        wallet_deducted: false,
      })
      .select("id")
      .single();
    if (!usageRow) return;

    // Deduct from wallet if a subscription row exists
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

    await supabase
      .from("organization_subscriptions")
      .update({ wallet_balance: balanceAfter, updated_at: new Date().toISOString() })
      .eq("org_id", args.orgId);

    await supabase
      .from("service_usage_logs")
      .update({ wallet_deducted: true, wallet_transaction_id: walletTxn?.id })
      .eq("id", usageRow.id);
  } catch (e) {
    console.error("recordUsage exception:", String(e));
  }
}

async function dispatchNextInBatch(supabase: any, batchId: string): Promise<void> {
  const bolnaKey = Deno.env.get("BOLNA_API_KEY");
  if (!bolnaKey) return;

  const { data: nextRow } = await supabase
    .from("call_logs")
    .select("id, contact_id, to_number, ai_script_id, ai_call_scripts:ai_script_id(bolna_agent_id)")
    .eq("bolna_batch_id", batchId)
    .eq("caller_type", "ai")
    .eq("status", "queued")
    .order("bolna_queue_position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextRow) return;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, name_hi, company, job_title")
    .eq("id", nextRow.contact_id)
    .maybeSingle();

  if (!contact) {
    await supabase.from("call_logs").update({ status: "error" }).eq("id", nextRow.id);
    return;
  }

  const agentId = (nextRow as any).ai_call_scripts?.bolna_agent_id as string | undefined;
  if (!agentId) {
    await supabase.from("call_logs").update({ status: "error" }).eq("id", nextRow.id);
    return;
  }

  const result = await triggerBolnaCall(bolnaKey, {
    agentId,
    toNumber: nextRow.to_number,
    callLogId: nextRow.id,
    contact,
  });

  if (result.error) {
    await supabase.from("call_logs").update({ status: "error" }).eq("id", nextRow.id);
    await dispatchNextInBatch(supabase, batchId);
    return;
  }

  await supabase
    .from("call_logs")
    .update({
      status: "in_progress",
      bolna_execution_id: result.execution_id,
      started_at: new Date().toISOString(),
    })
    .eq("id", nextRow.id);
}

function json200(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
