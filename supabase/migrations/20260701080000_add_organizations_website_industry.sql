-- OnboardingWizard's business-profile step reads/writes organizations.website
-- and organizations.industry, but these columns were never created — every
-- org hits a PGRST204 "column not found in schema cache" (HTTP 400) the
-- moment they try to save that step. Add the columns the code already expects.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT;
