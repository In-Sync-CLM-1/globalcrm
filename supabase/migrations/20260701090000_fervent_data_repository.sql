-- Fervent Communication: exclusive vendor/lead database repository.
-- Same pattern as redefine_data_repository (org-slug-gated table, no shared
-- contacts schema impact) — this org uses the data purely as an
-- import/filter/export reference list, not as CRM-worked contacts.
CREATE TABLE public.fervent_data_repository (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  sr_no INTEGER,
  unique_id TEXT,
  db_sourced_year INTEGER,
  ucdb_status TEXT,

  company_name TEXT,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  designation TEXT,
  department TEXT,
  designation_level TEXT,

  city TEXT,
  state TEXT,
  country TEXT,
  isd_code TEXT,
  std_code TEXT,

  mobile_number_1 TEXT,
  mobile_number_2 TEXT,
  direct_number TEXT,
  phone_number TEXT,
  official_email TEXT,
  personal_email_1 TEXT,
  personal_email_2 TEXT,
  linkedin_url TEXT,

  domain_name TEXT,
  website TEXT,
  industry TEXT,
  sub_industry TEXT,
  employee_size TEXT,
  turnover TEXT,
  company_linkedin_url TEXT,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.fervent_data_repository ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only Fervent org can access repository"
ON public.fervent_data_repository FOR ALL
TO authenticated
USING (
  org_id = get_user_org_id(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = fervent_data_repository.org_id
    AND slug = 'fervent-communication'
  )
);

CREATE POLICY "Service role can manage all fervent repository data"
ON public.fervent_data_repository FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_fervent_repo_org_id ON public.fervent_data_repository(org_id);
CREATE INDEX idx_fervent_repo_company ON public.fervent_data_repository(company_name);
CREATE INDEX idx_fervent_repo_created_at ON public.fervent_data_repository(created_at DESC);
CREATE INDEX idx_fervent_repo_email ON public.fervent_data_repository(official_email);
CREATE INDEX idx_fervent_repo_mobile ON public.fervent_data_repository(mobile_number_1);
CREATE INDEX idx_fervent_repo_unique_id ON public.fervent_data_repository(org_id, unique_id);

CREATE INDEX idx_fervent_repo_search ON public.fervent_data_repository
  USING gin(to_tsvector('english',
    coalesce(full_name, '') || ' ' ||
    coalesce(company_name, '') || ' ' ||
    coalesce(designation, '') || ' ' ||
    coalesce(city, '') || ' ' ||
    coalesce(industry, '')
  ));

CREATE TRIGGER update_fervent_repository_updated_at
BEFORE UPDATE ON public.fervent_data_repository
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Feature flag: gates both the nav link/page and canAccessFeature() checks.
-- Only Fervent gets this enabled, so the feature is invisible everywhere else.
INSERT INTO public.feature_permissions (
  feature_key, feature_name, feature_description, category, is_premium
) VALUES (
  'fervent_data_repository',
  'Fervent Data Repository',
  'Exclusive vendor/lead database repository for Fervent Communication',
  'Data Management',
  false
) ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO public.org_feature_access (org_id, feature_key, is_enabled, enabled_at)
SELECT id, 'fervent_data_repository', true, NOW()
FROM public.organizations
WHERE slug = 'fervent-communication'
ON CONFLICT (org_id, feature_key) DO UPDATE SET is_enabled = true, enabled_at = NOW();

-- Fix a pre-existing typo blocking bulk-delete on the Redefine repository
-- ('redefine_repository' never matched the real table name
-- 'redefine_data_repository'), and register the new Fervent table.
CREATE OR REPLACE FUNCTION public.bulk_delete_verified(_table_name text, _record_ids uuid[], _org_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INT;
  valid_tables TEXT[] := ARRAY[
    'contacts', 'clients', 'tasks', 'client_invoices',
    'client_documents', 'contact_activities', 'email_templates',
    'forms', 'teams', 'inventory_items', 'redefine_data_repository',
    'fervent_data_repository'
  ];
  records_in_org INT;
BEGIN
  IF NOT (_table_name = ANY(valid_tables)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid table name: ' || _table_name
    );
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM %I WHERE id = ANY($1) AND org_id = $2',
    _table_name
  ) INTO records_in_org USING _record_ids, _org_id;

  IF records_in_org != array_length(_record_ids, 1) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Some records do not belong to the organization',
      'found', records_in_org,
      'requested', array_length(_record_ids, 1)
    );
  END IF;

  EXECUTE format(
    'DELETE FROM %I WHERE id = ANY($1) AND org_id = $2',
    _table_name
  ) USING _record_ids, _org_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', deleted_count,
    'table', _table_name
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$function$;
