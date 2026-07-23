// Native port of supabase/functions/generate-monthly-invoices/index.ts.
import { pgSelect, pgSelectOne, pgRpc, pgInsert, invokeFunction } from "./_lib/postgrest.js";

// orgIdFilter is ONLY ever set by the e2e check (via a POST body), so it can
// prove the real invoice-generation logic against the isolated test org
// without touching every real client's billing outside the normal monthly
// schedule. scheduled() never passes it -- the real cron always processes
// every active org, unchanged from the original.
async function tick(env, orgIdFilter) {
  const pricingRaw = await pgRpc(env, "get_active_pricing", {});
  const pricing = Array.isArray(pricingRaw) ? pricingRaw[0] : pricingRaw;
  if (!pricing) throw new Error("get_active_pricing returned no row");

  const orgFilterQs = orgIdFilter ? `&org_id=eq.${orgIdFilter}` : "";
  const subscriptions = await pgSelect(env, "organization_subscriptions",
    `subscription_status=eq.active${orgFilterQs}&select=org_id,user_count,monthly_subscription_amount`);

  let generatedCount = 0;
  const now = new Date();
  const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const dueDate = new Date(now.getFullYear(), now.getMonth(), 10); // Due on 10th

  for (const sub of subscriptions || []) {
    try {
      const billingPeriod = "monthly";
      const bpStartStr = billingPeriodStart.toISOString().split("T")[0];

      const existingInvoice = await pgSelectOne(env, "subscription_invoices",
        `org_id=eq.${sub.org_id}&invoice_type=eq.proforma&billing_period_start=eq.${bpStartStr}&select=id&limit=1`);

      if (existingInvoice) continue;

      const baseAmount = sub.monthly_subscription_amount;
      const gstAmount = baseAmount * (pricing.gst_percentage / 100);
      const totalAmount = baseAmount + gstAmount;

      const invoiceNumber = `PRO-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, "0")}-${sub.org_id.substring(0, 8).toUpperCase()}`;

      await pgInsert(env, "subscription_invoices", {
        org_id: sub.org_id, invoice_number: invoiceNumber,
        invoice_date: now.toISOString().split("T")[0], due_date: dueDate.toISOString().split("T")[0],
        billing_period_start: bpStartStr, billing_period_end: billingPeriodEnd.toISOString().split("T")[0],
        base_subscription_amount: baseAmount, subtotal: baseAmount, gst_amount: gstAmount, total_amount: totalAmount,
        payment_status: "pending", invoice_type: "proforma", billing_period: billingPeriod, user_count: sub.user_count || 0,
      });

      generatedCount++;

      await invokeFunction(env, "send-subscription-email", {
        org_id: sub.org_id, notification_type: "invoice_generated",
        invoice_number: invoiceNumber, amount: totalAmount, due_date: dueDate.toISOString().split("T")[0],
      });
    } catch (error) {
      console.error(`Error processing subscription for org ${sub.org_id}:`, String(error));
    }
  }

  return { success: true, generated: generatedCount };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(req, env) {
    let orgIdFilter = null;
    try { const body = req.method === "POST" ? await req.json() : {}; if (typeof body.e2e_org_id === "string") orgIdFilter = body.e2e_org_id; } catch { /* default */ }
    let out;
    try { out = await tick(env, orgIdFilter); } catch (e) { out = { success: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
