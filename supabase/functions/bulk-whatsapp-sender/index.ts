import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { orgServiceGate } from '../_shared/billingGate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RECIPIENTS_PER_CAMPAIGN = 50000;
const MAX_BATCH_SIZE = 500;
const RATE_LIMIT_CAMPAIGNS_PER_HOUR = 10;

interface SendMessageRequest {
  campaignId: string;
  batchSize?: number;
  delayMs?: number;
}

// Variable replacement function
function replaceVariables(
  template: string,
  contact: any,
  customData: any = {},
  variableMappings: any = null,
  phoneNumber: string
): string {
  let result = template;
  
  if (variableMappings) {
    for (const [variable, mapping] of Object.entries(variableMappings)) {
      const mappingObj = mapping as any;
      let value = '';
      if (mappingObj.source === 'crm' && contact) {
        value = contact[mappingObj.field] || '';
      } else if (mappingObj.source === 'csv') {
        value = customData?.[mappingObj.field] || '';
      } else if (mappingObj.source === 'static') {
        value = mappingObj.value || '';
      }
      result = result.replace(new RegExp(variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }
  } else {
    // Fallback - replace numbered variables {{1}}, {{2}} with basic contact data if available
    if (contact) {
      result = result
        .replace(/\{\{1\}\}/g, contact.first_name || '')
        .replace(/\{\{2\}\}/g, contact.last_name || '')
        .replace(/\{\{3\}\}/g, contact.company || '')
        .replace(/\{\{4\}\}/g, phoneNumber || '');
    }
  }
  
  return result;
}

// Rate limiting check
async function checkRateLimit(supabaseClient: any, orgId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { count } = await supabaseClient
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('operation', 'bulk_whatsapp_send')
    .gte('created_at', oneHourAgo);
  
  return (count || 0) < RATE_LIMIT_CAMPAIGNS_PER_HOUR;
}

// Log rate limit attempt
async function logRateLimit(supabaseClient: any, orgId: string, userId?: string) {
  await supabaseClient
    .from('rate_limit_log')
    .insert({
      org_id: orgId,
      user_id: userId,
      operation: 'bulk_whatsapp_send',
    });
}

// Format phone number to e.164
function formatPhoneNumber(phone: string): string {
  let formatted = phone.replace(/[^\d+]/g, '');
  if (!formatted.startsWith('+')) {
    if (!formatted.startsWith('91') && formatted.length === 10) {
      formatted = '+91' + formatted;
    } else {
      formatted = '+' + formatted;
    }
  }
  return formatted;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { campaignId, batchSize = 500, delayMs = 1000, skip_rate_limit = false } = body as SendMessageRequest & { skip_rate_limit?: boolean };

    const supabaseClient = getSupabaseClient();

    // Validate input
    if (!campaignId || typeof campaignId !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid campaign ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate batch size
    if (batchSize > MAX_BATCH_SIZE) {
      return new Response(JSON.stringify({ error: `Batch size cannot exceed ${MAX_BATCH_SIZE}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get campaign details with Exotel settings
    const { data: campaign, error: campaignError } = await supabaseClient
      .from('whatsapp_bulk_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Campaign not found: ${campaignError?.message}`);
    }

    // No money, no service: stop the campaign if the org is locked or out of funds.
    const gate = await orgServiceGate(supabaseClient, campaign.org_id);
    if (!gate.allowed) {
      await supabaseClient
        .from('whatsapp_bulk_campaigns')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', campaignId);
      return new Response(
        JSON.stringify({ error: `Campaign blocked: ${gate.reason}`, code: gate.locked ? 'account_locked' : 'wallet_exhausted' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get Exotel settings for the org
    const { data: exotelSettings, error: exotelError } = await supabaseClient
      .from('exotel_settings')
      .select('*')
      .eq('org_id', campaign.org_id)
      .eq('is_active', true)
      .eq('whatsapp_enabled', true)
      .single();

    if (exotelError || !exotelSettings) {
      throw new Error('Exotel WhatsApp not configured for this organization');
    }

    // Check rate limit (skip if called from queue processor)
    if (!skip_rate_limit) {
      const withinLimit = await checkRateLimit(supabaseClient, campaign.org_id);
      if (!withinLimit) {
        // Calculate next available slot
        const { data: nextSlot } = await supabaseClient
          .rpc('calculate_next_slot', {
            p_user_id: campaign.created_by,
            p_org_id: campaign.org_id,
            p_operation: 'bulk_whatsapp_send',
            p_window_minutes: 60,
            p_max_operations: RATE_LIMIT_CAMPAIGNS_PER_HOUR
          });

        // Queue the operation
        const { data: queuedJob, error: queueError } = await supabaseClient
          .from('operation_queue')
          .insert({
            org_id: campaign.org_id,
            user_id: campaign.created_by,
            operation_type: 'bulk_whatsapp_send',
            payload: { campaign_id: campaignId },
            scheduled_for: nextSlot,
            priority: 5
          })
          .select()
          .single();

        if (queueError) throw queueError;

        // Update campaign status to queued
        await supabaseClient
          .from('whatsapp_bulk_campaigns')
          .update({ status: 'queued' })
          .eq('id', campaignId);

        // Get queue position
        const { data: position } = await supabaseClient
          .rpc('get_queue_position', { p_job_id: queuedJob.id });

        const estimatedWaitMinutes = Math.ceil(
          (new Date(nextSlot).getTime() - Date.now()) / (60 * 1000)
        );

        return new Response(
          JSON.stringify({
            status: 'queued',
            job_id: queuedJob.id,
            campaign_id: campaignId,
            message: `Campaign queued for processing at ${new Date(nextSlot).toLocaleTimeString()}`,
            estimated_wait_minutes: estimatedWaitMinutes,
            position_in_queue: position,
            scheduled_for: nextSlot
          }),
          {
            status: 202,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Log rate limit attempt
    await logRateLimit(supabaseClient, campaign.org_id, campaign.created_by);

    // Validate recipient count
    if (campaign.total_recipients > MAX_RECIPIENTS_PER_CAMPAIGN) {
      await supabaseClient
        .from('whatsapp_bulk_campaigns')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', campaignId);
      
      return new Response(
        JSON.stringify({ error: `Campaign exceeds maximum of ${MAX_RECIPIENTS_PER_CAMPAIGN} recipients` }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Update campaign status to processing
    await supabaseClient
      .from('whatsapp_bulk_campaigns')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', campaignId);

    // Get pending recipients with contact data
    const { data: recipients, error: recipientsError } = await supabaseClient
      .from('whatsapp_campaign_recipients')
      .select('*, contacts(*)')
      .eq('campaign_id', campaignId)
      .in('status', ['pending', 'retrying'])
      .order('created_at');

    if (recipientsError || !recipients || recipients.length === 0) {
      await supabaseClient
        .from('whatsapp_bulk_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', campaignId);
      return new Response(JSON.stringify({ success: true, message: 'No recipients to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get webhook callback URL
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`;

    // WhatsApp may live on a different Exotel account than voice; prefer
    // WhatsApp-specific creds with fallback to the voice creds.
    const waApiKey = exotelSettings.whatsapp_api_key || exotelSettings.api_key;
    const waApiToken = exotelSettings.whatsapp_api_token || exotelSettings.api_token;
    const waSubdomain = exotelSettings.whatsapp_subdomain || exotelSettings.subdomain;
    const waAccountSid = exotelSettings.whatsapp_account_sid || exotelSettings.account_sid;
    const exotelUrl = `https://${waApiKey}:${waApiToken}@${waSubdomain}/v2/accounts/${waAccountSid}/messages`;

    let totalSent = 0;
    let totalFailed = 0;

    // Process in batches with parallel execution
    console.log(`Processing ${recipients.length} recipients in batches of ${batchSize}`);
    
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(recipients.length / batchSize)}`);

      // Send messages in parallel within the batch using Promise.allSettled
      const batchResults = await Promise.allSettled(
        batch.map(async (recipient) => {
          try {
            // Format phone number
            const phoneNumber = formatPhoneNumber(recipient.phone_number);
            
            // Replace variables in message content
            const personalizedMessage = replaceVariables(
              campaign.message_content,
              recipient.contacts,
              recipient.custom_data || {},
              campaign.variable_mappings,
              phoneNumber
            );
            
            // Prepare Exotel payload
            const exotelPayload = {
              custom_data: recipient.id,
              status_callback: webhookUrl,
              whatsapp: {
                messages: [
                  {
                    from: exotelSettings.whatsapp_source_number,
                    to: phoneNumber,
                    content: {
                      recipient_type: 'individual',
                      type: 'text',
                      text: {
                        preview_url: false,
                        body: personalizedMessage,
                      },
                    },
                  },
                ],
              },
            };

            // Send to Exotel
            const exotelResponse = await fetch(exotelUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(exotelPayload),
            });

            const responseData = await exotelResponse.json();
            const messageResponse = responseData?.response?.whatsapp?.messages?.[0];
            const isSuccess = exotelResponse.ok && messageResponse?.code === 200;

            if (isSuccess) {
              const messageSid = messageResponse?.data?.sid;

              // Insert message record
              const { data: message } = await supabaseClient
                .from('whatsapp_messages')
                .insert({
                  org_id: campaign.org_id,
                  contact_id: recipient.contact_id,
                  phone_number: recipient.phone_number,
                  message_content: personalizedMessage,
                  template_id: campaign.template_id,
                  sent_by: campaign.created_by,
                  status: 'sent',
                  exotel_message_id: messageSid,
                })
                .select()
                .single();

              // Update recipient status
              await supabaseClient
                .from('whatsapp_campaign_recipients')
                .update({
                  status: 'sent',
                  message_id: message?.id,
                })
                .eq('id', recipient.id);

              // Log activity
              if (recipient.contact_id) {
                await supabaseClient.from('contact_activities').insert({
                  contact_id: recipient.contact_id,
                  org_id: campaign.org_id,
                  activity_type: 'whatsapp_sent',
                  subject: 'WhatsApp Message Sent',
                  description: `Bulk campaign: ${campaign.name}`,
                  created_by: campaign.created_by,
                });
              }

              return { success: true, recipientId: recipient.id };
            } else {
              throw new Error(messageResponse?.error_data?.message || responseData?.message || 'Failed to send message');
            }
          } catch (error: any) {
            // Calculate next retry time with exponential backoff
            const retryCount = recipient.retry_count + 1;
            const backoffMinutes = [5, 30, 120][Math.min(retryCount - 1, 2)];
            const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

            // Update recipient with failure
            await supabaseClient
              .from('whatsapp_campaign_recipients')
              .update({
                status: retryCount < recipient.max_retries ? 'failed' : 'permanently_failed',
                error_message: error.message,
                retry_count: retryCount,
                last_retry_at: new Date().toISOString(),
                next_retry_at: retryCount < recipient.max_retries ? nextRetryAt.toISOString() : null,
              })
              .eq('id', recipient.id);

            return { success: false, recipientId: recipient.id, error: error.message };
          }
        })
      );

      // Count results
      const batchSent = batchResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
      const batchFailed = batchResults.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

      totalSent += batchSent;
      totalFailed += batchFailed;

      // Update campaign stats
      await supabaseClient
        .from('whatsapp_bulk_campaigns')
        .update({
          sent_count: totalSent,
          failed_count: totalFailed,
          pending_count: recipients.length - totalSent - totalFailed,
        })
        .eq('id', campaignId);

      // Delay between batches (except for last batch)
      if (i + batchSize < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Mark campaign as completed
    await supabaseClient
      .from('whatsapp_bulk_campaigns')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    return new Response(
      JSON.stringify({
        success: true,
        totalSent,
        totalFailed,
        totalProcessed: recipients.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in bulk WhatsApp sender:', error);
    
    // Try to mark campaign as failed
    try {
      const body = await req.clone().json();
      if (body.campaignId) {
        const supabaseClient = getSupabaseClient();
        await supabaseClient
          .from('whatsapp_bulk_campaigns')
          .update({ status: 'failed', completed_at: new Date().toISOString() })
          .eq('id', body.campaignId);
      }
    } catch (e) {
      console.error('Failed to mark campaign as failed:', e);
    }
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});