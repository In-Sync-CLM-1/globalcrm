-- =============================================================================
-- DIRECT USER-TO-USER "REPORTS TO" LINK
--
-- The only existing "reports to" concept is designations.reports_to_designation_id
-- -- a link between designation TEMPLATES, not people. That's misleading in a
-- flat org (like Fervent) where people don't have meaningfully distinct
-- designations at all: two people with the same (or no) designation can't be
-- put in a manager relationship through it, and a designation's reporting
-- line says nothing about who a specific person actually reports to.
--
-- reports_to_user_id is a direct profile-to-profile link, independent of
-- designation or role, so "X reports to Y" can be recorded for any two users
-- regardless of what their designations look like.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reports_to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_reports_to_not_self;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_reports_to_not_self CHECK (reports_to_user_id IS NULL OR reports_to_user_id <> id);

CREATE INDEX IF NOT EXISTS idx_profiles_reports_to_user_id ON public.profiles(reports_to_user_id) WHERE reports_to_user_id IS NOT NULL;
