-- ============================================================
-- A seeded platform admin has not got a workspace to set up
-- ============================================================
-- ProtectedRoute sends anyone with onboarding_completed = false to the
-- onboarding wizard. Amit was given membership of existing, already-populated
-- organisations, so the wizard has nothing to do — it just blocks the app.
--
-- Applies only to platform admins that now hold an organisation; ordinary new
-- users still onboard normally.
-- ============================================================

UPDATE profiles
   SET onboarding_completed = true
 WHERE is_platform_admin = true
   AND org_id IS NOT NULL
   AND COALESCE(onboarding_completed, false) = false;
