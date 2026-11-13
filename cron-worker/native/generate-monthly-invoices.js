// Native port of supabase/functions/generate-monthly-invoices/index.ts.
import { pgSelect, pgSelectOne, pgRpc, pgInsert, invokeFunction } from "./_lib/postgrest.js";

// Billing is anchored to each org's OWN payment date, not a shared calendar
// cycle -- their first subscription payment sets the start date, and it's
// due again exactly one month later, then one month after that, and so on
// (organization_subscriptions.next_billing_date, advanced by record-offline-
// payment / verify-razorpay-payment at each payment). This generator's only
// job is: has an org's own due date arrived, and if so, has that cycle's
// invoice already been issued.
//
// There used to be a SEPARATE fixed calendar-month cycle here (generate on
// the 1st, due the 10th, same for every org regardless of when they actually
// paid) which is exactly what this replaces. That produced two independent,
// disagreeing "due dates" per org and actively mis-invoiced real clients --
// IEDUP (paid 30 Jun, real due date 30 Jul) got billed by the calendar cycle
// instead, and Fervent (paid 25 Jul, real due date 25 Aug) got a bogus 10 Aug
// bill that would have falsely locked an account that had already paid
// ahead. Trusting next_billing_date as the single source of the due date
// removes that whole class of bug.
//
// orgIdFilter is ONLY ever set by the e2e check (via a POST body), so it can
// prove the real invoice-generation logic against the isolated test org
// without touching every real client's billing outside its own schedule.
// scheduled() never passes it -- the real cron always processes every org
// whose own due date has arrived, unchanged from the original.
async function tick(env, orgIdFilter) {
  const pricingRaw = await pgRpc(env, "get_active_pricing", {});
  const pricing = Array.isArray(pricingRaw) ? pricingRaw[0] : pricingRaw;
  if (!pricing) throw new Error("get_active_pricing returned no row");

  const todayStr = new Date().toISOString().split("T")[0];
  const orgFilterQs = orgIdFilter ? `&org_id=eq.${orgIdFilter}` : "";
  // Only orgs whose own due date has actually arrived (or already passed --
  // an org that's gone unpaid for a while must keep showing as overdue on
  // that same original due date, not get a fresh later one just because a
  // new calendar month started).
  const subscriptions = await pgSelect(env, "organization_subscriptions",
    `subscription_status=eq.active&next_billing_date=lte.${todayStr}${orgFilterQs}&select=org_id,user_count,monthly_subscription_amount,last_payment_date,next_billing_date`);

  let generatedCount = 0;

  for (const sub of subscriptions || []) {
    try {
      const dueDateStr = sub.next_billing_date;

      // Internal/demo orgs are never billed.
      const org = await pgSelectOne(env, "organizations", `id=eq.${sub.org_id}&select=is_internal`);
      if (org?.is_internal) continue;

      // Already issued for this org's current due date? A cancelled invoice
      // (a past billing mistake voided by an admin) must NOT count as
      // "already invoiced" -- otherwise the org silently never gets billed
      // for that cycle at all.
      const existingInvoice = await pgSelectOne(env, "subscription_invoices",
        `org_id=eq.${sub.org_id}&invoice_type=eq.proforma&due_date=eq.${dueDateStr}&payment_status=neq.cancelled&select=id&limit=1`);
      if (existingInvoice) continue;

      const baseAmount = sub.monthly_subscription_amount;
      const gstAmount = baseAmount * (pricing.gst_percentage / 100);
      const totalAmount = baseAmount + gstAmount;

      const invoiceNumber = `PRO-${dueDateStr.replace(/-/g, "")}-${sub.org_id.substring(0, 8).toUpperCase()}`;
      const periodStartStr = sub.last_payment_date ? sub.last_payment_date.split("T")[0] : dueDateStr;

      await pgInsert(env, "subscription_invoices", {
        org_id: sub.org_id, invoice_number: invoiceNumber,
        invoice_date: todayStr, due_date: dueDateStr,
        billing_period_start: periodStartStr, billing_period_end: dueDateStr,
        base_subscription_amount: baseAmount, subtotal: baseAmount, gst_amount: gstAmount, total_amount: totalAmount,
        payment_status: "pending", invoice_type: "proforma", billing_period: "monthly", user_count: sub.user_count || 0,
      });

      generatedCount++;

      await invokeFunction(env, "send-subscription-email", {
        org_id: sub.org_id, notification_type: "invoice_generated",
        invoice_number: invoiceNumber, amount: totalAmount, due_date: dueDateStr,
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
