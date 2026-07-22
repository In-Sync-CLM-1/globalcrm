// Native worker (does the real work itself — not a thin dispatcher to a
// Supabase edge function). Ported 1:1 from
// supabase/functions/demo-reminders/index.ts, which this worker replaces.
// Cron (every 5 min). Sends per demo meeting:
//   - "9am"      : at/after 09:00 IST on the day of the demo
//   - "1h"       : within 60 minutes before the slot
//   - "followup" : ~2h after the slot — one email covering both outcomes
//                  (thanks + next step if attended; reply-to-rebook if missed).
//                  Email only; the machine goes quiet after it by design.
// Each fires once (tracked by demo_reminder_9am_sent_at / demo_reminder_1h_sent_at /
// demo_followup_sent_at). Channels: email (Resend) + WhatsApp (Exotel
// "demo_reminder" template, when approved) + a courtesy voice call at 1h (Bolna).

function restBase(env) { return `${env.SUPABASE_URL}/rest/v1`; }
function restHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function pgSelect(env, table, qs) {
  const r = await fetch(`${restBase(env)}/${table}?${qs}`, { headers: restHeaders(env) });
  if (!r.ok) { const t = await r.text(); console.error(`select ${table} failed:`, r.status, t); throw new Error(`select ${table} failed: ${r.status} ${t}`); }
  return r.json();
}
async function pgSelectOne(env, table, qs) {
  const rows = await pgSelect(env, table, qs);
  return rows[0] ?? null;
}
async function pgPatch(env, table, qs, body) {
  const r = await fetch(`${restBase(env)}/${table}?${qs}`, { method: "PATCH", headers: restHeaders(env), body: JSON.stringify(body) });
  if (!r.ok) console.error(`patch ${table} failed:`, r.status, await r.text());
}
async function pgInsertReturning(env, table, body) {
  const r = await fetch(`${restBase(env)}/${table}`, { method: "POST", headers: restHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(body) });
  if (!r.ok) { console.error(`insert ${table} failed:`, r.status, await r.text()); return null; }
  const rows = await r.json();
  return rows[0] ?? null;
}
async function pgInsert(env, table, body) {
  const r = await fetch(`${restBase(env)}/${table}`, { method: "POST", headers: restHeaders(env), body: JSON.stringify(body) });
  if (!r.ok) console.error(`insert ${table} failed:`, r.status, await r.text());
}

function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[^0-9+]/g, "");
  if (!p) return null;
  if (!p.startsWith("+")) p = p.length === 10 ? "+91" + p : "+" + p;
  return p;
}
const istDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const istTime = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const istFull = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" });

async function sendEmail(env, orgId, to, subject, html, replyTo) {
  if (!to) return "no_email";
  if (!env.RESEND_API_KEY) return "no_key";
  const es = await pgSelectOne(env, "email_settings", `org_id=eq.${orgId}&select=sending_domain,verification_status,is_active&limit=1`);
  if (!es?.is_active || es.verification_status !== "verified") return "no_domain";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: `In-Sync <noreply@${es.sending_domain}>`, to: [to], subject, html, ...(replyTo ? { reply_to: [replyTo] } : {}) }),
  });
  return r.ok ? "sent" : "failed";
}

async function sendWhatsApp(env, orgId, phone, contactId, params) {
  if (!phone) return "no_phone";
  const s = await pgSelectOne(env, "exotel_settings", `org_id=eq.${orgId}&is_active=eq.true&select=*&limit=1`);
  if (!s || !s.whatsapp_enabled || !s.waba_id) return "wa_not_configured";
  const tpl = await pgSelectOne(env, "communication_templates", `org_id=eq.${orgId}&template_name=eq.demo_reminder&template_type=eq.whatsapp&select=template_id,status,language&limit=1`);
  if (!tpl) return "template_missing";
  if (tpl.status !== "approved") return "template_not_approved";

  const apiKey = s.whatsapp_api_key || s.api_key;
  const apiToken = s.whatsapp_api_token || s.api_token;
  const subdomain = s.whatsapp_subdomain || s.subdomain;
  const accountSid = s.whatsapp_account_sid || s.account_sid;
  const payload = {
    status_callback: `${env.SUPABASE_URL}/functions/v1/whatsapp-webhook`,
    whatsapp: { messages: [{
      from: s.whatsapp_source_number, to: phone,
      content: { type: "template", template: {
        name: "demo_reminder",
        language: { policy: "deterministic", code: tpl.language || "en" },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }],
      } },
    }] },
  };
  const r = await fetch(`https://${subdomain}/v2/accounts/${accountSid}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${apiKey}:${apiToken}`) },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = {}; }
  const msg = j?.response?.whatsapp?.messages?.[0];
  const ok = r.ok && (msg?.code === 200 || msg?.code === 202);
  await pgInsert(env, "whatsapp_messages", {
    org_id: orgId, contact_id: contactId, template_id: tpl.template_id, phone_number: phone,
    message_content: "Template: demo_reminder",
    template_variables: Object.fromEntries(params.map((p, i) => [String(i + 1), p])),
    status: ok ? "sent" : "failed", exotel_status_code: String(msg?.code ?? r.status), direction: "outgoing",
  });
  return ok ? "sent" : "failed";
}

