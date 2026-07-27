import { getSupabaseClient } from '../_shared/supabaseClient.ts';

// Public entry point for the OTP-based password-reset flow (replaces the old
// magic-link resetPasswordForEmail across the whole platform). One OTP is
// generated and delivered over every channel the account actually has on
// file — email always, WhatsApp too if profiles.phone is set — so whichever
// inbox the user checks first has the same code. Verification + the actual
// password change happen together in reset-password-with-otp.
//
// Never reveals whether an email matches an account: an OTP row is always
// created and the response is always the same shape, but delivery is only
// attempted when a real profile is found.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    const emailAddr = (email || '').trim().toLowerCase();

    if (!emailAddr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = getSupabaseClient();

    // Same rate-limit policy as send-otp: 5 requests per identifier per hour.
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabase
      .from('public_otp_verifications')
      .select('*', { count: 'exact', head: true })
      .eq('identifier', emailAddr)
      .eq('identifier_type', 'email')
      .gte('created_at', oneHourAgo);

    if ((count || 0) >= 5) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, phone')
      .ilike('email', emailAddr)
      .maybeSingle();

    const otpCode = generateOtp();
    const { data: otpRecord, error: insertError } = await supabase
      .from('public_otp_verifications')
      .insert({ identifier: emailAddr, identifier_type: 'email', otp_code: otpCode })
      .select('session_id')
      .single();

    if (insertError || !otpRecord) {
      console.error('OTP insert error:', insertError);
      throw new Error('Failed to create OTP');
    }

    // Only attempt delivery for a real account. Failures here are logged but
    // never thrown, so the response can't be used to infer existence either
    // by shape or by timing.
    if (profile) {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      if (RESEND_API_KEY) {
        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: 'In-Sync <verification@in-sync.co.in>',
              to: [emailAddr],
              subject: `${otpCode} is your In-Sync password reset code`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
                  <h2 style="color: #0f172a; margin-bottom: 8px;">Reset your password</h2>
                  <p style="color: #64748b; margin-bottom: 24px;">Use the code below to set a new password for your In-Sync account:</p>
                  <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0f172a;">${otpCode}</span>
                  </div>
                  <p style="color: #94a3b8; font-size: 13px;">This code expires in 5 minutes. If you didn't request a password reset, you can safely ignore this email.</p>
                </div>
              `,
            }),
          });
          if (!emailRes.ok) console.error('Resend send failed:', await emailRes.text());
        } catch (e) {
          console.error('Resend send error:', e);
        }
      } else {
        console.warn('No RESEND_API_KEY configured — email OTP not sent (test mode)');
      }

      if (profile.phone) {
        const cleanPhone = String(profile.phone).replace(/\D/g, '').slice(-10);
        if (cleanPhone.length === 10) {
          const { data: config } = await supabase
            .from('otp_whatsapp_config')
            .select('*')
            .eq('is_active', true)
            .limit(1)
            .single();

          if (config?.exotel_sid) {
            const toPhone = `91${cleanPhone}`;
            const fromNumber = config.whatsapp_source_number.replace('+', '');
            const payload = {
              custom_data: toPhone,
              whatsapp: {
                messages: [
                  {
                    from: fromNumber,
                    to: toPhone,
                    content: {
                      type: 'template',
                      template: {
                        name: 'otp',
                        language: { code: 'en' },
                        components: [
                          { type: 'body', parameters: [{ type: 'text', text: otpCode }] },
                          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otpCode }] },
                        ],
                      },
                    },
                  },
                ],
              },
            };
            const subdomain = config.exotel_subdomain || 'api.exotel.com';
            const url = `https://${config.exotel_api_key}:${config.exotel_api_token}@${subdomain}/v2/accounts/${config.exotel_sid}/messages`;
            try {
              const waRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
              if (!waRes.ok) console.error('Exotel send failed:', await waRes.text());
            } catch (e) {
              console.error('Exotel send error:', e);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: otpRecord.session_id,
        message: 'If an account exists for that email, a verification code has been sent to the email and WhatsApp number on file.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const err = error as Error;
    console.error('request-password-otp error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
