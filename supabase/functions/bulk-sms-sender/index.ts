import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { orgServiceGate } from '../_shared/billingGate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BulkSMSRequest {
  campaignId: string;
}

const BATCH_SIZE = 50;
const DELAY_BETWEEN_MESSAGES = 100; // ms

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== bulk-sms-sender Request Started ===');
    console.log('Timestamp:', new Date().toISOString());

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No Authorization header provided');
    }

    const supabaseClient = getSupabaseClient();

    const body: BulkSMSRequest = await req.json();
    const { campaignId } = body;

    if (!campaignId) {
      return new Response(
        JSON.stringify({ error: 'Campaign ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch campaign details
    const { data: campaign, error: campaignError } = await supabaseClient
      .from('sms_bulk_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No money, no service: stop the campaign if the org is locked or out of funds.
    const gate = await orgServiceGate(supabaseClient, campaign.org_id);
    if (!gate.allowed) {
      await supabaseClient
        .from('sms_bulk_campaigns')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', campaignId);
      return new Response(
        JSON.stringify({ error: `Campaign blocked: ${gate.reason}`, code: gate.locked ? 'account_locked' : 'wallet_exhausted' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('✓ Campaign found:', campaign.campaign_name);

    // Get Exotel settings
    const { data: exotelSettings } = await supabaseClient
      .from('exotel_settings')
      .select('*')
      .eq('org_id', campaign.org_id)
      .eq('is_active', true)
      .eq('sms_enabled', true)
      .single();

    if (!exotelSettings) {
      await supabaseClient
        .from('sms_bulk_campaigns')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', campaignId);

      return new Response(
        JSON.stringify({ error: 'SMS not configured for this organization' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update campaign status to processing
    await supabaseClient
      .from('sms_bulk_campaigns')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    // Fetch pending recipients in batches
    const { data: recipients, error: recipientsError } = await supabaseClient
      .from('sms_campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .limit(BATCH_SIZE);

    if (recipientsError) {
      console.error('Error fetching recipients:', recipientsError);
      throw new Error('Failed to fetch recipients');
    }

    console.log(`Processing ${recipients?.length || 0} recipients`);

    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-webhook`;
    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients || []) {
      try {
        // Format phone number
        let formattedPhone = recipient.phone_number.replace(/[^\d+]/g, '');
        if (!formattedPhone.startsWith('+')) {
          if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
            formattedPhone = '+91' + formattedPhone;
          } else {
            formattedPhone = '+' + formattedPhone;
          }
        }

        // Personalize message with contact name
        let personalizedMessage = campaign.message_content;
        if (recipient.contact_name) {
          personalizedMessage = personalizedMessage.replace(/{{name}}/gi, recipient.contact_name);
          personalizedMessage = personalizedMessage.replace(/{{first_name}}/gi, recipient.contact_name.split(' ')[0]);
        }

        // Send SMS via Exotel
        const exotelUrl = `https://${exotelSettings.api_key}:${exotelSettings.api_token}@${exotelSettings.subdomain}/v1/Accounts/${exotelSettings.account_sid}/Sms/send`;

        const formData = new URLSearchParams();
        formData.append('From', exotelSettings.sms_sender_id);
        formData.append('To', formattedPhone);
        formData.append('Body', personalizedMessage);
        formData.append('StatusCallback', webhookUrl);
        if (recipient.contact_id) {
          formData.append('CustomField', recipient.contact_id);
        }

        const response = await fetch(exotelUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString(),
        });

        const responseText = await response.text();

        if (response.ok) {
          // Extract SMS ID from response
          const sidMatch = responseText.match(/<Sid>([^<]+)<\/Sid>/);
          const smsId = sidMatch ? sidMatch[1] : null;

          await supabaseClient
            .from('sms_campaign_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
            })
            .eq('id', recipient.id);

          // Also log to sms_messages table
          await supabaseClient.from('sms_messages').insert({
            org_id: campaign.org_id,
            contact_id: recipient.contact_id,
            phone_number: formattedPhone,
            message_content: personalizedMessage,
            direction: 'outbound',
            status: 'sent',
            exotel_sms_id: smsId,
            sent_at: new Date().toISOString(),
          });

          sentCount++;
        } else {
          const messageMatch = responseText.match(/<Message>([^<]+)<\/Message>/);
          const errorMessage = messageMatch ? messageMatch[1] : 'Failed to send';

          await supabaseClient
            .from('sms_campaign_recipients')
            .update({
              status: 'failed',
              error_message: errorMessage,
            })
            .eq('id', recipient.id);

          failedCount++;
        }

        // Add delay between messages
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES));
      } catch (recipientError) {
        console.error('Error processing recipient:', recipient.id, recipientError);
        
        await supabaseClient
          .from('sms_campaign_recipients')
          .update({
            status: 'failed',
            error_message: (recipientError as Error).message,
          })
          .eq('id', recipient.id);

        failedCount++;
      }
    }

    // Update campaign stats
    await supabaseClient.rpc('increment_sms_campaign_stats', {
      p_campaign_id: campaignId,
      p_sent_increment: sentCount,
      p_failed_increment: failedCount,
      p_pending_increment: -sentCount - failedCount,
    });

    // Check if there are more pending recipients
    const { count: remainingCount } = await supabaseClient
      .from('sms_campaign_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    if (remainingCount === 0) {
      // All done, mark campaign as completed
      await supabaseClient
        .from('sms_bulk_campaigns')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);

      console.log('✓ Campaign completed');
    } else {
      console.log(`${remainingCount} recipients remaining, will process in next batch`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: recipients?.length || 0,
        sent: sentCount,
        failed: failedCount,
        remaining: remainingCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const err = error as Error;
    console.error('=== bulk-sms-sender Error ===');
    console.error('Error:', err.message);
    
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
