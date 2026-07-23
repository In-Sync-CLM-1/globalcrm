// This function touches real client billing when run unscoped (it mass-
// generates proforma invoices for every active org that doesn't already
// have one this period) -- invoking it for real on every deploy would be
// dangerous. The worker accepts an e2e-only e2e_org_id body param (see
// native/generate-monthly-invoices.js) that scopes it to just the isolated
// test org, so this proves the real math + insert path without ever
// touching a real client's subscription.
const E2E_ORG_ID = "00000000-0000-0000-0000-0000e2e57e57";

function restHeaders(env, extra) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function pgSelectOne(env, table, qs) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: restHeaders(env) });
  if (!r.ok) throw new Error(`select ${table} failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0] ?? null;
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
async function pgRpc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: restHeaders(env), body: JSON.stringify(args || {}) });
  if (!r.ok) throw new Error(`rpc ${fn} failed: ${r.status} ${await r.text()}`);
  return r.json();
}
function assert(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); }

export async function run(env) {
  await pgDelete(env, "subscription_invoices", `org_id=eq.${E2E_ORG_ID}`);
  await pgDelete(env, "organization_subscriptions", `org_id=eq.${E2E_ORG_ID}`);

  let invoiceId, subCreated = false;
  try {
    const today = new Date().toISOString().split("T")[0];
    await pgInsertOne(env, "organization_subscriptions", {
      org_id: E2E_ORG_ID, subscription_status: "active", monthly_subscription_amount: 100, user_count: 1,
      billing_cycle_start: today, next_billing_date: today,
    });
    subCreated = true;

    const res = await fetch(env.WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e2e_org_id: E2E_ORG_ID }) });
    if (!res.ok) throw new Error(`worker invoke failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    assert(body.success === true, `expected success:true, got ${JSON.stringify(body)}`);
    assert(body.generated === 1, `expected exactly 1 invoice generated (scoped to the test org), got ${JSON.stringify(body)}`);

    const invoice = await pgSelectOne(env, "subscription_invoices", `org_id=eq.${E2E_ORG_ID}&select=*&limit=1`);
    assert(invoice, "no invoice row was actually created for the test org");
    invoiceId = invoice.id;
    assert(Number(invoice.base_subscription_amount) === 100, `expected base_subscription_amount 100, got ${invoice.base_subscription_amount}`);

    const pricingRaw = await pgRpc(env, "get_active_pricing", {});
    const pricing = Array.isArray(pricingRaw) ? pricingRaw[0] : pricingRaw;
    const expectedGst = 100 * (pricing.gst_percentage / 100);
    const expectedTotal = 100 + expectedGst;
    assert(Math.abs(Number(invoice.gst_amount) - expectedGst) < 0.01, `gst mismatch: expected ${expectedGst}, got ${invoice.gst_amount}`);
    assert(Math.abs(Number(invoice.total_amount) - expectedTotal) < 0.01, `total mismatch: expected ${expectedTotal}, got ${invoice.total_amount}`);
    assert(invoice.payment_status === "pending", `expected payment_status pending, got ${invoice.payment_status}`);
    assert(invoice.invoice_type === "proforma", `expected invoice_type proforma, got ${invoice.invoice_type}`);

    return { name: "generate-monthly-invoices", ok: true };
  } finally {
    if (invoiceId) await pgDelete(env, "subscription_invoices", `id=eq.${invoiceId}`);
    if (subCreated) await pgDelete(env, "organization_subscriptions", `org_id=eq.${E2E_ORG_ID}`);
  }
}
