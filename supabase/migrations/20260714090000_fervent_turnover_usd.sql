-- Correction: the turnover range filter should be normalized to USD, not
-- INR — INR entries (crore/lakh) convert to USD at a flat reference rate of
-- INR 100 = USD 1 (for filtering/reference only, not real accounting).
-- Already-USD legacy values ("$100B+") no longer need to be skipped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fervent_data_repository' AND column_name = 'turnover_inr_million'
  ) THEN
    ALTER TABLE public.fervent_data_repository RENAME COLUMN turnover_inr_million TO turnover_usd_million;
  END IF;
END $$;

COMMENT ON COLUMN public.fervent_data_repository.turnover_usd_million IS
  'Turnover normalized to USD millions for the min/max range filter. INR crore/lakh entries are converted at a flat reference rate (INR 100 = USD 1); NULL when the free-text turnover value could not be parsed at all.';

-- Rebuild from scratch: the values that landed under the old INR-normalized
-- column are the wrong unit, so clear and re-derive from the raw text.
UPDATE public.fervent_data_repository SET turnover_usd_million = NULL WHERE turnover IS NOT NULL;

UPDATE public.fervent_data_repository
SET turnover_usd_million = (regexp_match(turnover, '([0-9]+(?:\.[0-9]+)?)\s*(cr|crore)', 'i'))[1]::numeric * 10 / 100
WHERE turnover IS NOT NULL
  AND turnover ~* '[0-9](\.[0-9]+)?\s*(cr|crore)\y'
  AND turnover_usd_million IS NULL;

UPDATE public.fervent_data_repository
SET turnover_usd_million = (regexp_match(turnover, '([0-9]+(?:\.[0-9]+)?)\s*(lakh|lac)', 'i'))[1]::numeric * 0.1 / 100
WHERE turnover IS NOT NULL
  AND turnover ~* '[0-9](\.[0-9]+)?\s*(lakh|lac)\y'
  AND turnover_usd_million IS NULL;

UPDATE public.fervent_data_repository
SET turnover_usd_million = (regexp_match(turnover, '([0-9]+(?:\.[0-9]+)?)\s*(bn|billion|b)', 'i'))[1]::numeric * 1000
WHERE turnover IS NOT NULL
  AND turnover ~* '[0-9](\.[0-9]+)?\s*(bn|billion|b)\y'
  AND turnover_usd_million IS NULL;

UPDATE public.fervent_data_repository
SET turnover_usd_million = (regexp_match(turnover, '([0-9]+(?:\.[0-9]+)?)\s*(mn|million|m)', 'i'))[1]::numeric
WHERE turnover IS NOT NULL
  AND turnover ~* '[0-9](\.[0-9]+)?\s*(mn|million|m)\y'
  AND turnover_usd_million IS NULL;

