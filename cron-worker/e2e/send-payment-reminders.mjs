const E2E_ORG_ID = "00000000-0000-0000-0000-0000e2e57e57";

function restHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
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
  await pgDelete(env, "subscription_invoices", `org_id=eq.${E2E_ORG_ID}`);

  let invoiceId;
  try {
    // now + exactly 3 days: by the time the worker evaluates "today" a few
    // seconds later, the diff rounds up to exactly daysUntilDue === 3.
    const dueDate = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const invoice = await pgInsertOne(env, "subscription_invoices", {
      org_id: E2E_ORG_ID, invoice_number: `E2E-TEST-${Date.now()}`,
      invoice_date: new Date().toISOString().split("T")[0], due_date: dueDate.toISOString().split("T")[0],
      billing_period_start: new Date().toISOString().split("T")[0], billing_period_end: dueDate.toISOString().split("T")[0],
      base_subscription_amount: 100, user_count: 1, subtotal: 100, gst_amount: 18, total_amount: 118,
      payment_status: "pending",
    });
    invoiceId = invoice.id;

    const res = await fetch(env.WORKER_URL);
    if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    assert(body.success === true, `expected success:true, got ${JSON.stringify(body)}`);
    assert(body.sent >= 1, `expected at least 1 reminder sent (our 3-day-out test invoice), got ${JSON.stringify(body)}`);

    return { name: "send-payment-reminders", ok: true };
  } finally {
    if (invoiceId) await pgDelete(env, "subscription_invoices", `id=eq.${invoiceId}`);
  }
}
