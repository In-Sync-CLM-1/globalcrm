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

function emailHtml(name: string, course: string, _applicationNo: string) {
  return `<div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d2733">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden" cellspacing="0" cellpadding="0">
<tr><td style="background:#0c2d5e;color:#ffffff;padding:18px 28px;font-size:13px;letter-spacing:.08em">IEDUP · UP RAMP</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 6px;font-size:22px;color:#0c2d5e">Thank you for your interest</h1>
<p style="margin:0 0 20px;font-size:15px;color:#5b6877">Dear ${esc(name)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">We have received your interest in the ${esc(course)} programme at the Institute of Entrepreneurship Development, U.P. (IEDUP), an autonomous organisation under the Department of MSME &amp; Export Promotion, Govt. of Uttar Pradesh.</p>
<p style="margin:20px 0 4px;font-size:15px"><b>Programme details</b></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6">Organised by IEDUP under RAMP (Raising and Accelerating MSME Performance), a collaboration of the Government of Uttar Pradesh and the World Bank.<br>Duration: 3 months, with 1 hour of online classes daily for 2 months, followed by a bootcamp and exposure visits.<br>Curriculum: developed by IITians and vetted by IIT Kanpur.<br>Certification: government-recognised.</p>
<p style="margin:0 0 4px;font-size:15px"><b>Complete your profile</b></p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6">To move forward with the screening process, please register and complete your profile at the link below. Applications with incomplete profiles cannot be screened.</p>
<p style="margin:0 0 20px;font-size:15px">&#128073; <a href="${SITE}" style="color:#0c2d5e;font-weight:600">ramp.in-sync.co.in</a> (log in with your mobile number)</p>
<p style="margin:0 0 4px;font-size:15px"><b>What happens next</b></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6">Once you complete your profile, your application will be screened for suitability. The final decision rests with IEDUP. We will inform you of the result by email and WhatsApp, on the contact details you provide at registration. The programme brochure is attached.</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f3f6fb;font-size:12px;line-height:1.5;color:#5b6877">Institute of Entrepreneurship Development, U.P. (IEDUP), Dept. of MSME &amp; Export Promotion, Govt. of U.P.<br>Queries: Mr. Vibhu Dixit, +91 7607359820 · www.iedup.in<br>A-1 &amp; 2, Industrial Area, Sarojini Nagar, Lucknow – 226008<br><br>You are receiving this message because you expressed interest in this programme.</td></tr>
</table></div>`;
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("RAMP_NOTIFY_SECRET");
  if (!secret || req.headers.get("x-ramp-secret") !== secret) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => ({}));

  // Status updates for many people at once (staff approving or rejecting registrations): answer straight away and send in the background.
  if (body.kind === "application_status" && Array.isArray(body.items)) {
    const items = (body.items as Record<string, unknown>[]).slice(0, 200);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const gate = await orgServiceGate(db, IEDUP_ORG_ID);
    if (!gate.allowed) return json(402, { error: gate.reason });
    const floor = typeof gate.floor === "number" ? gate.floor : null;
    const work = (async () => {
      for (const it of items) {
        try {
          const m = String(it.mobile ?? "").replace(/\D/g, "").slice(-10);
          const nm = String(it.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Participant";
          const appNo = String(it.application_no ?? "").trim().slice(0, 40);
          if (m.length !== 10 || !appNo) continue;
          const ph = `+91${m}`;
          let { data: c } = await db.from("contacts").select("id, first_name, email, phone").eq("org_id", IEDUP_ORG_ID).eq("phone", ph).limit(1).maybeSingle();
          if (!c) {
            const ins = await db.from("contacts").insert({ org_id: IEDUP_ORG_ID, first_name: nm, phone: ph, source: "ramp_portal" }).select("id, first_name, email, phone").single();
            if (ins.error) continue;
            c = ins.data;
          }
          await sendWhatsAppTemplate(db, {
            orgId: IEDUP_ORG_ID, sender: WA_SENDER_BY_ORG[IEDUP_ORG_ID], contact: c, phone: ph, templateName: "iedup_application_status_v3", languageCode: "en", floor,
            bodyParams: [nm, appNo, String(it.course ?? "").trim().slice(0, 100) || "UP RAMP programme", String(it.detail ?? "").trim().slice(0, 100) || "Update", String(it.next_step ?? "").trim().slice(0, 150) || "We will keep you posted"],
          });
        } catch (e) { console.error("status send failed", String(e)); }
      }
    })();
    // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
    return json(202, { queued: items.length });
  }
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

  // The other two RAMP templates are WhatsApp-only follow-ups (no email, no brochure).
  const kind = String(body.kind ?? "registration_confirmed");
  const detail = String(body.detail ?? "").trim().slice(0, 100);
  const next = String(body.next_step ?? "").trim().slice(0, 150);
  const wa = kind === "application_pending"
    ? await sendWhatsAppTemplate(supabase, {
      orgId: IEDUP_ORG_ID, sender: WA_SENDER_BY_ORG[IEDUP_ORG_ID], contact, phone, templateName: "iedup_application_pending_v3", languageCode: "en", floor,
      bodyParams: [name, course, detail || "Pending step", applicationNo],
    })
    : kind === "application_status"
    ? await sendWhatsAppTemplate(supabase, {
      orgId: IEDUP_ORG_ID, sender: WA_SENDER_BY_ORG[IEDUP_ORG_ID], contact, phone, templateName: "iedup_application_status_v3", languageCode: "en", floor,
      bodyParams: [name, applicationNo, course, detail || "Update", next || "We will keep you posted"],
    })
    : await sendWhatsAppTemplate(supabase, {
      orgId: IEDUP_ORG_ID, sender: WA_SENDER_BY_ORG[IEDUP_ORG_ID], contact, phone, templateName: WA_TEMPLATE, languageCode: "en", floor,
      bodyParams: [name, course, applicationNo], headerDocument: { link: BROCHURE_URL, filename: "IEDUP-Brochure.pdf" },
    });
  if (kind !== "registration_confirmed") return json(200, { whatsapp: wa });

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
