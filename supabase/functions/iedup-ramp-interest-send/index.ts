// Sends the "Thank you for your interest" UP RAMP email, one contact at a time, to the
// IEDUP contacts uploaded from the FIEO exporter list (source 'fieo_exporters'). The
// brochure goes as a real attachment, each send is charged to the IEDUP wallet and logged
// in pipeline_email_log, and a contact is never emailed twice. Stops as soon as the wallet
// can no longer pay. Call it again to continue. { "max": 100, "dry_run": false }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { orgServiceGate } from "../_shared/billingGate.ts";
import { EMAIL_COST_PER_MSG, EMAIL_SENDER_BY_ORG, refundFunds, reserveFunds } from "../_shared/pipelineActions.ts";

const IEDUP_ORG_ID = "6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d";
const SOURCE = "fieo_exporters";
const SITE = "https://ramp.in-sync.co.in";
const BROCHURE_URL = `${SITE}/IEDUP-Brochure.pdf`;
const SUBJECT = "Thank you for your interest | IEDUP UP RAMP";
const COURSE = "Supply Chain Management (SCM)";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emailHtml(name: string) {
  return `<div style="background:#f3f6fb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d2733">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden" cellspacing="0" cellpadding="0">
<tr><td style="background:#0c2d5e;color:#ffffff;padding:18px 28px;font-size:13px;letter-spacing:.08em">IEDUP · UP RAMP</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 6px;font-size:22px;color:#0c2d5e">Thank you for your interest</h1>
<p style="margin:0 0 20px;font-size:15px;color:#5b6877">Dear ${esc(name)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">We have received your interest in the ${COURSE} programme at the Institute of Entrepreneurship Development, U.P. (IEDUP), an autonomous organisation under the Department of MSME &amp; Export Promotion, Govt. of Uttar Pradesh.</p>
<p style="margin:20px 0 4px;font-size:15px"><b>Programme details</b></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6">Organised by IEDUP under RAMP (Raising and Accelerating MSME Performance), a collaboration of the Government of Uttar Pradesh and the World Bank.<br>Duration: 3 months, with 1 hour of online classes daily for 2 months, followed by a bootcamp and exposure visits.<br>Curriculum: developed by IITians and vetted by IIT Kanpur.<br>Certification: government-recognised.</p>
<p style="margin:0 0 4px;font-size:15px"><b>Complete your profile</b></p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6">To move forward with the screening process, please register and complete your profile at the link below. Applications with incomplete profiles cannot be screened.</p>
<p style="margin:0 0 20px;font-size:15px">&#128073; <a href="${SITE}" style="color:#0c2d5e;font-weight:600">ramp.in-sync.co.in</a> (log in with your mobile number)</p>
<p style="margin:0 0 4px;font-size:15px"><b>What happens next</b></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6">Once you complete your profile, your application will be screened for suitability. The final decision rests with IEDUP. We will inform you of the result by email and WhatsApp, on the contact details you provide at registration. The programme brochure is attached.</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f3f6fb;font-size:12px;line-height:1.5;color:#5b6877">Institute of Entrepreneurship Development, U.P. (IEDUP), Dept. of MSME &amp; Export Promotion, Govt. of U.P.<br>Queries: Mr. Vibhu Dixit, +91 7607359820 · www.iedup.in<br>A-1 &amp; 2, Industrial Area, Sarojini Nagar, Lucknow – 226008<br><br>You are receiving this message because you expressed interest in this programme. If you do not want these emails, reply with "unsubscribe".</td></tr>
</table></div>`;
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("RAMP_NOTIFY_SECRET");
  if (!secret || req.headers.get("x-ramp-secret") !== secret) return json(401, { error: "Unauthorized" });
  const body = await req.json().catch(() => ({}));
  const max = Math.min(Math.max(Number(body.max) || 100, 1), 300);
  const dry = body.dry_run === true;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const gate = await orgServiceGate(db, IEDUP_ORG_ID);
  if (!gate.allowed) return json(402, { error: gate.reason });
  const floor = typeof gate.floor === "number" ? gate.floor : null;
  const senderCfg = EMAIL_SENDER_BY_ORG[IEDUP_ORG_ID];
  const apiKey = Deno.env.get(senderCfg.resendKeyEnv);
  if (!apiKey) return json(500, { error: "email key missing" });

  // The API returns at most 1000 rows a call, so read both lists page by page.
  const page = async (build: (from: number, to: number) => any) => {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };
  // Contacts not yet emailed with this subject (sent, queued or failed all count as handled).
  const done = await page((f, t) => db.from("pipeline_email_log").select("id, contact_id").eq("org_id", IEDUP_ORG_ID).eq("subject", SUBJECT).order("id").range(f, t));
  const handled = new Set(done.map((r: { contact_id: string }) => r.contact_id));
  const pool = await page((f, t) => db.from("contacts")
    .select("id, first_name, email, do_not_email, opted_out").eq("org_id", IEDUP_ORG_ID).eq("source", SOURCE)
    .not("email", "is", null).order("created_at").order("id").range(f, t));
  const todo = pool.filter((c: any) => !handled.has(c.id) && !c.do_not_email && !c.opted_out);
  if (dry) return json(200, { remaining: todo.length, wallet_floor: floor });

  const started = Date.now();
  let sent = 0, failed = 0, stopped = "";
  for (const c of todo.slice(0, max)) {
    if (Date.now() - started > 110_000) { stopped = "time budget"; break; }
    const name = String(c.first_name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Sir/Madam";
    const { data: logRow } = await db.from("pipeline_email_log")
      .insert({ org_id: IEDUP_ORG_ID, contact_id: c.id, to_email: c.email, subject: SUBJECT, status: "queued" }).select("id").single();
    const logId = logRow?.id as string | undefined;
    if (!logId) { failed++; continue; }
    const reserved = await reserveFunds(db, { orgId: IEDUP_ORG_ID, serviceType: "email", referenceId: logId, quantity: 1, cost: EMAIL_COST_PER_MSG, floor, description: `Email "${SUBJECT}" → ${c.email}` });
    if (!reserved.ok) {
      await db.from("pipeline_email_log").delete().eq("id", logId);
      stopped = "wallet balance too low";
      break;
    }
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "IEDUP RAMP <ramp@iedup.in-sync.co.in>", to: [c.email], reply_to: "edpavg@gmail.com", subject: SUBJECT,
        html: emailHtml(name), attachments: [{ filename: "IEDUP-Brochure.pdf", path: BROCHURE_URL }],
      }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) } as Response));
    const text = await resp.text();
    if (resp.ok) {
      let id: string | null = null;
      try { id = JSON.parse(text)?.id ?? null; } catch { /* keep null */ }
      await db.from("pipeline_email_log").update({ status: "sent", sent_at: new Date().toISOString(), resend_message_id: id, cost_charged: EMAIL_COST_PER_MSG }).eq("id", logId);
      sent++;
    } else {
      await refundFunds(db, { orgId: IEDUP_ORG_ID, serviceType: "email", referenceId: logId, cost: EMAIL_COST_PER_MSG, description: `Refund — email send failed (${SUBJECT})` });
      await db.from("pipeline_email_log").update({ status: "failed", failed_at: new Date().toISOString(), error_text: text.slice(0, 500) }).eq("id", logId);
      failed++;
      if (resp.status === 429) { stopped = "email provider limit"; break; }
    }
    await sleep(600);
  }
  return json(200, { sent, failed, remaining: todo.length - sent - failed, stopped });
});
