import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabaseClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const DEMO_DISPOSITION = "Demo Booked";
const SKIP_DISPOSITIONS = new Set(["Wrong Number", "Do Not Call"]);

const EMAIL_TEMPLATE_DEMO = "Work-Sync: Demo Confirmation";
const EMAIL_TEMPLATE_INTRO = "Work-Sync: Post-Call Introduction";
const WA_TEMPLATE_DEMO = "worksync_demo_confirmation";
const WA_TEMPLATE_INTRO = "worksync_intro_post_call";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^0-9+]/g, "");
  if (!p) return null;
  if (!p.startsWith("+")) {
    p = p.length === 10 ? "+91" + p : "+" + p;
  }
  return p;
}

function formatDemoDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // demo_date is stored as YYYY-MM-DD; format as "11 May 2026"
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function formatDemoTime(raw: string | null | undefined): string {
  if (!raw) return "";
  // demo_time stored as "HH:mm"; format as "12:30 pm"
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return raw;
  const h = parseInt(m[1], 10);
  const mins = m[2];
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mins} ${period}`;
}

function renderTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient();
    const { call_log_id } = await req.json();

    if (!call_log_id) {
      return new Response(JSON.stringify({ error: "call_log_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Load call_log with its disposition
    const { data: callLog } = await supabase
      .from("call_logs")
      .select("id, org_id, contact_id, agent_id, disposition_id, customer_message_sent_at, activity_id")
      .eq("id", call_log_id)
      .maybeSingle();

    if (!callLog) {
      return new Response(JSON.stringify({ error: "call_log not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (callLog.customer_message_sent_at) {
      console.log(`[postcall] already sent for call_log ${call_log_id} — skipping`);
      return new Response(JSON.stringify({ skipped: "already_sent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!callLog.contact_id) {
      console.log(`[postcall] no contact_id on call_log ${call_log_id} — skipping`);
      return new Response(JSON.stringify({ skipped: "no_contact" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!callLog.disposition_id) {
      console.log(`[postcall] no disposition on call_log ${call_log_id} — skipping`);
      return new Response(JSON.stringify({ skipped: "no_disposition" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Resolve disposition name + skip rule
    const { data: disposition } = await supabase
      .from("call_dispositions")
      .select("name")
      .eq("id", callLog.disposition_id)
      .maybeSingle();

    const dispoName = disposition?.name || "";
    if (SKIP_DISPOSITIONS.has(dispoName)) {
      console.log(`[postcall] disposition is ${dispoName} — skipping`);
      // Mark as processed so we don't keep retrying
      await supabase.from("call_logs")
        .update({ customer_message_sent_at: new Date().toISOString() })
        .eq("id", callLog.id);
      return new Response(JSON.stringify({ skipped: "disposition_excluded", disposition: dispoName }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isDemo = dispoName === DEMO_DISPOSITION;

    // 3) Load contact, agent, activity (for demo date/time)
    const [{ data: contact }, { data: agentProfile }, activityRes] = await Promise.all([
      supabase.from("contacts")
        .select("id, first_name, last_name, email, phone, product, assigned_to, do_not_email, do_not_whatsapp, opted_out")
        .eq("id", callLog.contact_id).maybeSingle(),
      supabase.from("profiles")
        .select("id, first_name, last_name, email")
        .eq("id", callLog.agent_id).maybeSingle(),
      callLog.activity_id
        ? supabase.from("contact_activities")
            .select("demo_date, demo_time")
            .eq("id", callLog.activity_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!contact) {
      console.log(`[postcall] contact ${callLog.contact_id} not found`);
      return new Response(JSON.stringify({ skipped: "contact_missing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const activity: any = (activityRes as any)?.data || null;
    const agentName = agentProfile?.first_name
      ? `${agentProfile.first_name} ${agentProfile.last_name || ""}`.trim()
      : (agentProfile?.email || "the In-Sync team");

    const prospectFirstName = contact.first_name || "there";
    const demoDateStr = formatDemoDate(activity?.demo_date);
    const demoTimeStr = formatDemoTime(activity?.demo_time);

    // Product-aware template selection (worksync vs vendorverification).
    const product = String((contact as any).product || "").toLowerCase().trim();
    const isVV = product === "vendorverification";
    let emailTemplateName = isDemo
      ? (isVV ? "Vendor Verification: Demo Confirmation" : "Work-Sync: Demo Confirmation")
      : (isVV ? "Vendor Verification: Post-Call Introduction" : "Work-Sync: Post-Call Introduction");
    let waTemplateName = isDemo
      ? (isVV ? "vendorverification_demo_confirmation" : "worksync_demo_confirmation_v2")
      : (isVV ? "vendorverification_intro_post_call" : "worksync_intro_post_call");

    // The rep shown in the message is the lead owner (Riya / Anushree), falling back to the call agent.
    let repName = agentName, repEmail = agentProfile?.email || "", repPhone = "";
    if ((contact as any).assigned_to) {
      const { data: owner } = await supabase.from("profiles")
        .select("first_name, last_name, email, phone")
        .eq("id", (contact as any).assigned_to).maybeSingle();
      if (owner?.first_name) {
        repName = `${owner.first_name} ${owner.last_name || ""}`.trim();
        repEmail = owner.email || repEmail;
        repPhone = owner.phone || "";
      }
    }

    // For demo confirmations, pull the auto-created meeting's Meet link + RSVP token.
    let meetingLink = "", rsvpToken = "", rsvpLink = "", datedMeetingFound = false;
    if (isDemo) {
      const { data: mtg } = await supabase.from("contact_activities")
        .select("meeting_link, rsvp_token, demo_date")
        .eq("contact_id", callLog.contact_id).eq("activity_type", "meeting")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (mtg && mtg.demo_date) {
        datedMeetingFound = true;
        meetingLink = mtg.meeting_link || "";
        rsvpToken = mtg.rsvp_token || "";
        rsvpLink = rsvpToken ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/demo-rsvp?token=${rsvpToken}` : "";
      }
    }

    // Demo agreed but no date yet -> send the slot-request instead of a confirmation.
    const productLabel = isVV ? "Vendor Verification" : "WorkSync";
    const needsSlot = isDemo && !datedMeetingFound;
    const slotLink = `${Deno.env.get("SUPABASE_URL")}/functions/v1/demo-slot-pick?c=${contact.id}`;
    if (needsSlot) {
      emailTemplateName = "Demo Slot Request";
      waTemplateName = "demo_slot_request";
    }

    const emailVars: Record<string, string> = {
      prospect_name: prospectFirstName,
      first_name: prospectFirstName,
      assigned_to_name: repName,
      sales_rep_name: repName,
      caller_name: repName,
      caller_email: repEmail,
      caller_phone: repPhone,
      demo_day: demoDateStr,
      demo_date: demoDateStr,
      demo_time: demoTimeStr,
      meeting_link: meetingLink,
      rsvp_link: rsvpLink,
      product: productLabel,
      slot_link: slotLink,
    };

    const result: Record<string, any> = { call_log_id, disposition: dispoName, isDemo };

    // Suppression: opted-out or per-channel blocked contacts get nothing.
    const suppressedEmail = (contact as any).do_not_email || (contact as any).opted_out;
    const suppressedWa = (contact as any).do_not_whatsapp || (contact as any).opted_out;

    // 4) EMAIL
    if (contact.email && !suppressedEmail) {
      try {
        const { data: emailTpl } = await supabase
          .from("email_templates")
          .select("subject, html_content, body_content")
          .eq("org_id", callLog.org_id)
          .eq("name", emailTemplateName)
          .eq("is_active", true)
          .maybeSingle();

        if (!emailTpl) {
          console.warn(`[postcall] email template ${emailTemplateName} missing for org ${callLog.org_id}`);
          result.email = "template_missing";
        } else {
          const { data: emailSettings } = await supabase
            .from("email_settings")
            .select("sending_domain, verification_status, is_active")
            .eq("org_id", callLog.org_id)
            .maybeSingle();

          if (!emailSettings?.is_active || emailSettings.verification_status !== "verified") {
            console.warn(`[postcall] email sending not configured for org ${callLog.org_id}`);
            result.email = "domain_not_verified";
          } else if (!RESEND_API_KEY) {
            console.warn("[postcall] RESEND_API_KEY missing");
            result.email = "no_resend_key";
          } else {
            const subject = renderTemplate(emailTpl.subject || "", emailVars);
            const html = renderTemplate(emailTpl.html_content || emailTpl.body_content || "", emailVars);
            const fromEmail = `noreply@${emailSettings.sending_domain}`;
            const fromName = "In-Sync";
            const replyToEmail = agentProfile?.email || fromEmail;

            const r = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
              body: JSON.stringify({
                from: `${fromName} <${fromEmail}>`,
                to: [contact.email],
                reply_to: [replyToEmail],
                subject,
                html,
              }),
            });
            const body = await r.text();
            let parsed: any; try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
            if (r.ok) {
              result.email = "sent";
              await supabase.from("email_conversations").insert({
                org_id: callLog.org_id,
                contact_id: contact.id,
                conversation_id: parsed?.id || crypto.randomUUID(),
                direction: "outbound",
                from_email: fromEmail,
                from_name: fromName,
                to_email: contact.email,
                reply_to_email: replyToEmail,
                subject,
                html_content: html,
                email_content: html,
                status: "sent",
                sent_by: callLog.agent_id,
                sent_at: new Date().toISOString(),
                provider_message_id: parsed?.id || null,
              });
              console.log(`[postcall] email sent to ${contact.email}`);
            } else {
              result.email = "failed";
              result.email_error = parsed?.message || `HTTP ${r.status}`;
              console.error(`[postcall] email failed: ${result.email_error}`);
            }
          }
        }
      } catch (e: any) {
        result.email = "exception";
        result.email_error = e?.message || String(e);
        console.error("[postcall] email exception:", e);
      }
    } else {
      result.email = "no_contact_email";
    }

    // 5) WHATSAPP
    const waPhone = normalizePhone(contact.phone);
    if (waPhone && !suppressedWa) {
      try {
        const { data: settings } = await supabase
          .from("exotel_settings")
          .select("*")
          .eq("org_id", callLog.org_id)
          .eq("is_active", true)
          .maybeSingle();

        if (!settings || !settings.whatsapp_enabled || !settings.waba_id) {
          result.whatsapp = "wa_not_configured";
        } else {
          const { data: waTpl } = await supabase
            .from("communication_templates")
            .select("template_id, status, language")
            .eq("org_id", callLog.org_id)
            .eq("template_name", waTemplateName)
            .eq("template_type", "whatsapp")
            .maybeSingle();

          if (!waTpl) {
            result.whatsapp = "template_missing";
          } else if (waTpl.status !== "approved") {
            result.whatsapp = "template_not_approved";
          } else {
            // Build positional template variables per Exotel template body.
            //   worksync_demo_confirmation: {{1}} prospect, {{2}} agent, {{3}} date, {{4}} time
            //   worksync_intro_post_call:   {{1}} prospect, {{2}} agent
            const params = needsSlot
              ? [prospectFirstName, productLabel]
              : (isDemo
                ? [prospectFirstName, repName, demoDateStr, demoTimeStr]
                : [prospectFirstName, repName]);
            const buttonParam = needsSlot ? contact.id : (isDemo && rsvpToken ? rsvpToken : null);

            const apiKey = settings.whatsapp_api_key || settings.api_key;
            const apiToken = settings.whatsapp_api_token || settings.api_token;
            const subdomain = settings.whatsapp_subdomain || settings.subdomain;
            const accountSid = settings.whatsapp_account_sid || settings.account_sid;
            const exotelUrl = `https://${subdomain}/v2/accounts/${accountSid}/messages`;
            const basicAuth = "Basic " + btoa(`${apiKey}:${apiToken}`);

            const payload = {
              status_callback: `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`,
              whatsapp: {
                messages: [{
                  from: settings.whatsapp_source_number,
                  to: waPhone,
                  content: {
                    type: "template",
                    template: {
                      name: waTemplateName,
                      // Exotel requires {code:"en"} object (string fails silently)
                      language: { policy: "deterministic", code: waTpl.language || "en" },
                      components: [
                        {
                          type: "body",
                          parameters: params.map((p) => ({ type: "text", text: String(p) })),
                        },
                        // Dynamic URL button (base + suffix): RSVP token for a dated demo,
                        // or the contact id for the slot-request picker link.
                        ...(buttonParam
                          ? [{
                              type: "button",
                              sub_type: "url",
                              index: "0",
                              parameters: [{ type: "text", text: buttonParam }],
                            }]
                          : []),
                      ],
                    },
                  },
                }],
              },
            };

            const r = await fetch(exotelUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: basicAuth },
              body: JSON.stringify(payload),
            });
            const text = await r.text();
            let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
            const msg = parsed?.response?.whatsapp?.messages?.[0];
            const ok = r.ok && (msg?.code === 200 || msg?.code === 202 || msg?.status === "success");
            const messageSid = msg?.data?.sid || null;

            await supabase.from("whatsapp_messages").insert({
              org_id: callLog.org_id,
              contact_id: contact.id,
              template_id: waTpl.template_id,
              sent_by: callLog.agent_id,
              phone_number: waPhone,
              message_content: `Template: ${waTemplateName}`,
              template_variables: Object.fromEntries(params.map((p, i) => [String(i + 1), p])),
              status: ok ? "sent" : "failed",
              error_message: ok ? null : (msg?.error_data?.message || parsed?.message || `HTTP ${r.status}`),
              exotel_status_code: String(msg?.code ?? r.status),
              exotel_message_id: messageSid,
              direction: "outgoing",
            });

            result.whatsapp = ok ? "sent" : "failed";
            if (!ok) result.whatsapp_error = msg?.error_data?.message || parsed?.message || `HTTP ${r.status}`;
            console.log(`[postcall] WhatsApp ${result.whatsapp} to ${waPhone}`);
          }
        }
      } catch (e: any) {
        result.whatsapp = "exception";
        result.whatsapp_error = e?.message || String(e);
        console.error("[postcall] WhatsApp exception:", e);
      }
    } else {
      result.whatsapp = "no_contact_phone";
    }

    // 6) Mark as sent so we never double-send
    await supabase.from("call_logs")
      .update({ customer_message_sent_at: new Date().toISOString() })
      .eq("id", callLog.id);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[postcall] fatal error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
