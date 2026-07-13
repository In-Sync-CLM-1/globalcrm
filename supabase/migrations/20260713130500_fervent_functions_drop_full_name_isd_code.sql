CREATE OR REPLACE FUNCTION public.find_fervent_duplicate_candidates(p_org_id uuid, p_records jsonb)
 RETURNS TABLE(incoming_idx integer, match_type text, existing_record jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH incoming AS (
    SELECT
      (r->>'idx')::integer AS idx,
      lower(regexp_replace(trim(COALESCE(r->>'first_name', '') || ' ' || COALESCE(r->>'last_name', '')), '\s+', ' ', 'g')) AS name_norm,
      NULLIF(right(regexp_replace(COALESCE(r->>'mobile_number_1', ''), '\D', '', 'g'), 10), '') AS phone1,
      NULLIF(right(regexp_replace(COALESCE(r->>'mobile_number_2', ''), '\D', '', 'g'), 10), '') AS phone2,
      NULLIF(lower(trim(COALESCE(r->>'official_email', ''))), '') AS email1,
      NULLIF(lower(trim(COALESCE(r->>'personal_email_1', ''))), '') AS email2,
      NULLIF(lower(trim(COALESCE(r->>'personal_email_2', ''))), '') AS email3
    FROM jsonb_array_elements(p_records) AS r
  ),
  existing AS (
    SELECT
      f.id, f.unique_id, f.first_name, f.last_name, f.company_name, f.designation, f.department,
      f.city, f.state, f.country, f.industry, f.linkedin_url,
      f.mobile_number_1, f.mobile_number_2, f.official_email,
      f.personal_email_1, f.personal_email_2,
      lower(regexp_replace(trim(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), '\s+', ' ', 'g')) AS name_norm,
      NULLIF(right(regexp_replace(COALESCE(f.mobile_number_1, ''), '\D', '', 'g'), 10), '') AS phone1,
      NULLIF(right(regexp_replace(COALESCE(f.mobile_number_2, ''), '\D', '', 'g'), 10), '') AS phone2,
      NULLIF(lower(trim(COALESCE(f.official_email, ''))), '') AS email1,
      NULLIF(lower(trim(COALESCE(f.personal_email_1, ''))), '') AS email2,
      NULLIF(lower(trim(COALESCE(f.personal_email_2, ''))), '') AS email3
    FROM public.fervent_data_repository f
    WHERE f.org_id = p_org_id
  ),
  matched AS (
    SELECT
      i.idx,
      CASE
        WHEN (i.phone1 IS NOT NULL AND length(i.phone1) >= 8 AND i.phone1 IN (e.phone1, e.phone2))
          OR (i.phone2 IS NOT NULL AND length(i.phone2) >= 8 AND i.phone2 IN (e.phone1, e.phone2))
        THEN 'phone'
        WHEN (i.email1 IS NOT NULL AND i.email1 IN (e.email1, e.email2, e.email3))
          OR (i.email2 IS NOT NULL AND i.email2 IN (e.email1, e.email2, e.email3))
          OR (i.email3 IS NOT NULL AND i.email3 IN (e.email1, e.email2, e.email3))
        THEN 'email'
        ELSE 'name'
      END AS match_type,
      e.*
    FROM incoming i
    JOIN existing e ON (
      (i.phone1 IS NOT NULL AND length(i.phone1) >= 8 AND i.phone1 IN (e.phone1, e.phone2))
      OR (i.phone2 IS NOT NULL AND length(i.phone2) >= 8 AND i.phone2 IN (e.phone1, e.phone2))
      OR (i.email1 IS NOT NULL AND i.email1 IN (e.email1, e.email2, e.email3))
      OR (i.email2 IS NOT NULL AND i.email2 IN (e.email1, e.email2, e.email3))
      OR (i.email3 IS NOT NULL AND i.email3 IN (e.email1, e.email2, e.email3))
      OR (i.name_norm <> '' AND i.name_norm = e.name_norm)
    )
  )
  SELECT
    m.idx,
    m.match_type,
    jsonb_build_object(
      'id', m.id,
      'unique_id', m.unique_id,
      'first_name', m.first_name,
      'last_name', m.last_name,
      'company_name', m.company_name,
      'designation', m.designation,
      'department', m.department,
      'city', m.city,
      'state', m.state,
      'country', m.country,
      'industry', m.industry,
      'linkedin_url', m.linkedin_url,
      'mobile_number_1', m.mobile_number_1,
      'mobile_number_2', m.mobile_number_2,
      'official_email', m.official_email,
      'personal_email_1', m.personal_email_1,
      'personal_email_2', m.personal_email_2
    )
  FROM matched m;
$function$;

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
      sub_industry text, employee_size text, turnover text, company_linkedin_url text
    )
  ),
  upserted AS (
    INSERT INTO public.fervent_data_repository (
      org_id, sr_no, unique_id, db_sourced_year, ucdb_status, company_name,
      first_name, last_name, designation, department, designation_level,
      city, state, country, std_code, mobile_number_1, mobile_number_2,
      direct_number, phone_number, official_email, personal_email_1, personal_email_2,
      linkedin_url, domain_name, website, industry, sub_industry, employee_size,
      turnover, company_linkedin_url, created_by, import_job_id, upload_status
    )
    SELECT p_org_id, sr_no, unique_id, db_sourced_year, ucdb_status, company_name,
      first_name, last_name, designation, department, designation_level,
      city, state, country, std_code, mobile_number_1, mobile_number_2,
      direct_number, phone_number, official_email, personal_email_1, personal_email_2,
      linkedin_url, domain_name, website, industry, sub_industry, employee_size,
      turnover, company_linkedin_url, p_created_by, p_import_job_id, 'fresh'
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