const DEFAULT_FROM = "+911169323462";

// Places the 1-hour courtesy reminder call via the shared product-neutral Bolna agent.
// Passes the prospect's name + a short last-conversation summary. Marked purpose=reminder
// so ai-bolna-webhook does NOT run disposition logic on it.
async function fireReminderCall(env, m, c) {
  try {
    const phone = normalizePhone(c.phone);
    if (!phone) return "no_phone";
    if (!env.BOLNA_API_KEY) return "no_bolna_key";
    const os = await pgSelectOne(env, "organization_settings", `org_id=eq.${m.org_id}&select=demo_reminder_agent_id&limit=1`);
    const agentId = os?.demo_reminder_agent_id;
    if (!agentId) return "no_agent";

    let lastSummary = "your recent conversation with our team";
    const la = await pgSelectOne(env, "contact_activities", `contact_id=eq.${m.contact_id}&activity_type=eq.call&next_action_notes=not.is.null&select=next_action_notes&order=created_at.desc&limit=1`);
    if (la?.next_action_notes) lastSummary = String(la.next_action_notes).slice(0, 240);

    const cl = await pgInsertReturning(env, "call_logs", {
      org_id: m.org_id, contact_id: m.contact_id, caller_type: "ai",
      call_type: "outbound", direction: "outbound", from_number: DEFAULT_FROM, to_number: phone,
      status: "queued", notes: "Demo reminder call", created_at: new Date().toISOString(),
    });
    const callLogId = cl?.id;

    const res = await fetch("https://api.bolna.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId, recipient_phone_number: phone, from_phone_number: DEFAULT_FROM,
        user_data: {
          contact_id: m.contact_id, call_log_id: callLogId, purpose: "reminder",
          first_name: c.first_name || "there", last_summary: lastSummary, demo_time: istTime(m.scheduled_at),
          product: String(c.product || "").toLowerCase() === "vendorverification" ? "Vendor Verification" : "WorkSync",
        },
      }),
    });
    const txt = await res.text(); let j; try { j = JSON.parse(txt); } catch { j = {}; }
    const execId = j.execution_id || j.run_id;
    if (res.ok && execId && callLogId) {
      await pgPatch(env, "call_logs", `id=eq.${callLogId}`, { status: "in_progress", bolna_execution_id: execId, started_at: new Date().toISOString() });
      return "calling";
    }
    if (callLogId) await pgPatch(env, "call_logs", `id=eq.${callLogId}`, { status: "error" });
    return "failed";
  } catch (e) {
    console.error("fireReminderCall error:", String(e));
    return "exception";
  }
}

