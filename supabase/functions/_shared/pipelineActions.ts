// Shared send/billing primitives for firing a single Call, WhatsApp, or Email
// action against one contact. Used by pipeline-action-dispatcher (stage-driven,
// queued) and iedup-fire-action (raw, manually-fired) so both paths share one
// proven implementation of sending + wallet billing instead of drifting apart.
import { replaceVariables } from "./templateVariables.ts";

// Per-org Exotel WhatsApp sender (WABA from-number).
export const WA_SENDER_BY_ORG: Record<string, string> = {
  "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": "+918178798930", // IEDUP
};

const WHATSAPP_UTILITY_COST_PER_MSG = 0.20;
const WHATSAPP_MARKETING_COST_PER_MSG = 1.00;
export const MARKETING_TEMPLATES = new Set<string>(["iedup_ramp_round1_selection_v1"]);
export function waCostFor(templateName: string | null): number {
  return templateName && MARKETING_TEMPLATES.has(templateName)
    ? WHATSAPP_MARKETING_COST_PER_MSG
    : WHATSAPP_UTILITY_COST_PER_MSG;
}

// Per-org email sender. Mirrors the IEDUP training domain (separate Resend
// account from the shared "fmamit" one — that account was already at its
// domain cap).
export const EMAIL_SENDER_BY_ORG: Record<string, { localPart: string; resendKeyEnv: string; fromName: string }> = {
  "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d": {
    localPart: "training@iedup.in-sync.co.in",
    resendKeyEnv: "IEDUP_RESEND_API_KEY",
    fromName: "IEDUP CM YUVA",
  },
};
export const EMAIL_COST_PER_MSG = 0.08;

