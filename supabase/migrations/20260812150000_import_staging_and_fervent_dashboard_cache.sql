-- Part 1: generic chained-import staging (applies to every org/import_type
-- that goes through process-bulk-import, not just Fervent). A large upload
-- no longer needs to fit inside one function invocation's execution window:
-- rows are staged once (cheap, no dedup/AI work), then a chained claim loop
-- processes bounded slices, self-continuing until nothing pending remains.
-- Cost per chain link is now independent of total file size, so the old
-- fixed record-count ceilings are no longer a technical necessity.

CREATE TABLE IF NOT EXISTS import_staging (
  id BIGSERIAL PRIMARY KEY,
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  record JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_staging_pending
  ON import_staging (import_job_id, row_index)
  WHERE processed = false;

CREATE TABLE IF NOT EXISTS import_skipped_rows (
  id BIGSERIAL PRIMARY KEY,
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  values JSONB NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_skipped_rows_job
  ON import_skipped_rows (import_job_id);

ALTER TABLE import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_skipped_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage import staging" ON import_staging;
CREATE POLICY "Service role can manage import staging"
  ON import_staging FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage import skipped rows" ON import_skipped_rows;
CREATE POLICY "Service role can manage import skipped rows"
  ON import_skipped_rows FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Part 2: Fervent dashboard cache. FerventDashboard.tsx pulled every row of
-- fervent_data_repository into the browser (1,000-row pages, looped) on every
-- page load, then aggregated client-side. That scales with total repository
-- size, which is no longer bounded now that imports can grow unlimited. This
-- cache holds pre-aggregated breakdowns (same shape the dashboard already
-- computes via groupBy) so the page can paint instantly; the frontend still
-- loads the full row set in the background for drilldown/filtering, it just
-- no longer blocks the initial render on that fetch.

CREATE TABLE IF NOT EXISTS fervent_dashboard_cache (
  org_id UUID PRIMARY KEY,
  total_count INTEGER NOT NULL DEFAULT 0,
  companies_count INTEGER NOT NULL DEFAULT 0,
  with_email_count INTEGER NOT NULL DEFAULT 0,
  with_mobile_count INTEGER NOT NULL DEFAULT 0,
  industries_count INTEGER NOT NULL DEFAULT 0,
  added_this_month_count INTEGER NOT NULL DEFAULT 0,
  missing_both_count INTEGER NOT NULL DEFAULT 0,
  missing_email_only_count INTEGER NOT NULL DEFAULT 0,
  missing_mobile_only_count INTEGER NOT NULL DEFAULT 0,
  by_industry JSONB NOT NULL DEFAULT '[]',
  by_designation_level JSONB NOT NULL DEFAULT '[]',
  by_status JSONB NOT NULL DEFAULT '[]',
  by_state JSONB NOT NULL DEFAULT '[]',
  by_city JSONB NOT NULL DEFAULT '[]',
  by_designation JSONB NOT NULL DEFAULT '[]',
  by_employee_size JSONB NOT NULL DEFAULT '[]',
  by_company JSONB NOT NULL DEFAULT '[]',
  monthly_counts JSONB NOT NULL DEFAULT '{}',
  daily_counts JSONB NOT NULL DEFAULT '{}',
  filter_options JSONB NOT NULL DEFAULT '{}',
  data_start_month DATE,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fervent_dashboard_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage fervent dashboard cache" ON fervent_dashboard_cache;
CREATE POLICY "Service role can manage fervent dashboard cache"
  ON fervent_dashboard_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Org members can read their fervent dashboard cache" ON fervent_dashboard_cache;
CREATE POLICY "Org members can read their fervent dashboard cache"
  ON fervent_dashboard_cache FOR SELECT TO authenticated
  USING (org_id = get_user_org_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.refresh_fervent_dashboard_cache(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  v_total INTEGER;
  v_companies INTEGER;
  v_with_email INTEGER;
  v_with_mobile INTEGER;
  v_industries INTEGER;
  v_added_this_month INTEGER;
  v_missing_both INTEGER;
  v_missing_email_only INTEGER;
  v_missing_mobile_only INTEGER;
  v_data_start DATE;
BEGIN
  SELECT
    count(*),
    count(DISTINCT NULLIF(trim(company_name), '')),
    count(*) FILTER (WHERE coalesce(trim(official_email), '') <> '' OR coalesce(trim(personal_email_1), '') <> '' OR coalesce(trim(personal_email_2), '') <> ''),
    count(*) FILTER (WHERE coalesce(trim(mobile_number_1), '') <> ''),
    count(DISTINCT NULLIF(trim(industry), '')),
    count(*) FILTER (WHERE created_at >= date_trunc('month', now())),
    count(*) FILTER (WHERE coalesce(trim(official_email), '') = '' AND coalesce(trim(personal_email_1), '') = '' AND coalesce(trim(personal_email_2), '') = '' AND coalesce(trim(mobile_number_1), '') = ''),
    count(*) FILTER (WHERE coalesce(trim(official_email), '') = '' AND coalesce(trim(personal_email_1), '') = '' AND coalesce(trim(personal_email_2), '') = '' AND coalesce(trim(mobile_number_1), '') <> ''),
    count(*) FILTER (WHERE (coalesce(trim(official_email), '') <> '' OR coalesce(trim(personal_email_1), '') <> '' OR coalesce(trim(personal_email_2), '') <> '') AND coalesce(trim(mobile_number_1), '') = ''),
    min(date_trunc('month', created_at))::date
  INTO v_total, v_companies, v_with_email, v_with_mobile, v_industries, v_added_this_month, v_missing_both, v_missing_email_only, v_missing_mobile_only, v_data_start
  FROM fervent_data_repository WHERE org_id = p_org_id;

  INSERT INTO fervent_dashboard_cache AS c (
    org_id, total_count, companies_count, with_email_count, with_mobile_count, industries_count,
    added_this_month_count, missing_both_count, missing_email_only_count, missing_mobile_only_count,
    by_industry, by_designation_level, by_status, by_state, by_city, by_designation, by_employee_size, by_company,
    monthly_counts, daily_counts, filter_options, data_start_month, refreshed_at
  )
  VALUES (
    p_org_id, coalesce(v_total, 0), coalesce(v_companies, 0), coalesce(v_with_email, 0), coalesce(v_with_mobile, 0), coalesce(v_industries, 0),
    coalesce(v_added_this_month, 0), coalesce(v_missing_both, 0), coalesce(v_missing_email_only, 0), coalesce(v_missing_mobile_only, 0),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(industry), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(designation_level), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(ucdb_status), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(state), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(city), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(designation), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(employee_size), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(company_name), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1 ORDER BY 2 DESC LIMIT 200
    ) t),
    (SELECT coalesce(jsonb_object_agg(key, value), '{}') FROM (
      SELECT to_char(created_at, 'YYYY-MM') AS key, count(*) AS value FROM fervent_data_repository
      WHERE org_id = p_org_id AND created_at >= now() - interval '13 months' GROUP BY 1
    ) t),
    (SELECT coalesce(jsonb_object_agg(key, value), '{}') FROM (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS key, count(*) AS value FROM fervent_data_repository
      WHERE org_id = p_org_id AND created_at >= now() - interval '100 days' GROUP BY 1
    ) t),
    jsonb_build_object(
      'industry', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(industry), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id),
      'designationLevel', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(designation_level), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id),
      'designation', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(designation), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id),
      'city', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(city), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id),
      'state', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(state), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id),
      'source', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(ucdb_status), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id)
    ),
    v_data_start,
    now()
  )
  ON CONFLICT (org_id) DO UPDATE SET
    total_count = EXCLUDED.total_count,
    companies_count = EXCLUDED.companies_count,
    with_email_count = EXCLUDED.with_email_count,
    with_mobile_count = EXCLUDED.with_mobile_count,
    industries_count = EXCLUDED.industries_count,
    added_this_month_count = EXCLUDED.added_this_month_count,
    missing_both_count = EXCLUDED.missing_both_count,
    missing_email_only_count = EXCLUDED.missing_email_only_count,
    missing_mobile_only_count = EXCLUDED.missing_mobile_only_count,
    by_industry = EXCLUDED.by_industry,
    by_designation_level = EXCLUDED.by_designation_level,
    by_status = EXCLUDED.by_status,
    by_state = EXCLUDED.by_state,
    by_city = EXCLUDED.by_city,
    by_designation = EXCLUDED.by_designation,
    by_employee_size = EXCLUDED.by_employee_size,
    by_company = EXCLUDED.by_company,
    monthly_counts = EXCLUDED.monthly_counts,
    daily_counts = EXCLUDED.daily_counts,
    filter_options = EXCLUDED.filter_options,
    data_start_month = EXCLUDED.data_start_month,
    refreshed_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_fervent_dashboard_cache(UUID) TO service_role;

-- Convenience zero-arg wrapper for the cron worker (matches RMPL's
-- refresh_master_caches()/refresh_demandcom_caches() no-arg RPC pattern).
CREATE OR REPLACE FUNCTION public.refresh_fervent_dashboard_cache_cron()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.refresh_fervent_dashboard_cache('6235726a-56f9-4851-9413-bc5cca39e90d'::uuid);
$$;

GRANT EXECUTE ON FUNCTION public.refresh_fervent_dashboard_cache_cron() TO service_role;
