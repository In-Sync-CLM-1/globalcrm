import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_WEBHOOKS_PER_MINUTE = 100;

// Exotel WhatsApp webhook payload structure
interface ExotelWebhookPayload {
  whatsapp?: {
    messages?: Array<{
      callback_type: 'dlr' | 'icm'; // dlr = delivery report, icm = incoming message
      sid: string;
      to: string;
      from?: string;
      exo_status_code: number;
      exo_detailed_status: string;
      description: string;
      timestamp: string;
      custom_data?: string;
      // For incoming messages
      content?: {
        type: string;
        text?: { body: string };
        image?: { link: string; caption?: string };
        document?: { link: string; filename?: string };
      };
      profile_name?: string;
    }>;
  };
}

// Rate limiting for webhook calls (IP-based)
async function checkWebhookRateLimit(supabaseClient: any, ipAddress: string): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  
  const { count } = await supabaseClient
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ipAddress)
    .eq('operation', 'webhook_whatsapp')
    .gte('created_at', oneMinuteAgo);
  
  return (count || 0) < RATE_LIMIT_WEBHOOKS_PER_MINUTE;
}

// Map Exotel status codes to our status
function mapExotelStatus(exoStatusCode: number): string {
  switch (exoStatusCode) {
    case 30001:
    case 30040:
    case 30041:
    case 30042:
      return 'sent';
    case 30002:
    case 30043:
      return 'delivered';
    case 30003:
    case 30044:
      return 'read';
    case 30004:
    case 30005:
    case 30006:
    case 30007:
    case 30008:
    case 30009:
    case 30010:
    case 30011:
    case 30012:
    case 30013:
    case 30014:
    case 30015:
    case 30016:
    case 30017:
    case 30018:
    case 30019:
    case 30020:
    case 30021:
    case 30022:
    case 30023:
    case 30024:
    case 30025:
    case 30026:
    case 30027:
    case 30028:
    case 30029:
      return 'failed';
    default:
      return 'unknown';
  }
}

