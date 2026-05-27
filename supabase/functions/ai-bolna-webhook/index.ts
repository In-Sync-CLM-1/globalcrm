import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  isInsideWorkingWindow,
  triggerBolnaCall,
  BILLABLE_CALL_ORG_IDS,
  INSYNC_DEMO_ORG_ID,
} from "../_shared/aiCalling.ts";
import { classifyCall, applyDisposition, classifyJoinIntent } from "../_shared/dispositionClassifier.ts";

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
const WHATSAPP_MARKETING_COST_PER_MSG = 1.00;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

// Org-specific post-call WhatsApp template config.
// from_number overrides the default EXOTEL_SENDER_NUMBER env when set —
// used when an org has its own WhatsApp sender on the same WABA.
const POST_CALL_WA_BY_ORG: Record<string, {
  template_name: string;
  language_code: string;
  from_number?: string;
  // Per-message cost (₹). Defaults to the utility rate; set the marketing rate
  // when Meta classifies the template as MARKETING (e.g. training_link_v4).
  cost_per_msg?: number;
  body_params: (ctx: { firstName: string }) => string[];
}> = {
  "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": {
    template_name: "iedup_cmyuva_training_link_v4",
    language_code: "hi",
    from_number: "+918808359820",
    cost_per_msg: WHATSAPP_MARKETING_COST_PER_MSG, // Meta classed v4 as MARKETING
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
  // Bolna nests the user_data we sent under context_details.recipient_data.
  const recipientData = ((contextDetails as any)?.recipient_data as Record<string, unknown>) || contextDetails;
  const callLogIdFromContext = (recipientData?.call_log_id as string | undefined) ?? (contextDetails?.call_log_id as string | undefined);

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

  // In-Sync Demo: AI auto-sets the disposition from the call outcome, which fires
  // the calendar/notification + follow-up message chain. Background task so the
  // webhook responds fast.
  if (callLog.org_id === INSYNC_DEMO_ORG_ID && callLog.contact_id && (recipientData as any)?.purpose !== "reminder") {
    // @ts-ignore EdgeRuntime is a Supabase runtime global
    EdgeRuntime.waitUntil(autoDisposition(supabase, {
      callLogId: callLog.id as string,
      orgId: callLog.org_id as string,
      contactId: callLog.contact_id as string,
      status,
      durationSec,
      transcript,
    }));
  }

  // Reminder calls: capture the prospect's join/decline answer and notify the host.
  if (callLog.org_id === INSYNC_DEMO_ORG_ID && callLog.contact_id && (recipientData as any)?.purpose === "reminder") {
    // @ts-ignore EdgeRuntime is a Supabase runtime global
    EdgeRuntime.waitUntil(handleReminderResult(supabase, {
      callLogId: callLog.id as string,
      orgId: callLog.org_id as string,
      contactId: callLog.contact_id as string,
      transcript,
      durationSec,
    }));
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
    const msgCost = args.config.cost_per_msg ?? WHATSAPP_UTILITY_COST_PER_MSG;

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
            cost_charged: msgCost,
          })
          .eq("id", waLogId);
      }
      // Log usage + decrement wallet
      await recordUsage(supabase, {
        orgId: args.orgId,
        serviceType: "whatsapp",
        referenceId: waLogId || args.callLogId,
        quantity: 1,
        cost: msgCost,
        description: `WhatsApp ${msgCost >= WHATSAPP_MARKETING_COST_PER_MSG ? "marketing" : "utility"} template ${args.config.template_name} → ${cleanTo}`,
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

async function autoDisposition(
  supabase: any,
  args: { callLogId: string; orgId: string; contactId: string; status: string; durationSec: number | null; transcript: string | null },
): Promise<void> {
  try {
    // Idempotent: skip if a disposition is already set (duplicate webhooks).
    const { data: cl } = await supabase.from("call_logs").select("disposition_id").eq("id", args.callLogId).maybeSingle();
    if (cl?.disposition_id) return;

    const transcript = args.transcript || "";
    const connected = (args.durationSec ?? 0) > 0 && /(?:^|\n)\s*user\s*:/i.test(transcript);

    let outcomeKey: string;
    let demoDate: string | null = null;
    let demoTime: string | null = null;
    let optOut = false;
    let summary: string | null = null;

    if (!connected) {
      outcomeKey = (args.status === "no-answer" || args.status === "busy") ? "no_answer" : "not_connected";
    } else {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      const { data: c } = await supabase.from("contacts").select("product").eq("id", args.contactId).maybeSingle();
      const productLabel = String(c?.product || "").toLowerCase() === "vendorverification" ? "Vendor Verification" : "WorkSync";
      const { data: keyRows } = await supabase.from("ai_outcome_disposition_map").select("outcome_key").eq("org_id", args.orgId);
      const keys = (keyRows || []).map((r: any) => r.outcome_key);
      const cls = anthropicKey ? await classifyCall(anthropicKey, { transcript, productLabel, outcomeKeys: keys }) : null;
      if (cls) {
        outcomeKey = cls.outcome_key;
        demoDate = cls.demo_date;
        demoTime = cls.demo_time;
        optOut = cls.opt_out;
        summary = cls.summary;
      } else {
        outcomeKey = "interested"; // safe fallback for a connected call we couldn't classify
      }
    }

    await applyDisposition(supabase, {
      orgId: args.orgId,
      callLogId: args.callLogId,
      contactId: args.contactId,
      outcomeKey,
      demoDate,
      demoTime,
      optOut,
      summary,
      callDuration: args.durationSec,
      fireAutomation: true,
    });

    // Follow-up email/WhatsApp for every contact we attempted to reach, regardless
    // of outcome — connected calls get the intro/demo message, no-answer calls get
    // the "sorry we missed you" message (template chosen in send-post-call-message).
    // Skip only opt-outs and do-not-contact outcomes; the sender additionally
    // re-checks per-channel suppression and the Wrong Number / Do Not Call dispositions.
    const NO_FOLLOWUP = new Set(["do_not_call", "wrong_person"]);
    if (!optOut && !NO_FOLLOWUP.has(outcomeKey)) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-post-call-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ call_log_id: args.callLogId }),
      }).catch((e) => console.warn("send-post-call-message invoke failed:", e));
    }
  } catch (e) {
    console.error("autoDisposition error:", String(e));
  }
}

