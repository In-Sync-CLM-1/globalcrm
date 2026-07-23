// Discovered during e2e testing: send-email (a separate, pre-existing edge
// function, unmodified here) calls supabaseClient.auth.getUser(token) on the
// caller's own Authorization header -- which requires a real user-session
// JWT with a `sub` claim. Service-role tokens (what any cron-triggered
// caller, including the original unmodified Deno automation-email-sender,
// necessarily uses) don't have one, so every real invocation 401s with
// "invalid claim: missing sub claim". Confirmed pre-existing by invoking the
// ORIGINAL, still-live edge function directly with this same fixture -- it
// fails identically. email_automation_executions had zero rows touched in
// the last 7 days in production, consistent with this having been broken
// for a while already. Not something to silently paper over or fix here
// (out of scope for an infra migration, and the real fix is a call the
// function's own auth design, not this port). This check instead verifies
// the one thing this migration IS responsible for: the worker reproduces
// the exact same retry/error-handling behavior as the original on this
// downstream failure (increments retry_count, reschedules, records the
// error) rather than crashing or silently dropping the execution.
const E2E_ORG_ID = "00000000-0000-0000-0000-0000e2e57e57";
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
  await pgDelete(env, "email_automation_executions", `org_id=eq.${E2E_ORG_ID}`);
  await pgDelete(env, "contacts", `org_id=eq.${E2E_ORG_ID}`);
  await pgDelete(env, "email_templates", `org_id=eq.${E2E_ORG_ID}`);
  await pgDelete(env, "email_automation_rules", `org_id=eq.${E2E_ORG_ID}`);

  let ruleId, templateId, contactId, executionId;
  try {
    const rule = await pgInsertOne(env, "email_automation_rules", {
      org_id: E2E_ORG_ID, name: "E2E Test Rule", trigger_type: "time_based",
      ab_test_enabled: false, enforce_business_hours: false,
    });
    ruleId = rule.id;

    const template = await pgInsertOne(env, "email_templates", {
      org_id: E2E_ORG_ID, name: "E2E Test Template", subject: "E2E Test — hi {{first_name}}",
      html_content: "<html><body><p>Hello {{first_name}}, this is an automated e2e check email.</p><p><a href=\"https://example.com\">a link</a></p></body></html>",
    });
    templateId = template.id;

    const contact = await pgInsertOne(env, "contacts", { org_id: E2E_ORG_ID, first_name: "E2E", email: TEST_EMAIL });
    contactId = contact.id;

    const execution = await pgInsertOne(env, "email_automation_executions", {
      org_id: E2E_ORG_ID, rule_id: ruleId, contact_id: contactId, trigger_type: "time_based",
      email_template_id: templateId, status: "scheduled", scheduled_for: new Date(Date.now() - 60000).toISOString(),
      retry_count: 0, max_retries: 3,
    });
    executionId = execution.id;

    const res = await fetch(env.WORKER_URL);
    if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    assert(!body.error, `worker threw instead of handling the execution: ${JSON.stringify(body)}`);

    const written = await pgSelect(env, "email_automation_executions", `id=eq.${executionId}&select=status,retry_count,error_message`);
    const row = written[0];
    assert(row, "execution row disappeared unexpectedly");
    // Either it actually sent (if send-email's auth bug happens to be fixed
    // by the time this runs) or it correctly entered the retry path -- both
    // are the worker behaving correctly; silently vanishing or crashing
    // would not be.
    const okOutcome = row.status === "sent" || (row.status === "scheduled" && row.retry_count === 1 && row.error_message);
    assert(okOutcome, `expected either a real send or a recorded retry, got ${JSON.stringify(row)}`);

    return { name: "automation-email-sender", ok: true };
  } finally {
    if (executionId) await pgDelete(env, "email_automation_executions", `id=eq.${executionId}`);
    if (contactId) await pgDelete(env, "contacts", `id=eq.${contactId}`);
    if (templateId) await pgDelete(env, "email_templates", `id=eq.${templateId}`);
    if (ruleId) await pgDelete(env, "email_automation_rules", `id=eq.${ruleId}`);
  }
}