async function tick(env) {
  const now = new Date();
  // 26h back covers the follow-up window (fires from +2h after the slot) while
  // hard-excluding older meetings — a fresh deploy must never mass-email
  // prospects whose demos happened days or weeks ago.
  const fromIso = new Date(now.getTime() - 26 * 3600000).toISOString();
  const toIso = new Date(now.getTime() + 36 * 3600000).toISOString();

  const meetings = await pgSelect(env, "contact_activities",
    `activity_type=eq.meeting&scheduled_at=not.is.null&scheduled_at=gte.${fromIso}&scheduled_at=lte.${toIso}` +
    `&select=id,org_id,contact_id,subject,scheduled_at,meeting_link,demo_rsvp_status,demo_reminder_9am_sent_at,demo_reminder_1h_sent_at,demo_reminder_call_sent_at,demo_followup_sent_at`);

  const results = [];
  for (const m of meetings || []) {
    if (m.demo_rsvp_status === "declined") continue;
    const sched = new Date(m.scheduled_at);
    const minsUntil = (sched.getTime() - now.getTime()) / 60000;
    const istNow = new Date(now.getTime() + 5.5 * 3600000);
    const istSched = new Date(sched.getTime() + 5.5 * 3600000);
    const sameDay = istNow.getUTCFullYear() === istSched.getUTCFullYear()
      && istNow.getUTCMonth() === istSched.getUTCMonth()
      && istNow.getUTCDate() === istSched.getUTCDate();
    const istMinOfDay = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

    let kind = null;
    if (minsUntil > 0 && minsUntil <= 60 && !m.demo_reminder_1h_sent_at) kind = "1h";
    else if (sameDay && istMinOfDay >= 540 && minsUntil > 60 && !m.demo_reminder_9am_sent_at) kind = "9am";
    else if (minsUntil <= -120 && !m.demo_followup_sent_at) kind = "followup";
    if (!kind) continue;
    const sentCol = kind === "1h" ? "demo_reminder_1h_sent_at" : kind === "9am" ? "demo_reminder_9am_sent_at" : "demo_followup_sent_at";

    const c = await pgSelectOne(env, "contacts", `id=eq.${m.contact_id}&select=first_name,email,phone,product,do_not_call,do_not_email,do_not_whatsapp,opted_out&limit=1`);
    if (!c) continue;
    if (c.opted_out) {
      await pgPatch(env, "contact_activities", `id=eq.${m.id}`, { [sentCol]: new Date().toISOString() });
      results.push({ meeting: m.id, kind, skipped: "opted_out" });
      continue;
    }

    if (kind === "followup") {
      // One email, both outcomes: attended → next step; missed → reply to rebook.
      // Deliberately email-only and single-shot — no nudge sequence.
      const subject = "Your In-Sync demo — next step (or a new time)";
      const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#222;line-height:1.6;font-size:15px">
<p>Hi ${c.first_name || "there"},</p>
<p>Thank you for your time today — I hope the In-Sync demo gave you a clear picture of how your business could run on one platform.</p>
<p><strong>If you joined us:</strong> the natural next step is getting your team on a trial account. Just reply to this email and we'll set it up — most teams are live within days.</p>
<p><strong>If you couldn't make it:</strong> no problem at all. Reply with a day and time that suits you and we'll rearrange the demo.</p>
<p>Either way, this inbox reaches a real person.</p>
<p>Warm regards,<br>Amit Sengupta<br>Founder, In-Sync</p></div>`;
      const emailRes = c.do_not_email ? "suppressed" : await sendEmail(env, m.org_id, c.email, subject, html, "delight@in-sync.co.in");
      await pgPatch(env, "contact_activities", `id=eq.${m.id}`, { [sentCol]: new Date().toISOString() });
      results.push({ meeting: m.id, kind, email: emailRes });
      continue;
    }

    const subject = `Reminder: your In-Sync demo ${kind === "1h" ? "is in 1 hour" : "is today"}`;
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#222;line-height:1.6;font-size:15px">
<p>Hi ${c.first_name || "there"},</p>
<p>This is a reminder about your demo with In-Sync, scheduled for <strong>${istFull(m.scheduled_at)} IST</strong>.</p>
<p style="text-align:center;margin:26px 0"><a href="${m.meeting_link || "#"}" style="display:inline-block;background:#0D9488;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600">Join the Demo (Google Meet)</a></p>
<p>See you there!<br>In-Sync</p></div>`;

    const emailRes = c.do_not_email ? "suppressed" : await sendEmail(env, m.org_id, c.email, subject, html);
    const waRes = c.do_not_whatsapp ? "suppressed" : await sendWhatsApp(env, m.org_id, normalizePhone(c.phone), m.contact_id, [c.first_name || "there", istDate(m.scheduled_at), istTime(m.scheduled_at)]);

    // 1-hour reminder also places a courtesy voice call (product-neutral, references last convo).
    let callRes;
    if (kind === "1h" && !m.demo_reminder_call_sent_at) {
      callRes = c.do_not_call ? "suppressed" : await fireReminderCall(env, m, c);
      await pgPatch(env, "contact_activities", `id=eq.${m.id}`, { demo_reminder_call_sent_at: new Date().toISOString() });
    }

    await pgPatch(env, "contact_activities", `id=eq.${m.id}`, { [sentCol]: new Date().toISOString() });
    results.push({ meeting: m.id, kind, email: emailRes, whatsapp: waRes, call: callRes });
  }

  return { ok: true, processed: results.length, results };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