// Reminder-call result: classify the prospect's join/decline answer, update the
// meeting RSVP, and notify the host (in-app always; WhatsApp + email on a clear yes/no).
async function handleReminderResult(
  supabase: any,
  args: { callLogId: string; orgId: string; contactId: string; transcript: string | null; durationSec: number | null },
): Promise<void> {
  try {
    const transcript = args.transcript || "";
    const connected = (args.durationSec ?? 0) > 0 && /(?:^|\n)\s*user\s*:/i.test(transcript);
    if (!connected) return; // no answer — nothing to report

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const cls = anthropicKey ? await classifyJoinIntent(anthropicKey, transcript)
      : { intent: "unclear" as const, reschedule_text: null, reschedule_date: null, reschedule_time: null };
    const intent = cls.intent;

    const { data: contact } = await supabase.from("contacts").select("first_name, product").eq("id", args.contactId).maybeSingle();
    const { data: os } = await supabase.from("organization_settings").select("demo_host_user_id").eq("org_id", args.orgId).maybeSingle();
    const hostId = os?.demo_host_user_id;
    const { data: mtg } = await supabase.from("contact_activities")
      .select("id, scheduled_at").eq("contact_id", args.contactId).eq("activity_type", "meeting")
      .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();

    const prospect = contact?.first_name || "The prospect";
    const productLabel = String(contact?.product || "").toLowerCase() === "vendorverification" ? "Vendor Verification" : "WorkSync";
    const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

    // RSVP + auto-reschedule
    let rescheduled = false, newWhen = "";
    if (intent === "yes" && mtg) {
      await supabase.from("contact_activities").update({ demo_rsvp_status: "accepted", demo_rsvp_at: new Date().toISOString() }).eq("id", mtg.id);
    } else if (intent === "no") {
      if (mtg && cls.reschedule_date) {
        const tm = cls.reschedule_time || "10:00";
        const newTs = new Date(`${cls.reschedule_date}T${tm}:00+05:30`);
        if (!isNaN(newTs.getTime()) && newTs.getTime() > Date.now()) {
          await supabase.from("contact_activities").update({
            demo_date: cls.reschedule_date, demo_time: tm, scheduled_at: newTs.toISOString(),
            demo_rsvp_status: "pending", demo_rsvp_at: null,
            demo_reminder_9am_sent_at: null, demo_reminder_1h_sent_at: null, demo_reminder_call_sent_at: null,
            updated_at: new Date().toISOString(),
          }).eq("id", mtg.id);
          rescheduled = true;
          newWhen = fmt(newTs.toISOString());
          // Fresh confirmation to the prospect for the new slot (re-run the post-call sender).
          const { data: disp } = await supabase.from("call_dispositions").select("id").eq("org_id", args.orgId).eq("name", "Demo Booked").maybeSingle();
          if (disp?.id) {
            await supabase.from("call_logs").update({ disposition_id: disp.id, customer_message_sent_at: null }).eq("id", args.callLogId);
            // Await so the send completes before this background task ends (fire-and-forget gets cut off).
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-post-call-message`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ call_log_id: args.callLogId }),
            }).catch(() => {});
          }
        }
      }
      if (!rescheduled && mtg) {
        await supabase.from("contact_activities").update({ demo_rsvp_status: "declined", demo_rsvp_at: new Date().toISOString() }).eq("id", mtg.id);
      }
    }
    if (!hostId) return;

    const whenStr = rescheduled ? newWhen : (mtg?.scheduled_at ? fmt(mtg.scheduled_at) : "their scheduled time");
    const statusText = intent === "yes" ? "has confirmed they will be joining"
      : intent === "no"
        ? (rescheduled
            ? `could not make the original time, so the demo is now rescheduled to ${newWhen} (a fresh confirmation was sent to them)`
            : `cannot make it and would like to reschedule${cls.reschedule_text ? ` (prefers: ${cls.reschedule_text})` : ""}`)
        : "gave an unclear answer about joining";
    // Short, template-grammar-fit version for the WhatsApp host alert ("{{2}} {{3}} their demo scheduled for {{4}}").
    const waStatus = intent === "yes" ? "has confirmed they will be joining"
      : rescheduled ? "has rescheduled" : "cannot make it and would like to reschedule";
    const title = intent === "yes" ? "Prospect will join the demo"
      : intent === "no" ? (rescheduled ? "Demo auto-rescheduled" : "Prospect can't make the demo")
      : "Demo reminder — unclear answer";

    const { data: host } = await supabase.from("profiles").select("first_name, phone, email").eq("id", hostId).maybeSingle();
    const hostName = host?.first_name || "there";

    // In-app notification (always)
    await supabase.from("notifications").insert({
      org_id: args.orgId, user_id: hostId, type: "demo_attendance", title,
      message: `${prospect} (${productLabel}) ${statusText} — demo at ${whenStr} IST.`,
      entity_type: "contact", entity_id: args.contactId, action_url: `/contacts/${args.contactId}`,
      metadata: { intent, rescheduled }, expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    });

    if (intent === "unclear") return; // WhatsApp + email only on a clear yes/no

    // Email to host
    if (RESEND_API_KEY && host?.email) {
      const { data: es } = await supabase.from("email_settings").select("sending_domain, verification_status, is_active").eq("org_id", args.orgId).maybeSingle();
      if (es?.is_active && es.verification_status === "verified") {
        const subject = intent === "yes" ? `Demo confirmed: ${prospect} will join`
          : rescheduled ? `Demo rescheduled: ${prospect} → ${newWhen}` : `Demo: ${prospect} needs to reschedule`;
        const action = intent === "yes" ? "<p>No action needed — see you on the call.</p>"
          : rescheduled ? "<p>The demo has been moved automatically and a fresh confirmation sent to the prospect. No action needed.</p>"
          : "<p>They'd like a different time — please reach out to reschedule.</p>";
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;color:#222;line-height:1.6"><p>Hi ${hostName},</p><p><strong>${prospect}</strong> (${productLabel}) ${statusText}.</p><p><strong>Demo:</strong> ${whenStr} IST</p>${action}<p style="margin-top:24px">— In-Sync</p></div>`;
        await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` }, body: JSON.stringify({ from: `In-Sync <noreply@${es.sending_domain}>`, to: [host.email], subject, html }) }).catch(() => {});
      }
    }

    // WhatsApp to host (demo_attendance_update template, when approved)
    if (host?.phone) {
      const { data: tpl } = await supabase.from("communication_templates").select("status, language").eq("org_id", args.orgId).eq("template_name", "demo_attendance_update").eq("template_type", "whatsapp").maybeSingle();
      const { data: ex } = await supabase.from("exotel_settings").select("*").eq("org_id", args.orgId).eq("is_active", true).maybeSingle();
      if (tpl?.status === "approved" && ex?.whatsapp_enabled) {
        let phone = String(host.phone).replace(/[^0-9+]/g, "");
        if (!phone.startsWith("+")) phone = phone.length === 10 ? "+91" + phone : "+" + phone;
        const apiKey = ex.whatsapp_api_key || ex.api_key, apiToken = ex.whatsapp_api_token || ex.api_token, sub = ex.whatsapp_subdomain || ex.subdomain, sid = ex.whatsapp_account_sid || ex.account_sid;
        const params = [hostName, prospect, waStatus, whenStr];
        const payload = { status_callback: `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`, whatsapp: { messages: [{ from: ex.whatsapp_source_number, to: phone, content: { type: "template", template: { name: "demo_attendance_update", language: { policy: "deterministic", code: tpl.language || "en" }, components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }] } } }] } };
        await fetch(`https://${sub}/v2/accounts/${sid}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${apiKey}:${apiToken}`) }, body: JSON.stringify(payload) }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("handleReminderResult error:", String(e));
  }
}

function json200(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
