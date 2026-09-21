-- Adds a `category` column to contacts so a contact's originating data-type
-- (which sheet/list it came from) can be tracked separately from the
-- free-text `source` field, and backfills it for RMPL's already-imported
-- OPM database contacts (source values set by the earlier bulk import).
-- Also adds a small RPC so the dashboard can chart contact counts by
-- category without pulling every contact row to the client.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_contacts_org_category
  ON public.contacts(org_id, category)
  WHERE category IS NOT NULL;

-- Backfill RMPL's existing OPM database contacts by their known source label.
UPDATE public.contacts
SET category = 'Automobile Events'
WHERE org_id = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9'
  AND category IS NULL
  AND source = 'Bharat Mobility 2024';

UPDATE public.contacts
SET category = 'Automobile Manufacturers'
WHERE org_id = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9'
  AND category IS NULL
  AND source = 'OPM database - Automobile 2 (manufacturer directory)';

UPDATE public.contacts
SET category = 'Marketing P1/P2'
WHERE org_id = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9'
  AND category IS NULL
  AND source = 'OPM database - P1P2 prospect list';

UPDATE public.contacts
SET category = 'Marketing P3'
WHERE org_id = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9'
  AND category IS NULL
  AND source = 'OPM database - P3 prospect list';

UPDATE public.contacts
SET category = 'Existing Clients'
WHERE org_id = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9'
  AND category IS NULL
  AND source = 'OPM database - Client Data (existing clients)';

CREATE OR REPLACE FUNCTION public.get_contacts_by_category(p_org_id uuid)
RETURNS TABLE(category text, contact_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT c.category, COUNT(*) AS contact_count
  FROM contacts c
  WHERE c.org_id = p_org_id
    AND c.category IS NOT NULL
  GROUP BY c.category
  ORDER BY contact_count DESC;
$function$;
