import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user has calling enabled
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('calling_enabled, org_id')
      .eq('id', user.id)
      .single();

    if (!profile?.calling_enabled) {
      return new Response(JSON.stringify({ error: 'Calling not enabled for this user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const requestBody = await req.json();
    const { contactId, agentPhoneNumber, customerPhoneNumber, exophoneId } = requestBody;

    console.log('Make call request:', { contactId, agentPhoneNumber, customerPhoneNumber: customerPhoneNumber ? '***' : 'missing', exophoneId });

    let customerPhone = customerPhoneNumber;
    let customerName = null;

    // If contactId is provided, get contact details
    if (contactId) {
      const { data: contact } = await supabaseClient
        .from('contacts')
        .select('phone, first_name, last_name, org_id')
        .eq('id', contactId)
        .single();

      if (contact?.phone) {
        customerPhone = contact.phone;
        customerName = `${contact.first_name} ${contact.last_name || ''}`;
        console.log('Using contact phone for:', customerName);
      }

      // Orgs with PII protection store only a masked number in contacts.phone. The real number is decrypted
      // here, on the server, and never sent back to the browser.
      if (contact?.org_id) {
        const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
        const { data: protectedOrg } = await service.rpc('pii_protected', { _org: contact.org_id });
        if (protectedOrg) {
          const { data: realPhone } = await service.rpc('pii_contact_phone', { _contact_id: contactId });
          if (!realPhone || String(realPhone).includes('•')) {
            return new Response(JSON.stringify({ error: 'This contact has no callable number on file' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          customerPhone = realPhone;
        }
      }
    }

    if (!customerPhone) {
      console.error('No customer phone number provided. Request body:', requestBody);
      return new Response(JSON.stringify({ 
        error: 'Customer phone number is required',
        details: 'Please provide a valid phone number'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!agentPhoneNumber) {
      console.error('No agent phone number provided');
      return new Response(JSON.stringify({ 
        error: 'Agent phone number is required',
        details: 'Please add your phone number in profile settings'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Exotel settings
    const { data: exotelSettings } = await supabaseClient
      .from('exotel_settings')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .single();

    if (!exotelSettings) {
      return new Response(JSON.stringify({ error: 'Exotel not configured for this organization' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the ExoPhone (caller ID) to use
    let callerId: string | null = null;

    if (exophoneId) {
      // Use specific ExoPhone if provided
      const { data: specificExophone } = await supabaseClient
        .from('exotel_exophones')
        .select('phone_number')
        .eq('id', exophoneId)
        .eq('org_id', profile.org_id)
        .eq('is_active', true)
        .single();

      if (specificExophone) {
        callerId = specificExophone.phone_number;
        console.log('Using specific ExoPhone:', callerId);
      }
    }

    // If no specific ExoPhone or not found, use default
    if (!callerId) {
      const { data: defaultExophone } = await supabaseClient
        .from('exotel_exophones')
        .select('phone_number')
        .eq('org_id', profile.org_id)
        .eq('is_active', true)
        .eq('is_default', true)
        .single();

      if (defaultExophone) {
        callerId = defaultExophone.phone_number;
        console.log('Using default ExoPhone:', callerId);
      }
    }

    // Fallback to legacy caller_id in exotel_settings if no ExoPhones configured
    if (!callerId && exotelSettings.caller_id) {
      callerId = exotelSettings.caller_id;
      console.log('Using legacy caller_id from settings:', callerId);
    }

    if (!callerId) {
      return new Response(JSON.stringify({ 
        error: 'No ExoPhone configured',
        details: 'Please add at least one ExoPhone in Communication Settings'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Make Exotel API call
    const exotelUrl = `https://${exotelSettings.subdomain}/v1/Accounts/${exotelSettings.account_sid}/Calls/connect.json`;
    const auth = btoa(`${exotelSettings.api_key}:${exotelSettings.api_token}`);

    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/exotel-webhook`;

    const params = new URLSearchParams({
      From: agentPhoneNumber,
      To: customerPhone,
      CallerId: callerId,
      CallType: 'trans',
      Record: exotelSettings.call_recording_enabled ? 'true' : 'false',
      StatusCallback: webhookUrl,
    });
    
    // Add StatusCallbackEvents
    params.append('StatusCallbackEvents[]', 'initiated');
    params.append('StatusCallbackEvents[]', 'answered');
    params.append('StatusCallbackEvents[]', 'completed');
    
    const exotelResponse = await fetch(exotelUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!exotelResponse.ok) {
      const errorText = await exotelResponse.text();
      console.error('Exotel API error:', errorText);
      return new Response(JSON.stringify({ error: 'Failed to initiate call', details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const exotelData = await exotelResponse.json();
    console.log('Exotel call initiated:', exotelData);

    // Create call log entry
    const { data: callLog, error: callLogError } = await supabaseClient
      .from('call_logs')
      .insert({
        org_id: profile.org_id,
        contact_id: contactId || null,
        agent_id: user.id,
        exotel_call_sid: exotelData.Call.Sid,
        exotel_conversation_uuid: exotelData.Call.ConversationUuid,
        call_type: 'outbound',
        from_number: agentPhoneNumber,
        to_number: customerPhone,
        direction: 'outgoing-api',
        status: 'initiated',
        exotel_raw_data: exotelData,
        started_at: new Date().toISOString(), // Use current time in UTC
      })
      .select()
      .single();

    if (callLogError) {
      console.error('Error creating call log:', callLogError);
      return new Response(JSON.stringify({ error: 'Failed to create call log' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create agent call session
    await supabaseClient
      .from('agent_call_sessions')
      .upsert({
        agent_id: user.id,
        org_id: profile.org_id,
        contact_id: contactId || null,
        exotel_call_sid: exotelData.Call.Sid,
        status: 'initiating',
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        callLog,
        exotelCallSid: exotelData.Call.Sid 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in exotel-make-call:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
