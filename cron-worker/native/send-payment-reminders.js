// Native port of supabase/functions/send-payment-reminders/index.ts.
import { pgSelect, pgSelectOne, invokeFunction } from "./_lib/postgrest.js";

async function tick(env) {
  const today = new Date();

  const invoices = await pgSelect(env, "subscription_invoices",
    "payment_status=in.(pending,overdue)&order=due_date.asc&select=id,org_id,invoice_number,total_amount,due_date,payment_status");

  let remindersSent = 0;

  for (const invoice of invoices || []) {
    try {
      const dueDate = new Date(invoice.due_date);
      const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      let shouldSendReminder = false;
      let notificationType = "";

      if (daysUntilDue === 3) { notificationType = "payment_reminder"; shouldSendReminder = true; }
      else if (daysUntilDue === 1) { notificationType = "payment_reminder"; shouldSendReminder = true; }
      else if (daysUntilDue === 0) { notificationType = "payment_reminder"; shouldSendReminder = true; }
      else if (daysUntilDue < 0 && invoice.payment_status === "overdue") {
        if (daysUntilDue === -2) { notificationType = "service_suspension_warning"; shouldSendReminder = true; }
        else if (daysUntilDue === -5) { notificationType = "service_suspension_warning"; shouldSendReminder = true; }
        else if (daysUntilDue === -9) { notificationType = "service_suspension_final"; shouldSendReminder = true; }
      }

      if (shouldSendReminder) {
        const todayDate = today.toISOString().split("T")[0];
        const existingNotif = await pgSelectOne(env, "subscription_notifications",
          `org_id=eq.${invoice.org_id}&notification_type=eq.${notificationType}&created_at=gte.${todayDate}&select=id&limit=1`);

        if (!existingNotif) {
          await invokeFunction(env, "send-subscription-email", {
            org_id: invoice.org_id, notification_type: notificationType,
            invoice_number: invoice.invoice_number, amount: invoice.total_amount, due_date: invoice.due_date,
          });
          remindersSent++;
        }
      }
    } catch (error) {
      console.error(`Error processing invoice ${invoice.id}:`, String(error));
    }
  }

  return { success: true, sent: remindersSent };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { success: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
