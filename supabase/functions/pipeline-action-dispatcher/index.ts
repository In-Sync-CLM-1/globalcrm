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
    .select("calling_windows")
    .eq("org_id", orgId)
    .maybeSingle();

  const win = isInsideCustomWindow(os?.calling_windows as WindowSlot[] | null);
  if (!win.inside) {
    return { org_id: orgId, acted: false, reason: win.reason };
  }

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
    .select("id, first_name, last_name, name_hi, company, job_title, phone, do_not_call")
    .in("id", contactIds);
  const contactById = new Map<string, any>((contactRows || []).map((c: any) => [c.id, c]));

  let waSent = 0, waFailed = 0, callsTriggered = 0, skipped = 0;

  // ---- WhatsApp -------------------------------------------------------------
  const waRows = queue.filter((r) => r.action_type === "whatsapp").slice(0, MAX_WA_PER_TICK);
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
  const callRows = queue.filter((r) => r.action_type === "call");
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

    if (!bolnaKey || !script?.bolna_agent_id) {
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

      for (const r of callRows.slice(0, slots)) {
        const contact = contactById.get(r.contact_id);
        const phone = normalizePhone(contact?.phone);
        if (!contact || !phone || contact.do_not_call) {
          await markQueue(supabase, r.id, "skipped", contact?.do_not_call ? "do_not_call" : "missing phone");
          skipped++;
          continue;
        }
        const res = await triggerCall(supabase, {
          orgId, bolnaKey, agentId: script.bolna_agent_id, scriptId: script.id,
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

  // Only the help-desk template carries a {{1}} name variable; the rest are generic.
  const name = contact.name_hi || contact.first_name || "प्रतिभागी";
  const params: string[] = row.template_name === "iedup_cmyuva_training_helpdesk_v1" ? [name] : [];

  const components = params.length > 0
    ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }]
    : [];

  const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
  const payload = {
    custom_data: row.contact_id,
    status_callback: callbackUrl,
    whatsapp: {
      messages: [{
        from: sender,
        to: phone,
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
    return { ok: false, error: `fetch failed: ${e?.message || e}` };
  }

  let exoSid: string | null = null;
  try {
    const j = JSON.parse(respText);
    exoSid = j?.response?.whatsapp?.messages?.[0]?.data?.sid || null;
  } catch { /* keep raw */ }

  // Log so the DLR webhook can walk it Sent -> Delivered -> Opened.
  await supabase.from("whatsapp_messages").insert({
    org_id: orgId,
    contact_id: row.contact_id,
    conversation_id: phone,
    direction: "outbound",
    phone_number: phone,
    message_content: row.template_name,
    exotel_message_id: exoSid,
    status: httpOk ? "sent" : "failed",
    sent_at: new Date().toISOString(),
    error_message: httpOk ? null : respText.slice(0, 500),
  });

  if (!httpOk) return { ok: false, error: respText.slice(0, 300) };
  return { ok: true };
}

// ---- AI call trigger --------------------------------------------------------
async function triggerCall(
  supabase: any,
  args: {
    orgId: string; bolnaKey: string; agentId: string; scriptId: string;
    dispositionId: string | null; contact: any; phone: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { orgId, bolnaKey, agentId, scriptId, dispositionId, contact, phone } = args;

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
      from_number: "+911169323462",
      to_number: phone,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !inserted) return { ok: false, error: `call_logs insert: ${insErr?.message || "unknown"}` };

  const result = await triggerBolnaCall(bolnaKey, {
    agentId,
    toNumber: phone,
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

function done(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
