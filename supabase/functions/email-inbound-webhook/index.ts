import { getSupabaseClient } from '../_shared/supabaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Verify webhook signature using Web Crypto API
async function verifyWebhookSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  body: string
): Promise<boolean> {
  try {
    // Extract the signature (format: "v1,signature1 v1,signature2")
    const signatures = svixSignature.split(' ').map(sig => {
      const parts = sig.split(',');
      return parts.length === 2 ? parts[1] : null;
    }).filter(Boolean);

    if (signatures.length === 0) {
      return false;
    }

    // Construct the signed content: id.timestamp.body
    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    
    // Convert secret to key
    const encoder = new TextEncoder();
    // the part after whsec_ is the key itself in base64; using its letters as the key made every check fail
    const keyData = Uint8Array.from(atob(secret.replace('whsec_', '')), (ch) => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Generate signature
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedContent)
    );

    // Convert to base64
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // Check if any of the provided signatures match
    return signatures.some(sig => sig === signatureBase64);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

interface ResendInboundPayload {
  messageId: string;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    url?: string;
  }>;
  threadId?: string;
  inReplyTo?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = getSupabaseClient();

    // Verify webhook signature
    const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('RESEND_WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Webhook secret not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract Svix headers
    const svixId = req.headers.get('svix-id');
    const svixTimestamp = req.headers.get('svix-timestamp');
    const svixSignature = req.headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error('Missing Svix headers');
      return new Response(
        JSON.stringify({ error: 'Missing signature headers' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get raw body for verification
    const body = await req.text();

    // Verify the webhook signature
    const isValid = await verifyWebhookSignature(
      webhookSecret,
      svixId,
      svixTimestamp,
      svixSignature,
      body
    );

    if (!isValid) {
      console.error('Webhook signature verification failed');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Webhook signature verified successfully');

    // Parse the verified payload
    const payload = JSON.parse(body);
    console.log('Received payload:', JSON.stringify(payload, null, 2));

    // Check if this is a Resend webhook event (has 'type' field)
    if (payload.type) {
      console.log(`Received Resend webhook event: ${payload.type}`);
      const eventData = payload.data;
      
      // Handle domain verification updates
      if (payload.type === 'domain.updated' && eventData) {
        console.log('Processing domain update:', eventData);
        
        // Update email_settings with latest verification status
        const { error: updateError } = await supabaseClient
          .from('email_settings')
          .update({
            verification_status: eventData.status === 'verified' ? 'verified' : 'pending',
            dns_records: eventData.records ? JSON.stringify(eventData.records) : null,
            updated_at: new Date().toISOString(),
          })
          .eq('resend_domain_id', eventData.id);
        
        if (updateError) {
          console.error('Error updating domain status:', updateError);
        } else {
          console.log(`Domain ${eventData.name} status updated to: ${eventData.status}`);
        }
      }
      
      // Handle email delivery events (sent, delivered, bounced, opened, clicked, complained)
      if (eventData && eventData.email_id) {
        const emailId = eventData.email_id;
        console.log(`Processing email event: ${payload.type} for email ${emailId}`);

        const now = new Date().toISOString();
        const bounceReason = eventData.bounce?.message || 'Unknown bounce reason';

        // 1) Try campaign recipient (bulk sends)
        const { data: recipient } = await supabaseClient
          .from('email_campaign_recipients')
          .select('id, status, open_count, click_count')
          .eq('resend_email_id', emailId)
          .maybeSingle();

        if (recipient) {
          const updates: any = {};
          switch (payload.type) {
            case 'email.delivered':
              updates.delivered_at = now;
              break;
            case 'email.bounced':
              updates.status = 'bounced';
              updates.bounced_at = now;
              updates.bounce_reason = bounceReason;
              break;
            case 'email.opened':
              updates.open_count = (recipient.open_count || 0) + 1;
              updates.opened_at = now;
              break;
            case 'email.clicked':
              updates.click_count = (recipient.click_count || 0) + 1;
              updates.first_clicked_at = now;
              break;
            case 'email.complained':
              updates.complained_at = now;
              break;
          }
          if (Object.keys(updates).length > 0) {
            const { error: updateError } = await supabaseClient
              .from('email_campaign_recipients')
              .update(updates)
              .eq('id', recipient.id);
            if (updateError) console.error('Error updating campaign recipient:', updateError);
          }
        }

        // 2) Try 1-to-1 conversation (Contact Detail sends)
        const { data: conversation } = await supabaseClient
          .from('email_conversations')
          .select('id, status, open_count, click_count')
          .eq('provider_message_id', emailId)
          .maybeSingle();

        if (conversation) {
          const updates: any = {};
          switch (payload.type) {
            case 'email.delivered':
              updates.status = 'delivered';
              updates.delivered_at = now;
              break;
            case 'email.bounced':
              updates.status = 'bounced';
              updates.bounced_at = now;
              updates.bounce_reason = bounceReason;
              break;
            case 'email.opened':
              updates.status = 'opened';
              updates.open_count = (conversation.open_count || 0) + 1;
              updates.opened_at = now;
              break;
            case 'email.clicked':
              updates.click_count = (conversation.click_count || 0) + 1;
              updates.first_clicked_at = now;
              break;
            case 'email.complained':
              updates.status = 'complained';
              updates.complained_at = now;
              break;
          }
          if (Object.keys(updates).length > 0) {
            const { error: updateError } = await supabaseClient
              .from('email_conversations')
              .update(updates)
              .eq('id', conversation.id);
            if (updateError) console.error('Error updating email conversation:', updateError);
            else console.log(`Conversation ${conversation.id} updated: ${payload.type}`);
          }
        }

        // 3) Pipeline sends (IEDUP / UP RAMP stage, class and status emails): record the delivery stage for the RAMP Message log.
        //    Events can arrive out of order, so a later stage is never overwritten by an earlier one.
        const RANK: Record<string, number> = { 'email.sent': 1, 'email.delivered': 2, 'email.opened': 3, 'email.clicked': 4, 'email.bounced': 5, 'email.complained': 5 };
        const { data: pipe } = await supabaseClient
          .from('pipeline_email_log')
          .select('id, last_event, delivered_at, opened_at')
          .eq('resend_message_id', emailId)
          .maybeSingle();
        if (pipe && RANK[payload.type]) {
          const pipeUpd: Record<string, unknown> = {};
          if ((RANK[pipe.last_event ?? ''] ?? 0) <= RANK[payload.type]) pipeUpd.last_event = payload.type.replace('email.', '');
          if (payload.type === 'email.delivered' && !pipe.delivered_at) pipeUpd.delivered_at = now;
          if ((payload.type === 'email.opened' || payload.type === 'email.clicked') && !pipe.opened_at) { pipeUpd.opened_at = now; if (!pipe.delivered_at) pipeUpd.delivered_at = now; }
          if (payload.type === 'email.bounced') { pipeUpd.bounced_at = now; pipeUpd.error_text = bounceReason; }
          if (Object.keys(pipeUpd).length > 0) {
            const { error: pipeErr } = await supabaseClient.from('pipeline_email_log').update(pipeUpd).eq('id', pipe.id);
            if (pipeErr) console.error('Error updating pipeline email log:', pipeErr);
          }
        }

        if (!recipient && !conversation && !pipe) {
          console.log('No recipient or conversation found for email ID:', emailId);
        }
      }
      
      // Acknowledge webhook
      return new Response(
        JSON.stringify({ success: true, message: 'Webhook event processed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If no 'type' field, this is an inbound email forwarding event
    const inboundEmail: ResendInboundPayload = payload;
    console.log('Processing inbound email from:', inboundEmail.from);

    // Extract domain from recipient email (inboundEmail.to)
    const recipientEmail = inboundEmail.to;
    const recipientDomain = recipientEmail.split('@')[1];
    console.log('Recipient domain:', recipientDomain);

    // Find organization by matching sending domain
    const { data: emailSettings } = await supabaseClient
      .from('email_settings')
      .select('org_id, verification_status, is_active')
      .eq('sending_domain', recipientDomain)
      .eq('is_active', true)
      .limit(1);

    if (!emailSettings || emailSettings.length === 0) {
      console.log('No active email settings found for domain:', recipientDomain);
      return new Response(
        JSON.stringify({ success: false, message: 'Email sent to unverified domain' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orgId = emailSettings[0].org_id;
    console.log('Found organization:', orgId);

    // Find existing contact by email and org_id
    const { data: contacts } = await supabaseClient
      .from('contacts')
      .select('id')
      .eq('email', inboundEmail.from)
      .eq('org_id', orgId)
      .limit(1);

    let contactId = contacts?.[0]?.id;

    // If contact doesn't exist, create new contact
    if (!contactId) {
      console.log('Contact not found, creating new contact for:', inboundEmail.from);
      
      // Parse name from inboundEmail
      let firstName = '';
      let lastName = '';
      
      if (inboundEmail.fromName) {
        const nameParts = inboundEmail.fromName.trim().split(' ');
        firstName = nameParts[0] || '';
        lastName = nameParts.slice(1).join(' ') || '';
      } else {
        // Extract name from email (before @)
        firstName = inboundEmail.from.split('@')[0];
      }

      // Create new contact
      const { data: newContact, error: createError } = await supabaseClient
        .from('contacts')
        .insert({
          org_id: orgId,
          email: inboundEmail.from,
          first_name: firstName,
          last_name: lastName || null,
          source: 'email_inbound',
          status: 'new',
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating contact:', createError);
        return new Response(
          JSON.stringify({ error: 'Failed to create contact: ' + createError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      contactId = newContact.id;
      console.log('Created new contact:', contactId);
    }

    // Generate conversation ID from thread or create new
    const conversationId = inboundEmail.threadId || crypto.randomUUID();

    // Store inbound email
    const { error: insertError } = await supabaseClient
      .from('email_conversations')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        conversation_id: conversationId,
        thread_id: inboundEmail.threadId,
        direction: 'inbound',
        from_email: inboundEmail.from,
        from_name: inboundEmail.fromName,
        to_email: inboundEmail.to,
        subject: inboundEmail.subject,
        email_content: inboundEmail.text,
        html_content: inboundEmail.html,
        has_attachments: (inboundEmail.attachments?.length ?? 0) > 0,
        attachments: inboundEmail.attachments ? JSON.stringify(inboundEmail.attachments) : null,
        provider_message_id: inboundEmail.messageId,
        status: 'received',
        is_read: false,
        received_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('Error inserting inbound email:', insertError);
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Stored inbound email from:', inboundEmail.from);

    return new Response(
      JSON.stringify({ success: true, message: 'Inbound email stored' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing inbound email webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
