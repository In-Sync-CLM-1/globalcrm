import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = getSupabaseClient();

    console.log('Starting scheduled messages processor...');

    // Find due email campaigns
    const { data: emailCampaigns, error: emailCampaignsError } = await supabaseClient
      .from('email_bulk_campaigns')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString());

    if (emailCampaignsError) {
      console.error('Error fetching email campaigns:', emailCampaignsError);
    } else if (emailCampaigns && emailCampaigns.length > 0) {
      console.log(`Found ${emailCampaigns.length} due email campaigns`);
      
      for (const campaign of emailCampaigns) {
        console.log(`Processing email campaign: ${campaign.id}`);
        
        // Update status to sending
        await supabaseClient
          .from('email_bulk_campaigns')
          .update({ 
            status: 'sending', 
            started_at: new Date().toISOString() 
          })
          .eq('id', campaign.id);

        // Invoke send-bulk-email function
        const { error: invokeError } = await supabaseClient.functions.invoke('send-bulk-email', {
          body: { campaignId: campaign.id },
        });

        if (invokeError) {
          console.error(`Error invoking send-bulk-email for campaign ${campaign.id}:`, invokeError);
        } else {
          console.log(`Successfully triggered send-bulk-email for campaign ${campaign.id}`);
        }
      }
    }

    // Find due WhatsApp campaigns
    const { data: whatsappCampaigns, error: whatsappCampaignsError } = await supabaseClient
      .from('whatsapp_bulk_campaigns')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString());

    if (whatsappCampaignsError) {
      console.error('Error fetching WhatsApp campaigns:', whatsappCampaignsError);
    } else if (whatsappCampaigns && whatsappCampaigns.length > 0) {
      console.log(`Found ${whatsappCampaigns.length} due WhatsApp campaigns`);
      
      for (const campaign of whatsappCampaigns) {
        console.log(`Processing WhatsApp campaign: ${campaign.id}`);
        
        // Update status to processing
        await supabaseClient
          .from('whatsapp_bulk_campaigns')
          .update({ 
            status: 'processing', 
            started_at: new Date().toISOString() 
          })
          .eq('id', campaign.id);

        // Invoke bulk-whatsapp-sender function
        const { error: invokeError } = await supabaseClient.functions.invoke('bulk-whatsapp-sender', {
          body: { campaignId: campaign.id, skip_rate_limit: true },
        });

        if (invokeError) {
          console.error(`Error invoking bulk-whatsapp-sender for campaign ${campaign.id}:`, invokeError);
        } else {
          console.log(`Successfully triggered bulk-whatsapp-sender for campaign ${campaign.id}`);
        }
      }
    }

    // Find due individual email conversations
    const { data: emailConversations, error: emailConversationsError } = await supabaseClient
      .from('email_conversations')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(50);

    if (emailConversationsError) {
      console.error('Error fetching email conversations:', emailConversationsError);
    } else if (emailConversations && emailConversations.length > 0) {
      console.log(`Found ${emailConversations.length} due email conversations`);
      
      for (const email of emailConversations) {
        console.log(`Processing scheduled email: ${email.id}`);
        
        // Update status to pending
        await supabaseClient
          .from('email_conversations')
          .update({ status: 'pending' })
          .eq('id', email.id);

        // Invoke send-email function
        const { error: invokeError } = await supabaseClient.functions.invoke('send-email', {
          body: {
            to: email.to_email,
            subject: email.subject,
            htmlContent: email.html_content || email.email_content,
            contactId: email.contact_id,
          },
        });

        if (invokeError) {
          console.error(`Error sending scheduled email ${email.id}:`, invokeError);
          // Mark as failed
          await supabaseClient
            .from('email_conversations')
            .update({ status: 'failed' })
            .eq('id', email.id);
        } else {
          console.log(`Successfully sent scheduled email ${email.id}`);
        }
      }
    }

    // Find due individual WhatsApp messages
    const { data: whatsappMessages, error: whatsappMessagesError } = await supabaseClient
      .from('whatsapp_messages')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(50);

    if (whatsappMessagesError) {
      console.error('Error fetching WhatsApp messages:', whatsappMessagesError);
    } else if (whatsappMessages && whatsappMessages.length > 0) {
      console.log(`Found ${whatsappMessages.length} due WhatsApp messages`);
      
      for (const message of whatsappMessages) {
        console.log(`Processing scheduled WhatsApp message: ${message.id}`);
        
        // Update status to pending
        await supabaseClient
          .from('whatsapp_messages')
          .update({ status: 'pending' })
          .eq('id', message.id);

        // Invoke send-whatsapp-message function
        const payload: any = {
          contactId: message.contact_id,
          phoneNumber: message.phone_number.replace(/[^\d]/g, ''),
        };

        if (message.template_id) {
          payload.templateId = message.template_id;
          payload.templateVariables = {};
        } else {
          payload.message = message.message_content;
        }

        const { error: invokeError } = await supabaseClient.functions.invoke('send-whatsapp-message', {
          body: payload,
        });

        if (invokeError) {
          console.error(`Error sending scheduled WhatsApp message ${message.id}:`, invokeError);
          // Mark as failed
          await supabaseClient
            .from('whatsapp_messages')
            .update({ status: 'failed' })
            .eq('id', message.id);
        } else {
          console.log(`Successfully sent scheduled WhatsApp message ${message.id}`);
        }
      }
    }

    // Find activities needing 30-minute reminders
    const { data: activities, error: activitiesError } = await supabaseClient
      .from('contact_activities')
      .select(`
        *,
        activity_participants (email, name),
        profiles:created_by (first_name, last_name),
        contacts!contact_activities_contact_id_fkey (email, first_name, last_name)
      `)
      .in('activity_type', ['meeting', 'call', 'task'])
      .eq('reminder_sent', false)
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', new Date(Date.now() + 25 * 60 * 1000).toISOString())
      .lte('scheduled_at', new Date(Date.now() + 35 * 60 * 1000).toISOString());

    if (activitiesError) {
      console.error('Error fetching activities for reminders:', activitiesError);
    } else if (activities && activities.length > 0) {
      console.log(`Found ${activities.length} activities needing reminders`);
      
      const { data: pricing } = await supabaseClient
        .from('subscription_pricing')
        .select('email_cost_per_unit')
        .eq('is_active', true)
        .single();

      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      
      for (const activity of activities) {
        try {
          // Determine recipients
          let recipients: Array<{ email: string; name: string }> = [];
          
          if (activity.activity_type === 'meeting' && activity.activity_participants?.length > 0) {
            recipients = activity.activity_participants;
          } else if (activity.contacts?.email) {
            // For calls/tasks, notify the contact
            recipients = [{
              email: activity.contacts.email,
              name: `${activity.contacts.first_name} ${activity.contacts.last_name || ''}`.trim()
            }];
          }

          if (recipients.length === 0) {
            console.log(`No recipients for activity ${activity.id}, skipping`);
            continue;
          }

          // Generate reminder email
          const activityType = activity.activity_type.charAt(0).toUpperCase() + activity.activity_type.slice(1);
          const scheduledDate = new Date(activity.scheduled_at);
          const formattedDate = scheduledDate.toLocaleString('en-IN', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Asia/Kolkata'
          });

          const meetingLink = activity.meeting_link ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${activity.meeting_link}" 
                 style="background: #4285F4; color: white; padding: 15px 40px; 
                        text-decoration: none; border-radius: 4px; font-size: 16px; 
                        font-weight: bold; display: inline-block;">
                Join Meeting
              </a>
            </div>
          ` : '';

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 20px; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #92400E;">⏰ Reminder: ${activityType} in 30 minutes</h2>
              </div>
              
              <p>This is a reminder that your ${activity.activity_type} is starting soon.</p>
              
              <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">${activity.subject || activityType}</h3>
                <p><strong>When:</strong> ${formattedDate}</p>
                ${activity.meeting_duration_minutes ? `<p><strong>Duration:</strong> ${activity.meeting_duration_minutes} minutes</p>` : ''}
                ${activity.profiles ? `<p><strong>Organized by:</strong> ${activity.profiles.first_name} ${activity.profiles.last_name || ''}</p>` : ''}
              </div>
              
              ${meetingLink}
              
              ${activity.description ? `
                <div style="margin: 20px 0;">
                  <h4>Details:</h4>
                  <p>${activity.description}</p>
                </div>
              ` : ''}
            </div>
          `;

          // Send reminders
          for (const recipient of recipients) {
            try {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${RESEND_API_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  from: 'In-Sync Reminders <notifications@globalcrm.in-sync.co.in>',
                  to: recipient.email,
                  subject: `Reminder: ${activity.activity_type} in 30 minutes - ${activity.subject || 'Activity'}`,
                  html: emailHtml
                })
              });

              // Deduct from wallet
              if (pricing) {
                await supabaseClient.rpc('deduct_from_wallet', {
                  _org_id: activity.org_id,
                  _amount: pricing.email_cost_per_unit,
                  _service_type: 'email',
                  _reference_id: activity.id,
                  _quantity: 1,
                  _unit_cost: pricing.email_cost_per_unit,
                  _user_id: activity.created_by
                });
              }
            } catch (emailError) {
              console.error(`Failed to send reminder to ${recipient.email}:`, emailError);
            }
          }

          // Mark reminder as sent
          await supabaseClient
            .from('contact_activities')
            .update({ reminder_sent: true })
            .eq('id', activity.id);

          console.log(`Sent ${recipients.length} reminders for activity ${activity.id}`);
        } catch (activityError) {
          console.error(`Error processing activity ${activity.id}:`, activityError);
        }
      }
    }

    // Create in-app activity reminders
    console.log("[Processor] Creating in-app activity reminders...");
    const { error: reminderError } = await supabaseClient.rpc("create_activity_reminders");

    if (reminderError) {
      console.error("[Processor] Failed to create activity reminders:", reminderError);
    } else {
      console.log("[Processor] Activity reminders created successfully");
    }

    console.log('Scheduled messages processor completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        processed: {
          emailCampaigns: emailCampaigns?.length || 0,
          whatsappCampaigns: whatsappCampaigns?.length || 0,
          emailConversations: emailConversations?.length || 0,
          whatsappMessages: whatsappMessages?.length || 0,
          activityReminders: activities?.length || 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in scheduled-messages-processor:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
