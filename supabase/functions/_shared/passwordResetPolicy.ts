// Per-organisation switch for the Forgot password code (OTP) on the login page.
// organizations.settings.password_reset_otp.enabled = false turns it off for
// that organisation only (Ajimos, 2026-11-14); every other organisation keeps it.
// Users there change their password while signed in instead.
export const OTP_RESET_OFF_MESSAGE =
  'Password reset by code is not available for your organisation. Please ask your administrator to reset your password.';

export async function otpResetDisabledForUser(supabase: any, userId: string): Promise<boolean> {
  const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', userId).maybeSingle();
  if (!profile?.org_id) return false;
  const { data: org } = await supabase.from('organizations').select('settings').eq('id', profile.org_id).maybeSingle();
  return org?.settings?.password_reset_otp?.enabled === false;
}
