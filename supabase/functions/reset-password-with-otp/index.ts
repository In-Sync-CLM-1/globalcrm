import { getSupabaseClient } from '../_shared/supabaseClient.ts';

// Second half of the OTP password-reset flow: verifies the code from
// request-password-otp and sets the new password in one call, so there's no
// separate "verify" round trip that could be replayed against a later
// password-set attempt. The OTP row is single-use — marked verified AND
// expired immediately on success so it can't be replayed within its window.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, otp, newPassword } = await req.json();

    if (!sessionId || !otp || !newPassword) {
      return new Response(
        JSON.stringify({ error: 'Session ID, code and new password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (String(newPassword).length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = getSupabaseClient();

    const { data: record, error: fetchError } = await supabase
      .from('public_otp_verifications')
      .select('*')
      .eq('session_id', sessionId)
      .is('verified_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (fetchError || !record) {
      return new Response(
        JSON.stringify({ error: 'Code expired or invalid. Please request a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (record.attempts >= record.max_attempts) {
      return new Response(
        JSON.stringify({ error: 'Too many incorrect attempts. Please request a new code.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (record.otp_code !== String(otp).trim()) {
      await supabase
        .from('public_otp_verifications')
        .update({ attempts: record.attempts + 1 })
        .eq('id', record.id);

      const remaining = record.max_attempts - record.attempts - 1;
      return new Response(
        JSON.stringify({ error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single-use from here: verified AND expired together so this exact code
    // can never be replayed, whether the password update below succeeds or not.
    const now = new Date().toISOString();
    await supabase
      .from('public_otp_verifications')
      .update({ verified_at: now, expires_at: now })
      .eq('id', record.id);

    // Same generic wording as a wrong code if there's no matching account —
    // request-password-otp never confirmed one exists, so this can't either.
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', record.identifier)
      .maybeSingle();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'Code expired or invalid. Please request a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, { password: newPassword });

    if (updateError) {
      console.error('Failed to update password:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to reset password. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Password updated. You can now log in.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const err = error as Error;
    console.error('reset-password-with-otp error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