CREATE OR REPLACE FUNCTION public.merge_fervent_repository_batch(p_org_id uuid, p_import_job_id uuid, p_merges jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH m AS (
    SELECT
      (e->>'target_id')::uuid AS target_id,
      e->'record' AS r
    FROM jsonb_array_elements(p_merges) AS e
  ),
  updated AS (
    UPDATE public.fervent_data_repository f
    SET
      sr_no = COALESCE(NULLIF(m.r->>'sr_no', '')::integer, f.sr_no),
      db_sourced_year = COALESCE(NULLIF(m.r->>'db_sourced_year', '')::integer, f.db_sourced_year),
      ucdb_status = COALESCE(NULLIF(trim(m.r->>'ucdb_status'), ''), f.ucdb_status),
      company_name = COALESCE(NULLIF(trim(m.r->>'company_name'), ''), f.company_name),
      first_name = COALESCE(NULLIF(trim(m.r->>'first_name'), ''), f.first_name),
      last_name = COALESCE(NULLIF(trim(m.r->>'last_name'), ''), f.last_name),
      designation = COALESCE(NULLIF(trim(m.r->>'designation'), ''), f.designation),
      department = COALESCE(NULLIF(trim(m.r->>'department'), ''), f.department),
      designation_level = COALESCE(NULLIF(trim(m.r->>'designation_level'), ''), f.designation_level),
      city = COALESCE(NULLIF(trim(m.r->>'city'), ''), f.city),
      state = COALESCE(NULLIF(trim(m.r->>'state'), ''), f.state),
      country = COALESCE(NULLIF(trim(m.r->>'country'), ''), f.country),
      std_code = COALESCE(NULLIF(trim(m.r->>'std_code'), ''), f.std_code),
      mobile_number_1 = COALESCE(NULLIF(trim(m.r->>'mobile_number_1'), ''), f.mobile_number_1),
      mobile_number_2 = COALESCE(NULLIF(trim(m.r->>'mobile_number_2'), ''), f.mobile_number_2),
      direct_number = COALESCE(NULLIF(trim(m.r->>'direct_number'), ''), f.direct_number),
      phone_number = COALESCE(NULLIF(trim(m.r->>'phone_number'), ''), f.phone_number),
      official_email = COALESCE(NULLIF(trim(m.r->>'official_email'), ''), f.official_email),
      personal_email_1 = COALESCE(NULLIF(trim(m.r->>'personal_email_1'), ''), f.personal_email_1),
      personal_email_2 = COALESCE(NULLIF(trim(m.r->>'personal_email_2'), ''), f.personal_email_2),
      linkedin_url = COALESCE(NULLIF(trim(m.r->>'linkedin_url'), ''), f.linkedin_url),
      domain_name = COALESCE(NULLIF(trim(m.r->>'domain_name'), ''), f.domain_name),
      website = COALESCE(NULLIF(trim(m.r->>'website'), ''), f.website),
      industry = COALESCE(NULLIF(trim(m.r->>'industry'), ''), f.industry),
      sub_industry = COALESCE(NULLIF(trim(m.r->>'sub_industry'), ''), f.sub_industry),
      employee_size = COALESCE(NULLIF(trim(m.r->>'employee_size'), ''), f.employee_size),
      turnover = COALESCE(NULLIF(trim(m.r->>'turnover'), ''), f.turnover),
      turnover_usd_million = COALESCE(NULLIF(m.r->>'turnover_usd_million', '')::numeric, f.turnover_usd_million),
      company_linkedin_url = COALESCE(NULLIF(trim(m.r->>'company_linkedin_url'), ''), f.company_linkedin_url),
      import_job_id = p_import_job_id,
      upload_status = 'existing',
      updated_at = now()
    FROM m
    WHERE f.id = m.target_id
      AND f.org_id = p_org_id
    RETURNING f.id
  )
  SELECT count(*)::integer INTO v_count FROM updated;

  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_fervent_repository_batch(p_org_id uuid, p_created_by uuid, p_import_job_id uuid, p_records jsonb)
 RETURNS TABLE(inserted_count integer, updated_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH incoming AS (
    SELECT * FROM jsonb_to_recordset(p_records) AS r(
      sr_no integer, unique_id text, db_sourced_year integer, ucdb_status text,
      company_name text, first_name text, last_name text,
      designation text, department text, designation_level text,
      city text, state text, country text, std_code text,
      mobile_number_1 text, mobile_number_2 text, direct_number text, phone_number text,
      official_email text, personal_email_1 text, personal_email_2 text,
      linkedin_url text, domain_name text, website text, industry text,
      sub_industry text, employee_size text, turnover text, turnover_usd_million numeric,
      company_linkedin_url text
    )
  ),
  upserted AS (
    INSERT INTO public.fervent_data_repository (
      org_id, sr_no, unique_id, db_sourced_year, ucdb_status, company_name,
      first_name, last_name, designation, department, designation_level,
      city, state, country, std_code, mobile_number_1, mobile_number_2,
      direct_number, phone_number, official_email, personal_email_1, personal_email_2,
      linkedin_url, domain_name, website, industry, sub_industry, employee_size,
      turnover, turnover_usd_million, company_linkedin_url, created_by, import_job_id, upload_status
    )
    SELECT p_org_id, sr_no, unique_id, db_sourced_year, ucdb_status, company_name,
      first_name, last_name, designation, department, designation_level,
      city, state, country, std_code, mobile_number_1, mobile_number_2,
      direct_number, phone_number, official_email, personal_email_1, personal_email_2,
      linkedin_url, domain_name, website, industry, sub_industry, employee_size,
      turnover, turnover_usd_million, company_linkedin_url, p_created_by, p_import_job_id, 'fresh'
    FROM incoming
    ON CONFLICT (org_id, unique_id) WHERE unique_id IS NOT NULL
    DO UPDATE SET
      sr_no = EXCLUDED.sr_no,
      db_sourced_year = EXCLUDED.db_sourced_year,
      ucdb_status = EXCLUDED.ucdb_status,
      company_name = EXCLUDED.company_name,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      designation = EXCLUDED.designation,
      department = EXCLUDED.department,
      designation_level = EXCLUDED.designation_level,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      country = EXCLUDED.country,
      std_code = EXCLUDED.std_code,
      mobile_number_1 = EXCLUDED.mobile_number_1,
      mobile_number_2 = EXCLUDED.mobile_number_2,
      direct_number = EXCLUDED.direct_number,
      phone_number = EXCLUDED.phone_number,
      official_email = EXCLUDED.official_email,
      personal_email_1 = EXCLUDED.personal_email_1,
      personal_email_2 = EXCLUDED.personal_email_2,
      linkedin_url = EXCLUDED.linkedin_url,
      domain_name = EXCLUDED.domain_name,
      website = EXCLUDED.website,
      industry = EXCLUDED.industry,
      sub_industry = EXCLUDED.sub_industry,
      employee_size = EXCLUDED.employee_size,
      turnover = EXCLUDED.turnover,
      turnover_usd_million = EXCLUDED.turnover_usd_million,
      company_linkedin_url = EXCLUDED.company_linkedin_url,
      import_job_id = EXCLUDED.import_job_id,
      upload_status = 'existing',
      updated_at = now()
    RETURNING (xmax = 0) AS was_insert
  )
  SELECT
    count(*) FILTER (WHERE was_insert)::integer,
    count(*) FILTER (WHERE NOT was_insert)::integer
  FROM upserted;
END;
$function$;