// Credit back a wallet charge for a WhatsApp send that was accepted at submission
// time but failed at delivery (DLR). Idempotent on the service_usage_logs row for
// (whatsapp, waLogId): once refunded/deleted, a duplicate DLR callback for the
// same sid is a no-op. Mirrors pipeline-action-dispatcher's own refundFunds, but
// this is the only refund path for failures that surface after submission.
async function refundWalletForFailedMessage(
  supabaseClient: any,
  args: { orgId: string; waLogId: string; cost: number | null; reason: string },
): Promise<void> {
  try {
    const { data: usage } = await supabaseClient
      .from('service_usage_logs')
      .select('id, cost')
      .eq('org_id', args.orgId)
      .eq('service_type', 'whatsapp')
      .eq('reference_id', args.waLogId)
      .maybeSingle();
    if (!usage) return; // never charged, or already refunded

    const cost = Number(usage.cost ?? args.cost ?? 0);
    if (!(cost > 0)) return;

    const { data: newBal, error } = await supabaseClient.rpc('credit_wallet_funds', {
      p_org: args.orgId,
      p_amount: cost,
    });
    if (error) {
      console.error('credit_wallet_funds error:', error.message);
      return;
    }
    const balanceAfter = Number(newBal ?? 0);
    await supabaseClient.from('wallet_transactions').insert({
      org_id: args.orgId,
      transaction_type: 'refund',
      amount: cost,
      balance_before: balanceAfter - cost,
      balance_after: balanceAfter,
      reference_id: args.waLogId,
      reference_type: 'whatsapp',
      quantity: 1,
      unit_cost: cost,
      description: `Refund — WhatsApp delivery failed (${args.reason})`,
    });
    await supabaseClient.from('service_usage_logs').delete().eq('id', usage.id);
  } catch (e) {
    console.error('refundWalletForFailedMessage exception:', String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = getSupabaseClient();

    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // Check rate limit
    const withinLimit = await checkWebhookRateLimit(supabaseClient, clientIp);
    if (!withinLimit) {
      console.error('Webhook rate limit exceeded from IP:', clientIp);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const payload: ExotelWebhookPayload = await req.json();
    
    console.log('Received Exotel WhatsApp webhook:', JSON.stringify(payload, null, 2));

    // Log rate limit
    await supabaseClient
      .from('rate_limit_log')
      .insert({
        org_id: null,
        operation: 'webhook_whatsapp',
        ip_address: clientIp,
      });

    // Process each message in the payload
    const messages = payload?.whatsapp?.messages || [];
    
    for (const webhookData of messages) {
      const { callback_type, sid, exo_status_code, exo_detailed_status, description, timestamp, custom_data } = webhookData;
      
      // Handle incoming messages (icm)
      if (callback_type === 'icm' && webhookData.content) {
        console.log('Received inbound message:', webhookData);
        
        const phoneNumber = webhookData.from || '';
        const messageText = webhookData.content.text?.body || 
                           webhookData.content.image?.caption || 
                           '';
        
        // Find existing contact by phone number
        const { data: contacts } = await supabaseClient
          .from('contacts')
          .select('id, org_id')
          .or(`phone.eq.${phoneNumber},phone.eq.${phoneNumber.replace('+', '')}`)
          .limit(1);
        
        let contactId = contacts?.[0]?.id;
        let orgId = contacts?.[0]?.org_id;
        
        // If contact doesn't exist, try to auto-create
        if (!contactId || !orgId) {
          console.log('Contact not found for phone:', phoneNumber);
          
          // Get active Exotel settings with WhatsApp enabled to determine org
          const { data: exotelSettings } = await supabaseClient
            .from('exotel_settings')
            .select('org_id')
            .eq('is_active', true)
            .eq('whatsapp_enabled', true)
            .limit(1);
          
          if (!exotelSettings || exotelSettings.length === 0) {
            console.log('No active Exotel WhatsApp settings found');
            continue;
          }
          
          orgId = exotelSettings[0].org_id;
          console.log('Creating new contact for phone:', phoneNumber, 'in org:', orgId);
          
          // Parse name from webhook
          let firstName = webhookData.profile_name || phoneNumber;
          let lastName = '';
          
          if (webhookData.profile_name) {
            const nameParts = webhookData.profile_name.trim().split(' ');
            firstName = nameParts[0] || phoneNumber;
            lastName = nameParts.slice(1).join(' ') || '';
          }
          
          // Create new contact
          const { data: newContact, error: createError } = await supabaseClient
            .from('contacts')
            .insert({
              org_id: orgId,
              phone: phoneNumber,
              first_name: firstName,
              last_name: lastName || null,
              source: 'whatsapp_inbound',
              status: 'new',
            })
            .select('id')
            .single();
          
          if (createError) {
            console.error('Error creating contact:', createError);
            continue;
          }
          
          contactId = newContact.id;
          console.log('Created new contact:', contactId);
        }
        
        // Store inbound message
        const { error: insertError } = await supabaseClient
          .from('whatsapp_messages')
          .insert({
            org_id: orgId,
            contact_id: contactId,
            conversation_id: phoneNumber,
            direction: 'inbound',
            message_content: messageText,
            sender_name: webhookData.profile_name,
            phone_number: phoneNumber,
            media_url: webhookData.content.image?.link || webhookData.content.document?.link,
            media_type: webhookData.content.type,
            exotel_message_id: sid,
            exotel_status_code: exo_status_code?.toString(),
            status: 'received',
            sent_at: new Date(timestamp),
          });
        
        if (insertError) {
          console.error('Error inserting inbound message:', insertError);
        } else {
          console.log('Stored inbound message from:', phoneNumber);
        }

        // Negative action: a STOP / opt-out reply suppresses WhatsApp (and marks
        // the contact opted-out overall). Record is kept, just removed from outreach.
        const optOutRe = /^\s*(stop|unsubscribe|opt[\s-]?out|remove me|do ?not ?(contact|message|call)|don'?t ?(contact|message|call))\b/i;
        if (contactId && optOutRe.test(messageText)) {
          await supabaseClient.from('contacts').update({
            do_not_whatsapp: true,
            opted_out: true,
            opt_out_reason: 'WhatsApp STOP/opt-out reply',
            opt_out_at: new Date().toISOString(),
          }).eq('id', contactId);
          console.log('Opt-out captured (WhatsApp) for contact:', contactId);
        }

        continue;
      }
      
      // Handle delivery reports (dlr)
      if (callback_type === 'dlr' && sid) {
        const messageStatus = mapExotelStatus(exo_status_code);
        const timestampDate = new Date(timestamp);

        // (a) Conversation log — whatsapp_messages (most orgs' chat view)
        const { data: message } = await supabaseClient
          .from('whatsapp_messages')
          .select('id, delivered_at')
          .eq('exotel_message_id', sid)
          .maybeSingle();

        if (message) {
          const updateData: any = {
            status: messageStatus,
            exotel_status_code: exo_status_code.toString(),
          };
          if (messageStatus === 'delivered' || messageStatus === 'sent') {
            updateData.delivered_at = timestampDate.toISOString();
          } else if (messageStatus === 'read') {
            updateData.read_at = timestampDate.toISOString();
            if (!message.delivered_at) updateData.delivered_at = timestampDate.toISOString();
          } else if (messageStatus === 'failed') {
            updateData.error_message = `${exo_detailed_status}: ${description}`;
          }
          await supabaseClient.from('whatsapp_messages').update(updateData).eq('id', message.id);
        }

        // (b) Billing/usage log — whatsapp_logs (IEDUP dashboard + stage-action
        // and post-call sends). Advance sent -> delivered -> read so the
        // dashboard funnel and the disposition column reflect real status.
        const { data: waLog } = await supabaseClient
          .from('whatsapp_logs')
          .select('id, org_id, delivered_at, cost_charged')
          .eq('exotel_msg_sid', sid)
          .maybeSingle();

        if (waLog) {
          const logUpd: any = { status: messageStatus };
          if (messageStatus === 'delivered') {
            logUpd.delivered_at = timestampDate.toISOString();
          } else if (messageStatus === 'read') {
            logUpd.read_at = timestampDate.toISOString();
            if (!waLog.delivered_at) logUpd.delivered_at = timestampDate.toISOString();
          } else if (messageStatus === 'failed') {
            logUpd.failed_at = timestampDate.toISOString();
            logUpd.error_text = `${exo_detailed_status}: ${description}`;
          }
          await supabaseClient.from('whatsapp_logs').update(logUpd).eq('id', waLog.id);

          // A message can be charged at send time (reserve_wallet_funds) then still
          // bounce later at the DLR stage (invalid recipient, template rejected, etc).
          // The sender's own failure path already refunds; this is the ONLY refund
          // for failures that surface asynchronously via this webhook.
          if (messageStatus === 'failed') {
            await refundWalletForFailedMessage(supabaseClient, {
              orgId: waLog.org_id,
              waLogId: waLog.id,
              cost: waLog.cost_charged,
              reason: `${exo_detailed_status}: ${description}`,
            });
          }
        }

        if (!message && !waLog) {
          console.error('DLR: no whatsapp_messages or whatsapp_logs row for SID:', sid);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});