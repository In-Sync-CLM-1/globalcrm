import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const REMINDER_TEMPLATE_NAME = 'crm_activity_reminder';

async function sendReminderWhatsApp(
  supabase: any,
  userId: string,
  orgId: string,
  itemTitle: string,
  formattedDate: string
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, first_name, whatsapp_enabled')
      .eq('id', userId)
      .single();

    if (!profile?.phone) {
      console.log(`[NextActions/WA] user ${userId} has no phone — skipping WhatsApp`);
      return;
    }
    if (profile.whatsapp_enabled === false) {
      console.log(`[NextActions/WA] user ${userId} has whatsapp_enabled=false — skipping`);
      return;
    }

    const { data: settings } = await supabase
      .from('exotel_settings')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('whatsapp_enabled', true)
      .maybeSingle();
    if (!settings || !settings.waba_id) {
      console.log(`[NextActions/WA] org ${orgId} has no active WhatsApp Exotel settings — skipping`);
      return;
    }

    const { data: tpl } = await supabase
      .from('communication_templates')
      .select('template_id, status, language')
      .eq('org_id', orgId)
      .eq('template_name', REMINDER_TEMPLATE_NAME)
      .eq('template_type', 'whatsapp')
      .maybeSingle();
    if (!tpl) {
      console.log(`[NextActions/WA] template ${REMINDER_TEMPLATE_NAME} not found for org ${orgId}`);
      return;
    }
    if (tpl.status !== 'approved') {
      console.log(`[NextActions/WA] template ${REMINDER_TEMPLATE_NAME} status=${tpl.status} — not approved yet`);
      return;
    }

    let phone = String(profile.phone).replace(/[^0-9+]/g, '');
    if (!phone.startsWith('+')) {
      phone = phone.length === 10 ? '+91' + phone : '+' + phone;
    }

    const waApiKey = settings.whatsapp_api_key || settings.api_key;
    const waApiToken = settings.whatsapp_api_token || settings.api_token;
    const waSubdomain = settings.whatsapp_subdomain || settings.subdomain;
    const waAccountSid = settings.whatsapp_account_sid || settings.account_sid;
    const exotelUrl = `https://${waSubdomain}/v2/accounts/${waAccountSid}/messages`;
    const basicAuth = 'Basic ' + btoa(`${waApiKey}:${waApiToken}`);

    const params = [
      profile.first_name || 'there',
      itemTitle,
      formattedDate,
    ];

    const payload = {
      status_callback: `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`,
      whatsapp: {
        messages: [{
          from: settings.whatsapp_source_number,
          to: phone,
          content: {
            type: 'template',
            template: {
              name: REMINDER_TEMPLATE_NAME,
              language: tpl.language || 'en',
              components: [{
                type: 'body',
                parameters: params.map((p) => ({ type: 'text', text: String(p) })),
              }],
            },
          },
        }],
      },
    };

    const r = await fetch(exotelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basicAuth },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let result: any; try { result = JSON.parse(text); } catch { result = { raw: text }; }
    const msg = result?.response?.whatsapp?.messages?.[0];
    const ok = r.ok && msg?.code === 200;

    await supabase.from('whatsapp_messages').insert({
      org_id: orgId,
      contact_id: null,
      template_id: tpl.template_id,
      sent_by: userId,
      phone_number: phone,
      message_content: `Reminder: ${itemTitle} due ${formattedDate}`,
      template_variables: { '1': params[0], '2': params[1], '3': params[2] },
      status: ok ? 'sent' : 'failed',
      error_message: ok ? null : (msg?.error_data?.message || result?.message || `HTTP ${r.status}`),
      exotel_status_code: String(msg?.code ?? r.status),
      direction: 'outgoing',
    });

    console.log(`[NextActions/WA] sent reminder to user ${userId} (${phone}): ok=${ok}`);
  } catch (err) {
    console.error('[NextActions/WA] sendReminderWhatsApp failed:', err);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[NextActions] Starting next action check...');
    const supabase = getSupabaseClient();
    const now = new Date();
    
    // Get all organizations with their timezone settings
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, settings');
    
    if (orgsError) throw orgsError;
    
    let totalProcessed = 0;
    
    for (const org of orgs || []) {
      const timezone = org.settings?.timezone || 'UTC';
      console.log(`[NextActions] Processing org ${org.id} (timezone: ${timezone})`);
      
      // Get current time in org's timezone
      const orgNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const currentHour = orgNow.getHours();
      const currentMinutes = orgNow.getMinutes();
      
      // ========== MORNING REMINDERS (9 AM - Daily Digest) ==========
      if (currentHour === 9 && currentMinutes < 15) {
        const todayStart = new Date(orgNow);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(orgNow);
        todayEnd.setHours(23, 59, 59, 999);
        
        // Fetch morning activities
        const { data: morningActivities, error: morningError } = await supabase
          .from('contact_activities')
          .select(`
            id,
            org_id,
            contact_id,
            activity_type,
            subject,
            scheduled_at,
            next_action_date,
            next_action_notes,
            created_by,
            contacts(first_name, last_name, company, email, phone)
          `)
          .eq('org_id', org.id)
          .or(`scheduled_at.gte.${todayStart.toISOString()},next_action_date.gte.${todayStart.toISOString()}`)
          .or(`scheduled_at.lte.${todayEnd.toISOString()},next_action_date.lte.${todayEnd.toISOString()}`)
          .is('completed_at', null)
          .eq('morning_reminder_sent', false);
        
        if (morningError) {
          console.error(`[NextActions] Error fetching morning activities for org ${org.id}:`, morningError);
        } else {
          console.log(`[NextActions] Found ${morningActivities?.length || 0} morning activity reminders for org ${org.id}`);
          
          for (const activity of morningActivities || []) {
            await createActivityNotificationWithEmail(supabase, activity, 'morning', timezone);
            totalProcessed++;
          }
        }
        
        // Fetch morning tasks
        const { data: morningTasks, error: morningTasksError } = await supabase
          .from('tasks')
          .select(`
            id,
            org_id,
            title,
            description,
            due_date,
            priority,
            assigned_to,
            status
          `)
          .eq('org_id', org.id)
          .gte('due_date', todayStart.toISOString())
          .lte('due_date', todayEnd.toISOString())
          .neq('status', 'completed')
          .eq('morning_reminder_sent', false);
        
        if (morningTasksError) {
          console.error(`[NextActions] Error fetching morning tasks for org ${org.id}:`, morningTasksError);
        } else {
          console.log(`[NextActions] Found ${morningTasks?.length || 0} morning task reminders for org ${org.id}`);
          
          for (const task of morningTasks || []) {
            await createTaskNotificationWithEmail(supabase, task, 'morning', timezone);
            totalProcessed++;
          }
        }
      }
      
      // ========== 15-MINUTE REMINDERS (Pre-Action) ==========
      // Send reminder for activities due in 15-30 minutes that haven't received pre_action reminder
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
      const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
      
      console.log(`[NextActions] Checking 15-min window: ${fifteenMinutesFromNow.toISOString()} to ${thirtyMinutesFromNow.toISOString()}`);
      
      // Use a proper date range filter for pre-action reminders
      const { data: preActionActivities, error: preActionError } = await supabase
        .from('contact_activities')
        .select(`
          id,
          org_id,
          contact_id,
          activity_type,
          subject,
          scheduled_at,
          next_action_date,
          next_action_notes,
          created_by,
          contacts(first_name, last_name, company, email, phone)
        `)
        .eq('org_id', org.id)
        .is('completed_at', null)
        .eq('pre_action_reminder_sent', false)
        .or(`and(scheduled_at.gte.${fifteenMinutesFromNow.toISOString()},scheduled_at.lte.${thirtyMinutesFromNow.toISOString()}),and(next_action_date.gte.${fifteenMinutesFromNow.toISOString()},next_action_date.lte.${thirtyMinutesFromNow.toISOString()})`);
      
      if (preActionError) {
        console.error(`[NextActions] Error fetching pre-action activities for org ${org.id}:`, preActionError);
      } else {
        console.log(`[NextActions] Found ${preActionActivities?.length || 0} 15-min activity reminders for org ${org.id}`);
        
        for (const activity of preActionActivities || []) {
          await createActivityNotificationWithEmail(supabase, activity, 'pre_action', timezone);
          totalProcessed++;
        }
      }
      
      // Tasks due in 15-30 minutes
      const { data: preActionTasks, error: preActionTasksError } = await supabase
        .from('tasks')
        .select(`
          id,
          org_id,
          title,
          description,
          due_date,
          priority,
          assigned_to,
          status
        `)
        .eq('org_id', org.id)
        .neq('status', 'completed')
        .gte('due_date', fifteenMinutesFromNow.toISOString())
        .lte('due_date', thirtyMinutesFromNow.toISOString())
        .eq('pre_action_reminder_sent', false);
      
      if (preActionTasksError) {
        console.error(`[NextActions] Error fetching pre-action tasks for org ${org.id}:`, preActionTasksError);
      } else {
        console.log(`[NextActions] Found ${preActionTasks?.length || 0} 15-min task reminders for org ${org.id}`);
        
        for (const task of preActionTasks || []) {
          await createTaskNotificationWithEmail(supabase, task, 'pre_action', timezone);
          totalProcessed++;
        }
      }
      
      // ========== URGENT REMINDERS (Due within 15 minutes - but not overdue yet) ==========
      // Only send urgent reminder if reminder_sent is false AND pre_action was already sent (or skipped)
      console.log(`[NextActions] Checking urgent window: ${now.toISOString()} to ${fifteenMinutesFromNow.toISOString()}`);
      
      const { data: urgentActivities, error: urgentError } = await supabase
        .from('contact_activities')
        .select(`
          id,
          org_id,
          contact_id,
          activity_type,
          subject,
          scheduled_at,
          next_action_date,
          next_action_notes,
          created_by,
          reminder_sent,
          contacts(first_name, last_name, company, email, phone)
        `)
        .eq('org_id', org.id)
        .is('completed_at', null)
        .or(`and(scheduled_at.gte.${now.toISOString()},scheduled_at.lt.${fifteenMinutesFromNow.toISOString()}),and(next_action_date.gte.${now.toISOString()},next_action_date.lt.${fifteenMinutesFromNow.toISOString()})`);
      
      // Filter for activities that haven't received urgent reminder yet
      const filteredUrgent = (urgentActivities || []).filter((a: any) => !a.reminder_sent);
      
      if (urgentError) {
        console.error(`[NextActions] Error fetching urgent activities for org ${org.id}:`, urgentError);
      } else {
        console.log(`[NextActions] Found ${filteredUrgent.length} urgent activity reminders for org ${org.id}`);
        
        for (const activity of filteredUrgent) {
          await createActivityNotificationWithEmail(supabase, activity, 'urgent', timezone);
          totalProcessed++;
        }
      }
      
      // Urgent tasks - due in next 15 minutes
      const { data: urgentTasks, error: urgentTasksError } = await supabase
        .from('tasks')
        .select(`
          id,
          org_id,
          title,
          description,
          due_date,
          priority,
          assigned_to,
          status,
          reminder_sent
        `)
        .eq('org_id', org.id)
        .neq('status', 'completed')
        .gte('due_date', now.toISOString())
        .lt('due_date', fifteenMinutesFromNow.toISOString());
      
      // Filter for tasks that haven't received urgent reminder yet
      const filteredUrgentTasks = (urgentTasks || []).filter((t: any) => !t.reminder_sent);
      
      if (urgentTasksError) {
        console.error(`[NextActions] Error fetching urgent tasks for org ${org.id}:`, urgentTasksError);
      } else {
        console.log(`[NextActions] Found ${filteredUrgentTasks.length} urgent task reminders for org ${org.id}`);
        
        for (const task of filteredUrgentTasks) {
          await createTaskNotificationWithEmail(supabase, task, 'urgent', timezone);
          totalProcessed++;
        }
      }
      
      // ========== OVERDUE REMINDERS ==========
      // Only send overdue reminder once - when activity becomes overdue (first 30 mins after due time)
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const { data: overdueActivities, error: overdueError } = await supabase
        .from('contact_activities')
        .select(`
          id,
          org_id,
          contact_id,
          activity_type,
          subject,
          scheduled_at,
          next_action_date,
          next_action_notes,
          created_by,
          reminder_sent,
          contacts(first_name, last_name, company, email, phone)
        `)
        .eq('org_id', org.id)
        .is('completed_at', null)
        .or(`and(scheduled_at.lt.${now.toISOString()},scheduled_at.gt.${twentyFourHoursAgo.toISOString()}),and(next_action_date.lt.${now.toISOString()},next_action_date.gt.${twentyFourHoursAgo.toISOString()})`);
      
      // Only include activities that haven't been marked as reminded yet
      const filteredOverdue = (overdueActivities || []).filter((a: any) => !a.reminder_sent);
      
      if (overdueError) {
        console.error(`[NextActions] Error fetching overdue activities for org ${org.id}:`, overdueError);
      } else {
        console.log(`[NextActions] Found ${filteredOverdue.length} overdue activity reminders for org ${org.id}`);
        
        for (const activity of filteredOverdue) {
          await createActivityNotificationWithEmail(supabase, activity, 'overdue', timezone);
          totalProcessed++;
        }
      }
      
      // Overdue tasks - past due but within last 24 hours
      const { data: overdueTasks, error: overdueTasksError } = await supabase
        .from('tasks')
        .select(`
          id,
          org_id,
          title,
          description,
          due_date,
          priority,
          assigned_to,
          status,
          reminder_sent
        `)
        .eq('org_id', org.id)
        .neq('status', 'completed')
        .lt('due_date', now.toISOString())
        .gt('due_date', twentyFourHoursAgo.toISOString());
      
      // Filter for tasks that haven't been reminded yet
      const filteredOverdueTasks = (overdueTasks || []).filter((t: any) => !t.reminder_sent);
      
      if (overdueTasksError) {
        console.error(`[NextActions] Error fetching overdue tasks for org ${org.id}:`, overdueTasksError);
      } else {
        console.log(`[NextActions] Found ${filteredOverdueTasks.length} overdue task reminders for org ${org.id}`);
        
        for (const task of filteredOverdueTasks) {
          await createTaskNotificationWithEmail(supabase, task, 'overdue', timezone);
          totalProcessed++;
        }
      }
    }
    
    console.log(`[NextActions] Successfully processed ${totalProcessed} notifications`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: totalProcessed,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[NextActions] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function createActivityNotificationWithEmail(
  supabase: any, 
  activity: any, 
  type: 'morning' | 'pre_action' | 'overdue' | 'urgent', 
  timezone: string
) {
  // CHECK FOR EXISTING NOTIFICATION FIRST to prevent duplicates
  const { data: existingNotification } = await supabase
    .from('notifications')
    .select('id')
    .eq('entity_id', activity.id)
    .eq('entity_type', 'contact_activity')
    .eq('is_read', false)
    .maybeSingle();
  
  if (existingNotification) {
    console.log(`[NextActions] Notification already exists for activity ${activity.id}, skipping...`);
    // Still mark as reminded to prevent future duplicates
    const updateField = type === 'morning' ? 'morning_reminder_sent' 
      : type === 'pre_action' ? 'pre_action_reminder_sent' 
      : 'reminder_sent';
    await supabase.from('contact_activities').update({ [updateField]: true }).eq('id', activity.id);
    return;
  }

  const contact = activity.contacts;
  const contactName = contact 
    ? `${contact.first_name} ${contact.last_name || ''}`.trim() || contact.company || 'Unknown'
    : 'Unknown';
  
  const actionDate = new Date(activity.scheduled_at || activity.next_action_date);
  const formattedDate = actionDate.toLocaleString('en-US', { 
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Get user email for sending notification
  const { data: userProfile, error: userError } = await supabase
    .from('profiles')
    .select('email, first_name')
    .eq('id', activity.created_by)
    .single();
  
  if (userError) {
    console.error(`[NextActions] Failed to fetch user profile for ${activity.created_by}:`, userError);
  }
  
  const notificationType = type === 'morning' ? 'next_action_morning' : 'next_action_urgent';
  const title = type === 'morning' 
    ? `📅 Today's Activity: ${contactName}`
    : type === 'overdue'
    ? `⚠️ Overdue: ${contactName}`
    : type === 'urgent'
    ? `🔔 Starting NOW: ${contactName}`
    : `🔔 In 15 mins: ${contactName}`;
  
  const notification = {
    org_id: activity.org_id,
    user_id: activity.created_by,
    type: notificationType,
    title: title,
    message: activity.next_action_notes || activity.subject
      ? `${formattedDate} - ${activity.next_action_notes || activity.subject}`
      : `${activity.activity_type} at ${formattedDate}`,
    entity_type: 'contact_activity',
    entity_id: activity.id,
    action_url: `/contacts/${activity.contact_id}`,
    metadata: {
      activity_type: activity.activity_type,
      subject: activity.subject,
      scheduled_at: activity.scheduled_at,
      next_action_date: activity.next_action_date,
      reminder_type: type,
      contact_name: contactName,
      contact_phone: contact?.phone || null,
      contact_email: contact?.email || null,
      contact_company: contact?.company || null,
      is_callback_reminder: true,
      is_overdue: type === 'overdue',
    },
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  
  const { error: insertError } = await supabase
    .from('notifications')
    .insert(notification);
  
  if (insertError) {
    console.error(`[NextActions] Failed to create ${type} notification for activity ${activity.id}:`, insertError);
    return;
  }
  
  console.log(`[NextActions] Created ${type} notification for activity ${activity.id}`);
  
  // Send email notification if user has email and RESEND_API_KEY is configured
  if (userProfile?.email && RESEND_API_KEY) {
    try {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://app.in-sync.io';
      const contactUrl = `${siteUrl}/contacts/${activity.contact_id}`;
      
      const emailSubject = type === 'morning' 
        ? `📅 Today's Activity: ${contactName}`
        : type === 'overdue'
        ? `⚠️ Overdue Activity: ${contactName}`
        : type === 'urgent'
        ? `🔔 Starting NOW: ${contactName}`
        : `🔔 In 15 minutes: ${contactName}`;
      
      const headerColor = type === 'overdue' ? '#ef4444' : type === 'urgent' ? '#f59e0b' : '#14b8a6';
      const headerGradient = type === 'overdue' 
        ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
        : type === 'urgent'
        ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
        : 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)';
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <div style="background: ${headerGradient}; padding: 24px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
                ${type === 'morning' ? '📅 Activity Reminder' : type === 'overdue' ? '⚠️ Overdue Activity' : type === 'urgent' ? '🔔 Starting Now!' : '🔔 15-Minute Reminder'}
              </h1>
            </div>
            
            <div style="padding: 32px;">
              <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">
                Hi ${userProfile.first_name || 'there'},
              </p>
              
              <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">
                ${type === 'morning' 
                  ? 'You have an activity scheduled for today:'
                  : type === 'overdue'
                  ? 'You have an overdue activity that needs attention:'
                  : type === 'urgent'
                  ? 'Your activity is starting now:'
                  : 'Your activity starts in 15 minutes:'}
              </p>
              
              <div style="background-color: ${type === 'overdue' ? '#fef2f2' : type === 'urgent' ? '#fffbeb' : '#f0fdfa'}; border-left: 4px solid ${headerColor}; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                <h2 style="color: ${type === 'overdue' ? '#991b1b' : type === 'urgent' ? '#92400e' : '#0f766e'}; margin: 0 0 12px; font-size: 20px;">
                  ${contactName}
                </h2>
                <p style="color: #374151; margin: 0 0 8px;"><strong>Activity:</strong> ${activity.activity_type}${activity.subject ? ` - ${activity.subject}` : ''}</p>
                ${contact?.company ? `<p style="color: #374151; margin: 0 0 8px;"><strong>Company:</strong> ${contact.company}</p>` : ''}
                ${contact?.phone ? `<p style="color: #374151; margin: 0 0 8px;"><strong>Phone:</strong> <a href="tel:${contact.phone}" style="color: ${headerColor};">${contact.phone}</a></p>` : ''}
                ${contact?.email ? `<p style="color: #374151; margin: 0 0 8px;"><strong>Email:</strong> <a href="mailto:${contact.email}" style="color: ${headerColor};">${contact.email}</a></p>` : ''}
                <p style="color: #374151; margin: 16px 0 0;"><strong>Scheduled Time:</strong> ${formattedDate}</p>
                ${activity.next_action_notes ? `<p style="color: #6b7280; margin: 8px 0 0; font-style: italic;">"${activity.next_action_notes}"</p>` : ''}
              </div>
              
              <div style="text-align: center; margin-top: 32px;">
                <a href="${contactUrl}" style="display: inline-block; background: ${headerGradient}; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                  View Contact
                </a>
              </div>
            </div>
            
            <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 14px; margin: 0;">
                This is an automated reminder from In-Sync CRM
              </p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "In-Sync CRM <notifications@globalcrm.in-sync.co.in>",
          to: [userProfile.email],
          subject: emailSubject,
          html: emailHtml,
        }),
      });
      
      if (!emailResponse.ok) {
        const errorData = await emailResponse.text();
        console.error(`[NextActions] Failed to send email to ${userProfile.email}:`, errorData);
      } else {
        console.log(`[NextActions] Email sent to ${userProfile.email} for activity ${activity.id}`);
      }
    } catch (emailErr) {
      console.error(`[NextActions] Email sending failed:`, emailErr);
    }
  } else if (!RESEND_API_KEY) {
    console.log(`[NextActions] Skipping email - RESEND_API_KEY not configured`);
  }

  // WhatsApp reminder
  await sendReminderWhatsApp(
    supabase,
    activity.created_by,
    activity.org_id,
    `${contactName} — ${activity.activity_type}${activity.subject ? `: ${activity.subject}` : ''}`,
    formattedDate
  );

  // Mark as reminded - use reminder_sent for both urgent and overdue to prevent duplicates
  const updateField = type === 'morning' 
    ? 'morning_reminder_sent' 
    : (type === 'urgent' || type === 'overdue')
    ? 'reminder_sent' 
    : 'pre_action_reminder_sent';
  const { error: updateError } = await supabase
    .from('contact_activities')
    .update({ [updateField]: true })
    .eq('id', activity.id);
  
  if (updateError) {
    console.error(`[NextActions] Failed to mark activity ${activity.id} as reminded:`, updateError);
  } else {
    console.log(`[NextActions] Marked activity ${activity.id} as ${updateField}=true`);
  }
}

