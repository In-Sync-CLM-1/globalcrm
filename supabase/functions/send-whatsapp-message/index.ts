import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { resolveWhatsAppFieldMappings } from '../_shared/whatsappFieldMappings.ts';
import { orgServiceGate } from '../_shared/billingGate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessageRequest {
  contactId: string;
  phoneNumber: string;
  templateId?: string;
  templateVariables?: Record<string, string>;
  message?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== send-whatsapp-message Request Started ===');
    console.log('Request method:', req.method);
    console.log('Timestamp:', new Date().toISOString());

    // Check for Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No Authorization header provided');
    }

    // Extract JWT token (remove "Bearer " prefix)
    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    // Authenticate user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      throw new Error(`Authentication failed: ${userError?.message || 'No user found'}`);
    }

    console.log('✓ User authenticated:', user.email);

    const body: SendMessageRequest = await req.json();
    const { contactId, phoneNumber, templateId, templateVariables, message } = body;

    // Fetch user profile and org_id
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.org_id) {
      throw new Error('Organization not found');
    }

    console.log('✓ Organization verified:', profile.org_id);

    // No money, no service: block paid WhatsApp sends when the org is locked for
    // non-payment or its wallet has hit the ₹500 reserve.
    const gate = await orgServiceGate(getSupabaseClient(), profile.org_id);
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ error: `WhatsApp unavailable: ${gate.reason}`, code: gate.locked ? 'account_locked' : 'wallet_exhausted' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get Exotel settings (now used for WhatsApp)
    const { data: exotelSettings } = await supabaseClient
      .from('exotel_settings')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .eq('whatsapp_enabled', true)
      .single();

    if (!exotelSettings) {
      return new Response(JSON.stringify({ error: 'WhatsApp not configured for this organization' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!exotelSettings.whatsapp_source_number) {
      return new Response(JSON.stringify({ error: 'WhatsApp source number not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let messageContent = message || '';
    let templateData = null;

    // If using a template, fetch it and prepare message
    if (templateId) {
      const { data: template } = await supabaseClient
        .from('communication_templates')
        .select('*')
        .eq('id', templateId)
        .eq('org_id', profile.org_id)
        .single();

      if (!template) {
        return new Response(JSON.stringify({ error: 'Template not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // If the template has field mappings, auto-resolve them from the contact.
      // This overrides any client-supplied templateVariables.
      let resolvedVariables: Record<string, string> = templateVariables || {};
      const fieldMappings = template.field_mappings || {};
      const hasBodyMappings = fieldMappings.body && Object.keys(fieldMappings.body).length > 0;
      const hasHeaderMappings = fieldMappings.header && Object.keys(fieldMappings.header).length > 0;

      if (hasBodyMappings || hasHeaderMappings) {
        const { data: contact } = await supabaseClient
          .from('contacts')
          .select('*')
          .eq('id', contactId)
          .single();

        if (!contact) {
          return new Response(JSON.stringify({ error: 'Contact not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const resolved = await resolveWhatsAppFieldMappings(fieldMappings, contact, supabaseClient);

        // Merge: field_mappings provides defaults; client-supplied templateVariables override.
        // Only fail if the FINAL merged set is still missing required fields.
        const clientVars = templateVariables || {};
        const merged: Record<string, string> = { ...resolved.bodyValues };
        for (const [pos, val] of Object.entries(clientVars)) {
          if (val !== undefined && val !== null && String(val).length > 0) {
            merged[pos] = String(val);
          }
        }

        const stillMissing: string[] = [];
        for (const [pos, fieldName] of Object.entries(fieldMappings.body || {})) {
          if (!merged[pos]) stillMissing.push(fieldName);
        }
        if (stillMissing.length > 0) {
          return new Response(JSON.stringify({
            error: 'Contact is missing required information for this template',
            missing_fields: stillMissing,
          }), {
            status: 422,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        resolvedVariables = merged;
      }

      messageContent = template.content;

      // Fill positional placeholders in the preview/log content
      Object.entries(resolvedVariables).forEach(([key, value]) => {
        messageContent = messageContent.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });

      templateData = {
        name: template.template_name,
        language: { code: template.language || 'en' },
        components: buildTemplateComponents(template, resolvedVariables),
      };
    }

    // Format phone number (ensure it's in e.164 format)
    let formattedPhone = phoneNumber.replace(/[^\d+]/g, '');
    if (!formattedPhone.startsWith('+')) {
      // Assume Indian number if no country code
      if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
        formattedPhone = '+91' + formattedPhone;
      } else {
        formattedPhone = '+' + formattedPhone;
      }
    }

    // Get webhook callback URL
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`;

    // Use WhatsApp-specific Exotel credentials if set (WhatsApp may live on a
    // different Exotel account than voice); fall back to the voice creds.
    const waApiKey = exotelSettings.whatsapp_api_key || exotelSettings.api_key;
    const waApiToken = exotelSettings.whatsapp_api_token || exotelSettings.api_token;
    const waSubdomain = exotelSettings.whatsapp_subdomain || exotelSettings.subdomain;
    const waAccountSid = exotelSettings.whatsapp_account_sid || exotelSettings.account_sid;

    // Build Exotel WhatsApp API request
    const exotelUrl = `https://${waApiKey}:${waApiToken}@${waSubdomain}/v2/accounts/${waAccountSid}/messages`;

    const exotelPayload: any = {
      custom_data: contactId,
      status_callback: webhookUrl,
      whatsapp: {
        messages: [
          {
            from: exotelSettings.whatsapp_source_number,
            to: formattedPhone,
            content: templateData ? {
              type: 'template',
              template: templateData,
            } : {
              recipient_type: 'individual',
              type: 'text',
              text: {
                preview_url: false,
                body: messageContent,
              },
            },
          },
        ],
      },
    };

    console.log('Sending WhatsApp message via Exotel:', JSON.stringify(exotelPayload, null, 2));

    const exotelResponse = await fetch(exotelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(exotelPayload),
    });

    const exotelResult = await exotelResponse.json();
    console.log('Exotel response:', JSON.stringify(exotelResult, null, 2));

    // Check for success. Exotel returns code 200 OR 202 for accepted messages
    // (202 = queued for delivery; both are success per Exotel WA v2 API).
    const messageResponse = exotelResult?.response?.whatsapp?.messages?.[0];
    const isSuccess = exotelResponse.ok &&
      (messageResponse?.code === 200 || messageResponse?.code === 202 || messageResponse?.status === 'success');

    if (!isSuccess) {
      // Log failed message
      await supabaseClient.from('whatsapp_messages').insert({
        org_id: profile.org_id,
        contact_id: contactId,
        template_id: templateId || null,
        sent_by: user.id,
        phone_number: formattedPhone,
        message_content: messageContent,
        template_variables: templateVariables || null,
        status: 'failed',
        error_message: messageResponse?.error_data?.message || exotelResult?.message || 'Failed to send message',
        exotel_status_code: messageResponse?.code?.toString() || exotelResponse.status.toString(),
      });

      return new Response(
        JSON.stringify({ error: messageResponse?.error_data?.message || exotelResult?.message || 'Failed to send message' }),
        {
          status: exotelResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract message SID from response
    const messageSid = messageResponse?.data?.sid;

    // Log successful message
    const { data: messageRecord } = await supabaseClient
      .from('whatsapp_messages')
      .insert({
        org_id: profile.org_id,
        contact_id: contactId,
        template_id: templateId || null,
        sent_by: user.id,
        phone_number: formattedPhone,
        message_content: messageContent,
        template_variables: templateVariables || null,
        exotel_message_id: messageSid,
        status: 'sent',
      })
      .select()
      .single();

    // Use shared service role client for wallet deduction
    const supabaseServiceClient = getSupabaseClient();

    // Deduct WhatsApp cost from wallet
    const { data: deductResult, error: deductError } = await supabaseServiceClient.rpc('deduct_from_wallet', {
      _org_id: profile.org_id,
      _amount: 1.00,
      _service_type: 'whatsapp',
      _reference_id: messageRecord?.id,
      _quantity: 1,
      _unit_cost: 1.00,
      _user_id: user.id
    });

    if (deductError || !deductResult?.success) {
      console.warn('Wallet deduction failed:', deductError || deductResult);
    }

    // Log activity
    await supabaseClient.from('contact_activities').insert({
      org_id: profile.org_id,
      contact_id: contactId,
      activity_type: 'whatsapp',
      subject: 'WhatsApp Message Sent',
      description: messageContent,
      created_by: user.id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId: messageSid,
        message: messageRecord,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const err = error as Error;
    console.error('=== send-whatsapp-message Error ===');
    console.error('Error Message:', err.message);
    console.error('Timestamp:', new Date().toISOString());
    
    return new Response(
      JSON.stringify({ 
        error: err.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: err.message?.includes('Unauthorized') || err.message?.includes('Authentication') ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Helper function to build template components for Exotel format
function buildTemplateComponents(template: any, variables?: Record<string, string>): any[] {
  const components: any[] = [];
  
  // Header component
  if (template.header_type && template.header_content) {
    const headerComponent: any = {
      type: 'header',
    };
    
    if (template.header_type === 'text') {
      headerComponent.parameters = [{
        type: 'text',
        text: template.header_content,
      }];
    } else if (['image', 'video', 'document'].includes(template.header_type)) {
      headerComponent.parameters = [{
        type: template.header_type,
        [template.header_type]: {
          link: template.header_content,
        },
      }];
    }
    
    components.push(headerComponent);
  }
  
  // Body component with variables
  if (variables && Object.keys(variables).length > 0) {
    const bodyParameters = Object.values(variables).map((value) => ({
      type: 'text',
      text: value,
    }));
    
    components.push({
      type: 'body',
      parameters: bodyParameters,
    });
  }
  
  // Button components
  if (template.buttons && Array.isArray(template.buttons)) {
    template.buttons.forEach((button: any, index: number) => {
      if (button.type === 'url' && button.url?.includes('{{')) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: index,
          parameters: [{
            type: 'text',
            text: variables?.[`button_${index}`] || '',
          }],
        });
      }
    });
  }
  
  return components;
}