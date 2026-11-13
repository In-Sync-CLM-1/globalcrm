// Fires a Channel + Template selection immediately against one or more IEDUP
// beneficiaries — the direct replacement for the old stage-driven automation.
// No queue, no waiting for a cron tick: called straight from the contact list
// (single-row change) or the bulk "Send" button (multi-row).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { isInsideCustomWindow, normalizePhone, WindowSlot } from "../_shared/aiCalling.ts";
import { orgServiceGate } from "../_shared/billingGate.ts";
import { WA_SENDER_BY_ORG, sendWhatsAppTemplate, sendEmailTemplate, triggerCall } from "../_shared/pipelineActions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IEDUP_ORG_ID = "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d";
const MAX_CONTACTS_PER_CALL = 200;

type Channel = "call" | "whatsapp" | "email";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return done(401, { error: "Not authenticated" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.org_id !== IEDUP_ORG_ID) {
      return done(403, { error: "This action is only available to the IEDUP org" });
    }

    const body = await req.json().catch(() => ({}));
    const contactIds: string[] = Array.isArray(body?.contact_ids) ? body.contact_ids.slice(0, MAX_CONTACTS_PER_CALL) : [];
    const channel: Channel = body?.channel;
    const templateName: string | null = body?.template_name || null;

    if (contactIds.length === 0) return done(400, { error: "contact_ids is required" });
    if (!["call", "whatsapp", "email"].includes(channel)) return done(400, { error: "channel must be call, whatsapp, or email" });
    if (channel !== "call" && !templateName) return done(400, { error: "template_name is required for whatsapp/email" });

    const gate = await orgServiceGate(supabase, IEDUP_ORG_ID);
    if (!gate.allowed) return done(402, { error: gate.reason });
    const floor = typeof gate.floor === "number" ? gate.floor : null;

    const { data: contactRows } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, name_hi, phone, email, do_not_call, created_at")
      .eq("org_id", IEDUP_ORG_ID)
      .in("id", contactIds);
    const contacts = contactRows || [];

    // Record the raw selection on every targeted contact regardless of send
    // outcome — Channel/Template reflect what's currently assigned; delivery
    // success lives in whatsapp_logs / pipeline_email_log / call_logs.
    await supabase
      .from("contacts")
      .update({ action_channel: channel, action_template: templateName, action_fired_at: new Date().toISOString() })
      .in("id", contacts.map((c: any) => c.id));

    let results: { contact_id: string; ok: boolean; error?: string }[] = [];

    if (channel === "whatsapp") {
      const { data: tpl } = await supabase
        .from("communication_templates")
        .select("template_name, language, status")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("template_name", templateName)
        .maybeSingle();
      if (!tpl) return done(404, { error: `Template "${templateName}" not found for this org` });
      const sender = WA_SENDER_BY_ORG[IEDUP_ORG_ID] || Deno.env.get("EXOTEL_SENDER_NUMBER") || "";
      results = await mapPool(contacts, 10, async (contact: any) => {
        const phone = normalizePhone(contact.phone);
        if (!phone) return { contact_id: contact.id, ok: false, error: "missing phone" };
        const res = await sendWhatsAppTemplate(supabase, {
          orgId: IEDUP_ORG_ID, sender, contact, phone,
          templateName: tpl.template_name, languageCode: tpl.language || "hi", floor,
        });
        return { contact_id: contact.id, ok: res.ok, error: res.error };
      });
    } else if (channel === "email") {
      const { data: tpl } = await supabase
        .from("email_templates")
        .select("id, subject, html_content, body_content")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("name", templateName)
        .eq("is_active", true)
        .maybeSingle();
      if (!tpl) return done(404, { error: `Template "${templateName}" not found for this org` });
      results = await mapPool(contacts, 10, async (contact: any) => {
        if (!contact.email) return { contact_id: contact.id, ok: false, error: "missing email" };
        const res = await sendEmailTemplate(supabase, { orgId: IEDUP_ORG_ID, contact, template: tpl, floor });
        return { contact_id: contact.id, ok: res.ok, error: res.error };
      });
    } else {
      // ---- Call --------------------------------------------------------------
      const { data: os } = await supabase
        .from("organization_settings")
        .select("calling_windows, dialing_active")
        .eq("org_id", IEDUP_ORG_ID)
        .maybeSingle();
      if (os?.dialing_active === false) {
        return done(409, { error: "AI dialing is currently paused for this org" });
      }
      const win = isInsideCustomWindow(os?.calling_windows as WindowSlot[] | null);
      if (!win.inside) return done(409, { error: `Outside calling window: ${win.reason}` });

      const bolnaKey = Deno.env.get("BOLNA_API_KEY");
      const { data: script } = await supabase
        .from("ai_call_scripts")
        .select("id, bolna_agent_id")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("is_active", true)
        .not("bolna_agent_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (!bolnaKey || !script?.bolna_agent_id) {
        return done(500, { error: "No Bolna key/agent configured for this org" });
      }
      const { data: dispo } = await supabase
        .from("call_dispositions")
        .select("id")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("name", "Call made")
        .eq("is_active", true)
        .maybeSingle();

      const todayStartIso = new Date(istStartOfTodayMs()).toISOString();
      const candidateIds = contacts.map((c: any) => c.id);
      const alreadyCalled = new Set<string>();
      if (candidateIds.length > 0) {
        const { data: priorCalls } = await supabase
          .from("call_logs")
          .select("contact_id")
          .eq("org_id", IEDUP_ORG_ID)
          .eq("caller_type", "ai")
          .in("contact_id", candidateIds)
          .or(`created_at.gte.${todayStartIso},status.in.(queued,in_progress)`);
        for (const c of (priorCalls || [])) if (c.contact_id) alreadyCalled.add(c.contact_id as string);
      }

      results = [];
      for (const contact of contacts) {
        const phone = normalizePhone(contact.phone);
        if (!phone || contact.do_not_call) {
          results.push({ contact_id: contact.id, ok: false, error: contact.do_not_call ? "do_not_call" : "missing phone" });
          continue;
        }
        if (alreadyCalled.has(contact.id)) {
          results.push({ contact_id: contact.id, ok: false, error: "already called today / in progress" });
          continue;
        }
        const res = await triggerCall(supabase, {
          orgId: IEDUP_ORG_ID, bolnaKey, agentId: script.bolna_agent_id, scriptId: script.id,
          dispositionId: dispo?.id ?? null, contact, phone,
        });
        results.push({ contact_id: contact.id, ok: res.ok, error: res.error });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;
    return done(200, { ok: true, sent, failed, results });
  } catch (e: any) {
    console.error("iedup-fire-action error:", String(e?.message || e));
    return done(500, { error: String(e?.message || e) });
  }
});

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
