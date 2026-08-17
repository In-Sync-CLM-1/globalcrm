-- Fervent dashboard redesign: the geo view is now a global heatmap (was
-- India-only), which needs a country breakdown the cache didn't carry.
-- Domestic-vs-international classification itself stays client-side (the
-- country whitelist + alias table lives in countryData.ts, not duplicated
-- in SQL) — this just adds the raw by_country groupBy the frontend already
-- does for every other dimension, plus a matching filter option list.

ALTER TABLE fervent_dashboard_cache
  ADD COLUMN IF NOT EXISTS by_country JSONB NOT NULL DEFAULT '[]';

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
    by_industry, by_designation_level, by_status, by_state, by_city, by_designation, by_employee_size, by_company, by_country,
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
    (SELECT coalesce(jsonb_agg(jsonb_build_object('name', key, 'value', value) ORDER BY value DESC), '[]') FROM (
      SELECT coalesce(NULLIF(trim(country), ''), 'Unspecified') AS key, count(*) AS value FROM fervent_data_repository WHERE org_id = p_org_id GROUP BY 1
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
      'source', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(ucdb_status), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id),
      'country', (SELECT coalesce(jsonb_agg(DISTINCT coalesce(NULLIF(trim(country), ''), 'Unspecified')), '[]') FROM fervent_data_repository WHERE org_id = p_org_id)
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
    by_country = EXCLUDED.by_country,
    monthly_counts = EXCLUDED.monthly_counts,
    daily_counts = EXCLUDED.daily_counts,
    filter_options = EXCLUDED.filter_options,
    data_start_month = EXCLUDED.data_start_month,
    refreshed_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_fervent_dashboard_cache(UUID) TO service_role;

-- Refresh now so the new column is populated immediately rather than
-- waiting for the next 5-min cron tick.
SELECT public.refresh_fervent_dashboard_cache('6235726a-56f9-4851-9413-bc5cca39e90d'::uuid);
