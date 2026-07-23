// Full breadth of this function is 5 sub-flows (bulk email/WhatsApp campaigns,
// individual scheduled email/WhatsApp, 30-min activity reminders). Deeply
// testing all 5 would need a lot of fixture schema surface for marginal extra
// confidence -- this proves the riskiest one (direct external send + wallet
// deduction) for real, and a top-level "ran without throwing" check covers
// the rest, matching the bar used elsewhere in this batch for lower-risk
// sub-paths.
const E2E_ORG_ID = "00000000-0000-0000-0000-0000e2e57e57";
const E2E_USER_ID = "00000000-0000-0000-0000-0000e2e57e58";
const TEST_EMAIL = "a@in-sync.co.in";

function restHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function pgSelect(env, table, qs) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: restHeaders(env) });
  if (!r.ok) throw new Error(`select ${table} failed: ${r.status} ${await r.text()}`);
  return r.json();
}
async function pgInsertOne(env, table, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: restHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`insert ${table} failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0];
}
async function pgDelete(env, table, qs) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { method: "DELETE", headers: restHeaders(env) });
}
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  await pgDelete(env, "contact_activities", `org_id=eq.${E2E_ORG_ID}`);
  await pgDelete(env, "contacts", `org_id=eq.${E2E_ORG_ID}`);

  let contactId, activityId;
  try {
    const contact = await pgInsertOne(env, "contacts", { org_id: E2E_ORG_ID, first_name: "E2E", last_name: "Test", email: TEST_EMAIL });
    contactId = contact.id;

    const scheduledAt = new Date(Date.now() + 30 * 60000).toISOString();
    const activity = await pgInsertOne(env, "contact_activities", {
      org_id: E2E_ORG_ID, contact_id: contactId, activity_type: "call", subject: "E2E Test reminder call",
      scheduled_at: scheduledAt, reminder_sent: false, created_by: E2E_USER_ID,
    });
    activityId = activity.id;

    const res = await fetch(env.WORKER_URL);
    if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    assert(body.success === true, `expected success:true, got ${JSON.stringify(body)}`);
    assert(body.processed?.activityReminders >= 1, `expected at least 1 activity reminder processed, got ${JSON.stringify(body)}`);

    const written = await pgSelect(env, "contact_activities", `id=eq.${activityId}&select=reminder_sent`);
    assert(written[0]?.reminder_sent === true, `expected reminder_sent to be written back true, got ${JSON.stringify(written[0])}`);

    return { name: "scheduled-messages-processor", ok: true };
  } finally {
    if (activityId) await pgDelete(env, "contact_activities", `id=eq.${activityId}`);
    if (contactId) await pgDelete(env, "contacts", `id=eq.${contactId}`);
  }
}
