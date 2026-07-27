-- Opt-in AI-assisted column mapping for contacts CSV uploads (same mapping
-- engine as Fervent's repository smart-upload, retargeted at the contacts
-- schema). Orgs with this off keep the existing exact-header requirement.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS smart_import_enabled boolean NOT NULL DEFAULT false;

UPDATE public.organizations
SET smart_import_enabled = true
WHERE slug IN ('rmpl', 'in-sync-demo');