async function createTaskNotificationWithEmail(
  supabase: any, 
  task: any, 
  type: 'morning' | 'pre_action' | 'overdue' | 'urgent', 
  timezone: string
) {
  const dueDate = new Date(task.due_date);
  const formattedDate = dueDate.toLocaleString('en-US', { 
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Get user email for sending notification
  const { data: userProfile, error: userError } = await supabase
    .from('profiles')
    .select('email, first_name')
    .eq('id', task.assigned_to)
    .single();
  
  if (userError) {
    console.error(`[NextActions] Failed to fetch user profile for ${task.assigned_to}:`, userError);
  }
  
  const notificationType = type === 'morning' ? 'task_morning' : 'task_urgent';
  const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
  const title = type === 'morning' 
    ? `📋 Today's Task: ${task.title}`
    : type === 'overdue'
    ? `⚠️ Overdue Task: ${task.title}`
    : type === 'urgent'
    ? `🔔 Task Due NOW: ${task.title}`
    : `🔔 Task Due in 15 mins: ${task.title}`;
  
  const notification = {
    org_id: task.org_id,
    user_id: task.assigned_to,
    type: notificationType,
    title: title,
    message: `${priorityEmoji} ${task.priority?.toUpperCase() || 'NORMAL'} priority - Due: ${formattedDate}`,
    entity_type: 'task',
    entity_id: task.id,
    action_url: `/tasks`,
    metadata: {
      task_title: task.title,
      task_description: task.description,
      due_date: task.due_date,
      priority: task.priority,
      reminder_type: type,
      is_overdue: type === 'overdue',
    },
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  
  const { error: insertError } = await supabase
    .from('notifications')
    .insert(notification);
  
  if (insertError) {
    console.error(`[NextActions] Failed to create ${type} notification for task ${task.id}:`, insertError);
    return;
  }
  
  console.log(`[NextActions] Created ${type} notification for task ${task.id}`);
  
  // Send email notification if user has email and RESEND_API_KEY is configured
  if (userProfile?.email && RESEND_API_KEY) {
    try {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://app.in-sync.io';
      const taskUrl = `${siteUrl}/tasks`;
      
      const emailSubject = type === 'morning' 
        ? `📋 Today's Task: ${task.title}`
        : type === 'overdue'
        ? `⚠️ Overdue Task: ${task.title}`
        : type === 'urgent'
        ? `🔔 Task Due NOW: ${task.title}`
        : `🔔 Task Due in 15 minutes: ${task.title}`;
      
      const headerColor = type === 'overdue' ? '#ef4444' : type === 'urgent' ? '#f59e0b' : '#6366f1';
      const headerGradient = type === 'overdue' 
        ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
        : type === 'urgent'
        ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
        : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)';
      
      const priorityBadge = task.priority === 'high' 
        ? '<span style="background-color: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600;">HIGH PRIORITY</span>'
        : task.priority === 'medium'
        ? '<span style="background-color: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600;">MEDIUM PRIORITY</span>'
        : '<span style="background-color: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600;">LOW PRIORITY</span>';
      
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <div style="background: ${headerGradient}; padding: 24px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
                ${type === 'morning' ? '📋 Task Reminder' : type === 'overdue' ? '⚠️ Overdue Task' : type === 'urgent' ? '🔔 Task Due Now!' : '🔔 15-Minute Reminder'}
              </h1>
            </div>
            
            <div style="padding: 32px;">
              <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">
                Hi ${userProfile.first_name || 'there'},
              </p>
              
              <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">
                ${type === 'morning' 
                  ? 'You have a task due today:'
                  : type === 'overdue'
                  ? 'You have an overdue task that needs attention:'
                  : type === 'urgent'
                  ? 'Your task is due now:'
                  : 'Your task is due in 15 minutes:'}
              </p>
              
              <div style="background-color: ${type === 'overdue' ? '#fef2f2' : type === 'urgent' ? '#fffbeb' : '#eef2ff'}; border-left: 4px solid ${headerColor}; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                <div style="margin-bottom: 12px;">
                  ${priorityBadge}
                </div>
                <h2 style="color: ${type === 'overdue' ? '#991b1b' : type === 'urgent' ? '#92400e' : '#3730a3'}; margin: 0 0 12px; font-size: 20px;">
                  ${task.title}
                </h2>
                ${task.description ? `<p style="color: #374151; margin: 0 0 16px;">${task.description}</p>` : ''}
                <p style="color: #374151; margin: 0;"><strong>Due:</strong> ${formattedDate}</p>
              </div>
              
              <div style="text-align: center; margin-top: 32px;">
                <a href="${taskUrl}" style="display: inline-block; background: ${headerGradient}; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                  View Tasks
                </a>
              </div>
            </div>
            
            <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 14px; margin: 0;">
                This is an automated reminder from In-Sync CRM
              </p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "In-Sync CRM <notifications@globalcrm.in-sync.co.in>",
          to: [userProfile.email],
          subject: emailSubject,
          html: emailHtml,
        }),
      });
      
      if (!emailResponse.ok) {
        const errorData = await emailResponse.text();
        console.error(`[NextActions] Failed to send email to ${userProfile.email}:`, errorData);
      } else {
        console.log(`[NextActions] Email sent to ${userProfile.email} for task ${task.id}`);
      }
    } catch (emailErr) {
      console.error(`[NextActions] Email sending failed:`, emailErr);
    }
  } else if (!RESEND_API_KEY) {
    console.log(`[NextActions] Skipping email - RESEND_API_KEY not configured`);
  }

  // WhatsApp reminder for tasks
  await sendReminderWhatsApp(
    supabase,
    task.assigned_to,
    task.org_id,
    task.title,
    formattedDate
  );

  // Mark as reminded - use reminder_sent for both urgent and overdue to prevent duplicates
  const updateField = type === 'morning'
    ? 'morning_reminder_sent'
    : (type === 'urgent' || type === 'overdue')
    ? 'reminder_sent'
    : 'pre_action_reminder_sent';
  const { error: updateError } = await supabase
    .from('tasks')
    .update({ [updateField]: true })
    .eq('id', task.id);
  
  if (updateError) {
    console.error(`[NextActions] Failed to mark task ${task.id} as reminded:`, updateError);
  } else {
    console.log(`[NextActions] Marked task ${task.id} as ${updateField}=true`);
  }
}
