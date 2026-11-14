-- Ajimos only (user, 2026-11-14): no Forgot password code (OTP) for Ajimos users.
-- They change their password while signed in. Other organisations keep the code reset.
-- Read by supabase/functions/_shared/passwordResetPolicy.ts.
update public.organizations
   set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{password_reset_otp}', '{"enabled": false}'::jsonb, true)
 where slug = 'ajimos';
