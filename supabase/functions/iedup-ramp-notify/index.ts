// Called by the UP RAMP portal (ramp.in-sync.co.in) right after someone registers.
// Sends the registration-confirmed WhatsApp and email on behalf of the IEDUP org,
// so both are logged against a contact and charged to the IEDUP wallet at the
// normal per-message rates (WhatsApp utility, email) like every other IEDUP send.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { orgServiceGate } from "../_shared/billingGate.ts";
import {
  EMAIL_COST_PER_MSG, EMAIL_SENDER_BY_ORG, WA_SENDER_BY_ORG, refundFunds, reserveFunds, sendWhatsAppTemplate,
} from "../_shared/pipelineActions.ts";

const IEDUP_ORG_ID = "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d";
const WA_TEMPLATE = "iedup_registration_confirmed_v1";
const SITE = "https://ramp.in-sync.co.in";
const BROCHURE_URL = `${SITE}/IEDUP-Brochure.pdf`;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function emailHtml(name: string, course: string, applicationNo: string) {
  const btn = (href: string, label: string, solid: boolean) =>
    `<a href="${href}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 22px;border-radius:6px;font-weight:600;text-decoration:none;${solid ? "background:#0c2d5e;color:#ffffff" : "border:1.5px solid #0c2d5e;color:#0c2d5e"}">${label}</a>`;
  return `<div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d2733">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden" cellspacing="0" cellpadding="0">
<tr><td style="background:#0c2d5e;color:#ffffff;padding:18px 28px;font-size:13px;letter-spacing:.08em">IEDUP · UP RAMP</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 6px;font-size:22px;color:#0c2d5e">Registration confirmed</h1>
<p style="margin:0 0 20px;font-size:15px;color:#5b6877">Dear ${esc(name)}, your registration for the ${esc(course)} is confirmed.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8f1fb;border-radius:8px"><tr><td style="padding:14px 18px">
<div style="font-size:12px;color:#5b6877;text-transform:uppercase;letter-spacing:.08em">Application number</div>
<div style="font-size:24px;font-weight:700;color:#0c2d5e">${esc(applicationNo)}</div></td></tr></table>
<p style="margin:20px 0 4px;font-size:15px"><b>What next</b></p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.5">Applications are screened for suitability. We will update you by email and WhatsApp.</p>
${btn(SITE, "Registration page", true)}${btn(BROCHURE_URL, "Download brochure", false)}
</td></tr>
<tr><td style="padding:16px 28px;background:#f3f6fb;font-size:12px;line-height:1.5;color:#5b6877">Institute of Entrepreneurship Development, U.P. (IEDUP), Dept. of MSME &amp; Export Promotion, Govt. of U.P.<br>Queries: Mr. Vibhu Dixit, +91 7607359820 · www.iedup.in</td></tr>
</table></div>`;
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("RAMP_NOTIFY_SECRET");
  if (!secret || req.headers.get("x-ramp-secret") !== secret) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => ({}));
  const mobile = String(body.mobile ?? "").replace(/\D/g, "").slice(-10);
  const email = String(body.email ?? "").trim();
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Participant";
  const course = String(body.course ?? "").trim().slice(0, 100) || "UP RAMP programme";
  const applicationNo = String(body.application_no ?? "").trim().slice(0, 40);
  if (mobile.length !== 10 || !applicationNo) return json(400, { error: "mobile and application_no are required" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const gate = await orgServiceGate(supabase, IEDUP_ORG_ID);
  if (!gate.allowed) return json(402, { error: gate.reason });
  const floor = typeof gate.floor === "number" ? gate.floor : null;

  // One contact per mobile number in the IEDUP org; created on the first registration.
  const phone = `+91${mobile}`;
  let { data: contact } = await supabase
    .from("contacts").select("id, first_name, email, phone").eq("org_id", IEDUP_ORG_ID).eq("phone", phone).limit(1).maybeSingle();
  if (!contact) {
    const ins = await supabase.from("contacts")
      .insert({ org_id: IEDUP_ORG_ID, first_name: name, phone, email: email || null, source: "ramp_portal" })
      .select("id, first_name, email, phone").single();
    if (ins.error) return json(500, { error: `contact: ${ins.error.message}` });
    contact = ins.data;
  }

  const wa = await sendWhatsAppTemplate(supabase, {
    orgId: IEDUP_ORG_ID, sender: WA_SENDER_BY_ORG[IEDUP_ORG_ID], contact, phone, templateName: WA_TEMPLATE, languageCode: "en", floor,
    bodyParams: [name, course, applicationNo], headerDocument: { link: BROCHURE_URL, filename: "IEDUP-Brochure.pdf" },
  });

  let mail: { ok: boolean; error?: string } = { ok: false, error: "no email" };
  const senderCfg = EMAIL_SENDER_BY_ORG[IEDUP_ORG_ID];
  const apiKey = Deno.env.get(senderCfg.resendKeyEnv);
  if (email && apiKey) {
    const subject = "Registration confirmed | IEDUP UP RAMP";
    const { data: logRow } = await supabase.from("pipeline_email_log")
      .insert({ org_id: IEDUP_ORG_ID, contact_id: contact.id, to_email: email, subject, status: "queued" }).select("id").single();
    const logId = logRow?.id as string | undefined;
    const reserved = logId
      ? await reserveFunds(supabase, { orgId: IEDUP_ORG_ID, serviceType: "email", referenceId: logId, quantity: 1, cost: EMAIL_COST_PER_MSG, floor, description: `Email "${subject}" → ${email}` })
      : { ok: false };
    if (!reserved.ok) {
      if (logId) await supabase.from("pipeline_email_log").update({ status: "failed", failed_at: new Date().toISOString(), error_text: "insufficient wallet balance (floor)" }).eq("id", logId);
      mail = { ok: false, error: "insufficient wallet balance" };
    } else {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: "IEDUP RAMP <ramp@iedup.in-sync.co.in>", to: [email], reply_to: "edpavg@gmail.com", subject,
          html: emailHtml(name, course, applicationNo), attachments: [{ filename: "IEDUP-Brochure.pdf", path: BROCHURE_URL }],
        }),
      }).catch((e) => ({ ok: false, text: async () => String(e) } as Response));
      const text = await resp.text();
      if (resp.ok) {
        let id: string | null = null;
        try { id = JSON.parse(text)?.id ?? null; } catch { /* keep null */ }
        await supabase.from("pipeline_email_log").update({ status: "sent", sent_at: new Date().toISOString(), resend_message_id: id, cost_charged: EMAIL_COST_PER_MSG }).eq("id", logId!);
        mail = { ok: true };
      } else {
        await refundFunds(supabase, { orgId: IEDUP_ORG_ID, serviceType: "email", referenceId: logId!, cost: EMAIL_COST_PER_MSG, description: `Refund — email send failed (${subject})` });
        await supabase.from("pipeline_email_log").update({ status: "failed", failed_at: new Date().toISOString(), error_text: text.slice(0, 500) }).eq("id", logId!);
        mail = { ok: false, error: text.slice(0, 200) };
      }
    }
  }
  return json(200, { whatsapp: wa, email: mail });
});
