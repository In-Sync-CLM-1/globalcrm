-- ============================================================
-- Close a cross-tenant hole in profiles
-- ============================================================
-- Access control across this schema resolves the caller's tenant and rank
-- from two columns of their own profile row:
--
--   get_user_org_id(uid)     -> SELECT org_id            FROM profiles WHERE id = uid
--   is_platform_admin(uid)   -> SELECT is_platform_admin FROM profiles WHERE id = uid
--
-- The policy "Users can update their own profile" is USING (id = auth.uid())
-- with no column restriction, so a user could rewrite either column on their
-- own row and move themselves into another customer's data.
--
-- Proven against production inside a rolled-back transaction, as an ordinary
-- (non platform-admin) In-Sync Demo user who can read contacts:
--
--   sees in own org (In-Sync Demo) : 62553 contacts
--   moved into RMPL                : 710 contacts   <-- another customer's data
--   moved into IEDUP               : 0  (that org is billing-locked, which is
--                                        what stopped it — not the access rules)
--
-- Self-promotion via is_platform_admin = true was likewise allowed.
--
-- A policy cannot restrict which columns an UPDATE touches: WITH CHECK sees
-- only the new row, so it cannot tell that org_id changed. Column privileges
-- can. Note that revoking single columns is not enough while the role holds a
-- TABLE-level UPDATE grant (the Supabase default), which permits every column
-- regardless — the table grant has to go first, then the safe columns are
-- granted back.
--
-- Columns granted back are exactly those the app writes from the browser
-- (phone, is_active, onboarding_completed) plus the display fields a person
-- edits about themselves. Organisation, platform rank, designation and
-- reporting line are set by admin flows under the service role, which these
-- grants do not affect.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon;
REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  first_name,
  last_name,
  avatar_url,
  phone,
  is_active,
  onboarding_completed,
  calling_enabled,
  whatsapp_enabled,
  email_enabled,
  sms_enabled,
  updated_at
) ON public.profiles TO authenticated;
