// Native port of supabase/functions/scheduled-messages-processor/index.ts.
import { pgSelect, pgSelectOne, pgPatch, pgRpc, invokeFunction } from "./_lib/postgrest.js";

async function tick(env) {
  const nowIso = new Date().toISOString();
  let emailCampaigns = [], whatsappCampaigns = [], emailConversations = [], whatsappMessages = [], activities = [];

  // Due email campaigns.
  try {
    emailCampaigns = await pgSelect(env, "email_bulk_campaigns", `status=eq.scheduled&scheduled_at=lte.${nowIso}&select=*`);
    for (const campaign of emailCampaigns || []) {
      await pgPatch(env, "email_bulk_campaigns", `id=eq.${campaign.id}`, { status: "sending", started_at: new Date().toISOString() });
      const { error } = await invokeFunction(env, "send-bulk-email", { campaignId: campaign.id });
      if (error) console.error(`Error invoking send-bulk-email for campaign ${campaign.id}:`, String(error.message || error));
    }
  } catch (e) { console.error("Error fetching email campaigns:", String(e)); }

  // Due WhatsApp campaigns.
  try {
    whatsappCampaigns = await pgSelect(env, "whatsapp_bulk_campaigns", `status=eq.scheduled&scheduled_at=lte.${nowIso}&select=*`);
    for (const campaign of whatsappCampaigns || []) {
      await pgPatch(env, "whatsapp_bulk_campaigns", `id=eq.${campaign.id}`, { status: "processing", started_at: new Date().toISOString() });
      const { error } = await invokeFunction(env, "bulk-whatsapp-sender", { campaignId: campaign.id, skip_rate_limit: true });
      if (error) console.error(`Error invoking bulk-whatsapp-sender for campaign ${campaign.id}:`, String(error.message || error));
    }
  } catch (e) { console.error("Error fetching WhatsApp campaigns:", String(e)); }

  // Due individual email conversations.
  try {
    emailConversations = await pgSelect(env, "email_conversations", `status=eq.scheduled&scheduled_at=lte.${nowIso}&limit=50&select=*`);
    for (const email of emailConversations || []) {
      await pgPatch(env, "email_conversations", `id=eq.${email.id}`, { status: "pending" });
      const { error } = await invokeFunction(env, "send-email", {
        to: email.to_email, subject: email.subject, htmlContent: email.html_content || email.email_content, contactId: email.contact_id,
      });
      if (error) {
        console.error(`Error sending scheduled email ${email.id}:`, String(error.message || error));
        await pgPatch(env, "email_conversations", `id=eq.${email.id}`, { status: "failed" });
      }
    }
  } catch (e) { console.error("Error fetching email conversations:", String(e)); }

  // Due individual WhatsApp messages.
  try {
    whatsappMessages = await pgSelect(env, "whatsapp_messages", `status=eq.scheduled&scheduled_at=lte.${nowIso}&limit=50&select=*`);
    for (const message of whatsappMessages || []) {
      await pgPatch(env, "whatsapp_messages", `id=eq.${message.id}`, { status: "pending" });
      const payload = { contactId: message.contact_id, phoneNumber: message.phone_number.replace(/[^\d]/g, "") };
      if (message.template_id) { payload.templateId = message.template_id; payload.templateVariables = {}; }
      else { payload.message = message.message_content; }
      const { error } = await invokeFunction(env, "send-whatsapp-message", payload);
      if (error) {
        console.error(`Error sending scheduled WhatsApp message ${message.id}:`, String(error.message || error));
        await pgPatch(env, "whatsapp_messages", `id=eq.${message.id}`, { status: "failed" });
      }
    }
  } catch (e) { console.error("Error fetching WhatsApp messages:", String(e)); }

  // 30-minute activity reminders.
  try {
    const from = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 35 * 60 * 1000).toISOString();
    activities = await pgSelect(env, "contact_activities",
      `activity_type=in.(meeting,call,task)&reminder_sent=eq.false&scheduled_at=not.is.null&scheduled_at=gte.${from}&scheduled_at=lte.${to}` +
      `&select=*,activity_participants(email,name),profiles:created_by(first_name,last_name),contacts!contact_activities_contact_id_fkey(email,first_name,last_name)`);

    if (activities && activities.length > 0) {
      const pricing = await pgSelectOne(env, "subscription_pricing", "is_active=eq.true&select=email_cost_per_unit&limit=1");
      const RESEND_API_KEY = env.RESEND_API_KEY;

      for (const activity of activities) {
        try {
          let recipients = [];
          if (activity.activity_type === "meeting" && activity.activity_participants?.length > 0) {
            recipients = activity.activity_participants;
          } else if (activity.contacts?.email) {
            recipients = [{ email: activity.contacts.email, name: `${activity.contacts.first_name} ${activity.contacts.last_name || ""}`.trim() }];
          }
          if (recipients.length === 0) continue;

          const activityType = activity.activity_type.charAt(0).toUpperCase() + activity.activity_type.slice(1);
          const scheduledDate = new Date(activity.scheduled_at);
          const formattedDate = scheduledDate.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" });

          const meetingLink = activity.meeting_link ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${activity.meeting_link}"
                 style="background: #4285F4; color: white; padding: 15px 40px;
                        text-decoration: none; border-radius: 4px; font-size: 16px;
                        font-weight: bold; display: inline-block;">
                Join Meeting
              </a>
            </div>
          ` : "";

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 20px; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #92400E;">⏰ Reminder: ${activityType} in 30 minutes</h2>
              </div>

              <p>This is a reminder that your ${activity.activity_type} is starting soon.</p>

              <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">${activity.subject || activityType}</h3>
                <p><strong>When:</strong> ${formattedDate}</p>
                ${activity.meeting_duration_minutes ? `<p><strong>Duration:</strong> ${activity.meeting_duration_minutes} minutes</p>` : ""}
                ${activity.profiles ? `<p><strong>Organized by:</strong> ${activity.profiles.first_name} ${activity.profiles.last_name || ""}</p>` : ""}
              </div>

              ${meetingLink}

              ${activity.description ? `
                <div style="margin: 20px 0;">
                  <h4>Details:</h4>
                  <p>${activity.description}</p>
                </div>
              ` : ""}
            </div>
          `;

          for (const recipient of recipients) {
            try {
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: "In-Sync Reminders <notifications@globalcrm.in-sync.co.in>", to: recipient.email,
                  subject: `Reminder: ${activity.activity_type} in 30 minutes - ${activity.subject || "Activity"}`,
                  html: emailHtml,
                }),
              });

              if (pricing) {
                await pgRpc(env, "deduct_from_wallet", {
                  _org_id: activity.org_id, _amount: pricing.email_cost_per_unit, _service_type: "email",
                  _reference_id: activity.id, _quantity: 1, _unit_cost: pricing.email_cost_per_unit, _user_id: activity.created_by,
                });
              }
            } catch (emailError) { console.error(`Failed to send reminder to ${recipient.email}:`, String(emailError)); }
          }

          await pgPatch(env, "contact_activities", `id=eq.${activity.id}`, { reminder_sent: true });
        } catch (activityError) { console.error(`Error processing activity ${activity.id}:`, String(activityError)); }
      }
    }
  } catch (e) { console.error("Error fetching activities for reminders:", String(e)); }

  // In-app activity reminders.
  try {
    await pgRpc(env, "create_activity_reminders", {});
  } catch (e) { console.error("[Processor] Failed to create activity reminders:", String(e)); }

  return {
    success: true,
    processed: {
      emailCampaigns: emailCampaigns?.length || 0,
      whatsappCampaigns: whatsappCampaigns?.length || 0,
      emailConversations: emailConversations?.length || 0,
      whatsappMessages: whatsappMessages?.length || 0,
      activityReminders: activities?.length || 0,
    },
  };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
  async fetch(_req, env) {
    let out;
    try { out = await tick(env); } catch (e) { out = { success: false, error: String(e && e.stack || e) }; }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  },
};
