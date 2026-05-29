import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { getSupabaseClient } from '../_shared/supabaseClient.ts';
import { orgServiceGate } from '../_shared/billingGate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendSMSRequest {
  contactId?: string;
  phoneNumber: string;
  message: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== send-sms Request Started ===');
    console.log('Timestamp:', new Date().toISOString());

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No Authorization header provided');
    }

    const token = authHeader.replace('Bearer ', '');

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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      throw new Error(`Authentication failed: ${userError?.message || 'No user found'}`);
    }

    console.log('✓ User authenticated:', user.email);

    const body: SendSMSRequest = await req.json();
    const { contactId, phoneNumber, message } = body;

    if (!phoneNumber || !message) {
      return new Response(
        JSON.stringify({ error: 'Phone number and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // No money, no service: block paid SMS sends when the org is locked for
    // non-payment or its wallet has hit the ₹500 reserve.
    const gate = await orgServiceGate(getSupabaseClient(), profile.org_id);
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ error: `SMS unavailable: ${gate.reason}`, code: gate.locked ? 'account_locked' : 'wallet_exhausted' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get Exotel settings
    const { data: exotelSettings } = await supabaseClient
      .from('exotel_settings')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .eq('sms_enabled', true)
      .single();

    if (!exotelSettings) {
      return new Response(
        JSON.stringify({ error: 'SMS not configured for this organization' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!exotelSettings.sms_sender_id) {
      return new Response(
        JSON.stringify({ error: 'SMS Sender ID not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format phone number
    let formattedPhone = phoneNumber.replace(/[^\d+]/g, '');
    if (!formattedPhone.startsWith('+')) {
      if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
        formattedPhone = '+91' + formattedPhone;
      } else {
        formattedPhone = '+' + formattedPhone;
      }
    }

    // Get webhook callback URL
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-webhook`;

    // Build Exotel SMS API request
    // Exotel SMS API: https://api.exotel.com/v1/Accounts/{account_sid}/Sms/send
    const exotelUrl = `https://${exotelSettings.api_key}:${exotelSettings.api_token}@${exotelSettings.subdomain}/v1/Accounts/${exotelSettings.account_sid}/Sms/send`;

    const formData = new URLSearchParams();
    formData.append('From', exotelSettings.sms_sender_id);
    formData.append('To', formattedPhone);
    formData.append('Body', message);
    formData.append('StatusCallback', webhookUrl);
    if (contactId) {
      formData.append('CustomField', contactId);
    }

    console.log('Sending SMS via Exotel to:', formattedPhone);

    const exotelResponse = await fetch(exotelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const exotelResult = await exotelResponse.text();
    console.log('Exotel SMS response:', exotelResult);

    // Parse XML response from Exotel
    let smsId = '';
    let status = 'sent';
    let errorMessage = '';

    if (exotelResponse.ok) {
      // Extract Sid from XML response
      const sidMatch = exotelResult.match(/<Sid>([^<]+)<\/Sid>/);
      if (sidMatch) {
        smsId = sidMatch[1];
      }
    } else {
      status = 'failed';
      const messageMatch = exotelResult.match(/<Message>([^<]+)<\/Message>/);
      errorMessage = messageMatch ? messageMatch[1] : 'Failed to send SMS';
    }

    // Log SMS message
    const { data: smsRecord } = await supabaseClient
      .from('sms_messages')
      .insert({
        org_id: profile.org_id,
        contact_id: contactId || null,
        sent_by: user.id,
        phone_number: formattedPhone,
        message_content: message,
        direction: 'outbound',
        status: status,
        exotel_sms_id: smsId || null,
        exotel_status_code: exotelResponse.status.toString(),
        error_message: errorMessage || null,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!exotelResponse.ok) {
      return new Response(
        JSON.stringify({ error: errorMessage || 'Failed to send SMS' }),
        { status: exotelResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role client for wallet deduction
    const supabaseServiceClient = getSupabaseClient();

    // Deduct SMS cost from wallet (assuming 0.50 per SMS)
    const { data: deductResult, error: deductError } = await supabaseServiceClient.rpc('deduct_from_wallet', {
      _org_id: profile.org_id,
      _amount: 0.50,
      _service_type: 'sms',
      _reference_id: smsRecord?.id,
      _quantity: 1,
      _unit_cost: 0.50,
      _user_id: user.id
    });

    if (deductError || !deductResult?.success) {
      console.warn('Wallet deduction failed:', deductError || deductResult);
    }

    // Log activity if contact exists
    if (contactId) {
      await supabaseClient.from('contact_activities').insert({
        org_id: profile.org_id,
        contact_id: contactId,
        activity_type: 'sms',
        subject: 'SMS Sent',
        description: message,
        created_by: user.id,
        completed_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        smsId: smsId,
        message: smsRecord,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const err = error as Error;
    console.error('=== send-sms Error ===');
    console.error('Error Message:', err.message);
    
    return new Response(
      JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }),
      {
        status: err.message?.includes('Unauthorized') || err.message?.includes('Authentication') ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