// Reserve (charge) funds BEFORE sending. Atomically debits the wallet via the
// reserve_wallet_funds RPC, which only succeeds if balance − cost stays at/above
// the org's floor (passing null floor = unlimited, for internal/demo orgs).
// Idempotent on (service_type, reference_id): a retry for the same message is a
// no-op success. Returns { ok:false } when the wallet can't fund it.
export async function reserveFunds(
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
    if (existing) return { ok: true };

    const effectiveFloor = args.floor ?? -1e15;
    const { data: newBal, error } = await supabase.rpc("reserve_wallet_funds", {
      p_org: args.orgId, p_amount: args.cost, p_floor: effectiveFloor,
    });
    if (error) { console.error("reserve_wallet_funds error:", error.message); return { ok: false }; }
    if (newBal === null || newBal === undefined) return { ok: false };

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

// Credit a previously-reserved charge back when the send fails.
export async function refundFunds(
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
    if (!usage) return;

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

// ---- WhatsApp send ----------------------------------------------------------
// Logs to whatsapp_logs (the billing/usage table the IEDUP dashboard reads and
// the DLR webhook advances) and charges the wallet.
export async function sendWhatsAppTemplate(
  supabase: any,
  args: { orgId: string; sender: string; contact: any; phone: string; templateName: string; languageCode: string; floor: number | null },
): Promise<{ ok: boolean; error?: string; insufficientFunds?: boolean }> {
  const { orgId, sender, contact, phone, templateName, languageCode, floor } = args;
  const apiKey = Deno.env.get("EXOTEL_API_KEY");
  const apiToken = Deno.env.get("EXOTEL_API_TOKEN");
  const sid = Deno.env.get("EXOTEL_SID");
  const subdomain = Deno.env.get("EXOTEL_SUBDOMAIN") || "api.exotel.com";
  if (!apiKey || !apiToken || !sid || !sender) {
    return { ok: false, error: "Exotel WA creds/sender not configured" };
  }

  const cleanTo = phone.replace(/^\+/, "").replace(/^0+/, "");

  const name = contact.name_hi || contact.first_name || "प्रतिभागी";
  const NAME_PARAM_PREFIXES = ["iedup_cmyuva_training_helpdesk", "iedup_cmyuva_assessment_link"];
  const params: string[] = NAME_PARAM_PREFIXES.some((p) => templateName.startsWith(p)) ? [name] : [];
  const components = params.length > 0
    ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }]
    : [];

  const { data: waLogRow } = await supabase
    .from("whatsapp_logs")
    .insert({
      org_id: orgId,
      contact_id: contact.id,
      to_number: cleanTo,
      template_name: templateName,
      language_code: languageCode || "hi",
      body_params: params,
      status: "queued",
    })
    .select("id")
    .single();
  const waLogId = waLogRow?.id as string | undefined;

  const cost = waCostFor(templateName);
  const category = MARKETING_TEMPLATES.has(templateName) ? "marketing" : "utility";
  if (waLogId) {
    const reserved = await reserveFunds(supabase, {
      orgId, serviceType: "whatsapp", referenceId: waLogId, quantity: 1, cost, floor,
      description: `WhatsApp ${category} template ${templateName} → ${cleanTo}`,
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
    custom_data: contact.id,
    status_callback: callbackUrl,
    whatsapp: {
      messages: [{
        from: sender,
        to: cleanTo,
        content: {
          type: "template",
          template: {
            name: templateName,
            language: { code: languageCode || "hi" },
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
      await refundFunds(supabase, { orgId, serviceType: "whatsapp", referenceId: waLogId, cost, description: `Refund — WhatsApp send failed (${templateName})` });
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
    await supabase.from("whatsapp_logs")
      .update({ status: "sent", sent_at: new Date().toISOString(), exotel_msg_sid: exoSid, cost_charged: cost })
      .eq("id", waLogId);
    return { ok: true };
  }

  if (waLogId) {
    await refundFunds(supabase, { orgId, serviceType: "whatsapp", referenceId: waLogId, cost, description: `Refund — WhatsApp send failed (${templateName})` });
    await supabase.from("whatsapp_logs")
      .update({ status: "failed", failed_at: new Date().toISOString(), error_text: respText.slice(0, 500) })
      .eq("id", waLogId);
  }
  return { ok: false, error: respText.slice(0, 300) };
}

// ---- Email send ---------------------------------------------------------
// Logs to pipeline_email_log and charges the flat per-email cost.
export async function sendEmailTemplate(
  supabase: any,
  args: { orgId: string; contact: any; template: { id: string; subject: string; html_content: string; body_content?: string }; floor: number | null },
): Promise<{ ok: boolean; error?: string; insufficientFunds?: boolean }> {
  const { orgId, contact, template, floor } = args;
  const senderCfg = EMAIL_SENDER_BY_ORG[orgId];
  const apiKey = senderCfg ? Deno.env.get(senderCfg.resendKeyEnv) : null;
  if (!senderCfg || !apiKey) {
    return { ok: false, error: "Email sender not configured for org" };
  }
  if (!contact.email) {
    return { ok: false, error: "Contact has no email address" };
  }

  const subject = await replaceVariables(template.subject || "", contact, {}, supabase);
  const html = await replaceVariables(template.html_content || template.body_content || "", contact, {}, supabase);

  const { data: logRow } = await supabase
    .from("pipeline_email_log")
    .insert({
      org_id: orgId,
      contact_id: contact.id,
      email_template_id: template.id,
      to_email: contact.email,
      subject,
      status: "queued",
    })
    .select("id")
    .single();
  const logId = logRow?.id as string | undefined;

  const cost = EMAIL_COST_PER_MSG;
  if (logId) {
    const reserved = await reserveFunds(supabase, {
      orgId, serviceType: "email", referenceId: logId, quantity: 1, cost, floor,
      description: `Email "${template.subject}" → ${contact.email}`,
    });
    if (!reserved.ok) {
      await supabase.from("pipeline_email_log")
        .update({ status: "failed", failed_at: new Date().toISOString(), error_text: "insufficient wallet balance (floor)" })
        .eq("id", logId);
      return { ok: false, error: "insufficient wallet balance", insufficientFunds: true };
    }
  }

  let respText = "";
  let httpOk = false;
  let messageId: string | null = null;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: `${senderCfg.fromName} <${senderCfg.localPart}>`,
        to: [contact.email],
        subject,
        html,
      }),
    });
    respText = await resp.text();
    httpOk = resp.ok;
    try { messageId = JSON.parse(respText)?.id || null; } catch { /* keep raw */ }
  } catch (e: any) {
    if (logId) {
      await refundFunds(supabase, { orgId, serviceType: "email", referenceId: logId, cost, description: `Refund — email send failed (${template.subject})` });
      await supabase.from("pipeline_email_log")
        .update({ status: "failed", failed_at: new Date().toISOString(), error_text: `fetch failed: ${String(e?.message || e)}` })
        .eq("id", logId);
    }
    return { ok: false, error: `fetch failed: ${e?.message || e}` };
  }

  if (httpOk && logId) {
    await supabase.from("pipeline_email_log")
      .update({ status: "sent", sent_at: new Date().toISOString(), resend_message_id: messageId, cost_charged: cost })
      .eq("id", logId);
    return { ok: true };
  }

  if (logId) {
    await refundFunds(supabase, { orgId, serviceType: "email", referenceId: logId, cost, description: `Refund — email send failed (${template.subject})` });
    await supabase.from("pipeline_email_log")
      .update({ status: "failed", failed_at: new Date().toISOString(), error_text: respText.slice(0, 500) })
      .eq("id", logId);
  }
  return { ok: false, error: respText.slice(0, 300) };
}

// ---- AI call trigger --------------------------------------------------------
export async function triggerCall(
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
