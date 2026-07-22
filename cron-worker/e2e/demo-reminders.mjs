// E2E check for the native demo-reminders worker (cron-worker/native/demo-reminders.js).
// Uses a dedicated, permanent test org (00000000-0000-0000-0000-0000e2e57e57,
// "E2E Test (Automated)") that has a verified email domain but deliberately NO
// exotel_settings / demo_reminder_agent_id — so the WhatsApp and call code paths
// run their real DB lookups and safely short-circuit ("wa_not_configured" /
// "no_agent") instead of ever contacting Exotel or Bolna. Only email is a real
// send, to a@in-sync.co.in (the documented test-sends inbox).

const E2E_ORG_ID = "00000000-0000-0000-0000-0000e2e57e57";
const TEST_EMAIL = "a@in-sync.co.in";
const TEST_PHONE = "+919999999999";

function restHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function pgInsertOne(env, table, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: restHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`insert ${table} failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0];
}
async function pgSelectOne(env, table, qs) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: restHeaders(env) });
  if (!r.ok) throw new Error(`select ${table} failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0] ?? null;
}
async function pgDelete(env, table, qs) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { method: "DELETE", headers: restHeaders(env) });
}

function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  // Clean up any stale fixture from a previously-failed run first.
  await pgDelete(env, "contact_activities", `org_id=eq.${E2E_ORG_ID}`);
  await pgDelete(env, "contacts", `org_id=eq.${E2E_ORG_ID}`);

  let contactId, meetingId;
  try {
    const contact = await pgInsertOne(env, "contacts", {
      org_id: E2E_ORG_ID, first_name: "E2E Test", email: TEST_EMAIL, phone: TEST_PHONE,
    });
    contactId = contact.id;

    // 30 min out lands inside the (0, 60] window -> kind "1h", comfortably away
    // from either boundary so a slow CI runner can't flake this.
    const scheduledAt = new Date(Date.now() + 30 * 60000).toISOString();
    const meeting = await pgInsertOne(env, "contact_activities", {
      org_id: E2E_ORG_ID, contact_id: contactId, activity_type: "meeting",
      subject: "E2E test meeting", scheduled_at: scheduledAt, meeting_link: "https://example.com/e2e",
    });
    meetingId = meeting.id;

    const res = await fetch(env.WORKER_URL);
    if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    assert(body.ok === true, `worker response not ok: ${JSON.stringify(body)}`);

    const entry = (body.results || []).find((r) => r.meeting === meetingId);
    assert(entry, `no result entry for our test meeting ${meetingId} in ${JSON.stringify(body.results)}`);
    assert(entry.kind === "1h", `expected kind "1h", got ${entry.kind}`);
    assert(entry.email === "sent", `expected email "sent" (real Resend send to ${TEST_EMAIL}), got ${entry.email}`);
    assert(entry.whatsapp === "wa_not_configured", `expected whatsapp "wa_not_configured" (proves the exotel_settings lookup ran and correctly found nothing for the isolated test org), got ${entry.whatsapp}`);
    assert(entry.call === "no_agent", `expected call "no_agent" (proves the organization_settings lookup ran), got ${entry.call}`);

    const written = await pgSelectOne(env, "contact_activities", `id=eq.${meetingId}&select=demo_reminder_1h_sent_at,demo_reminder_call_sent_at`);
    assert(written?.demo_reminder_1h_sent_at, "demo_reminder_1h_sent_at was not written back to the DB");
    assert(written?.demo_reminder_call_sent_at, "demo_reminder_call_sent_at was not written back to the DB");

    return { name: "demo-reminders", ok: true };
  } finally {
    if (meetingId) await pgDelete(env, "contact_activities", `id=eq.${meetingId}`);
    if (contactId) await pgDelete(env, "contacts", `id=eq.${contactId}`);
  }
}
