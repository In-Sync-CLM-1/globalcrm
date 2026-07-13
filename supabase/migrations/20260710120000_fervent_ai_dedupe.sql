-- =============================================================================
-- FERVENT REPOSITORY: AI DUPLICATE CONTAINMENT + OPTIONAL UNIQUE ID
--
-- Uploads are distributed — different people upload extracts from different
-- source databases, so the same person routinely arrives again carrying a
-- different (or no) Unique ID. Until now such a row was inserted as a brand
-- new record and the repository accumulated duplicates.
--
-- New pipeline (process-bulk-import):
--   1. Unique ID matches an existing record        -> UPDATE (unchanged rule).
--   2. No match on Unique ID -> duplicate containment before insert:
--      a. exact phone / email overlap with an existing record -> merge into it
--      b. same normalised full name, no contact overlap -> Groq AI verifies
--         "same person?" from company/designation/location context; confirmed
--         matches merge, the rest insert as new.
--   3. Rows still new after containment get a system-assigned Unique ID
--      (FERVENT-nnnnnn, continuing the backfill series) when they carry none.
--
-- Merge semantics ("overwrite" per business decision 2026-07-10): incoming
-- non-empty values replace the existing ones; empty cells never blank out
-- data already held. The matched record keeps its repository Unique ID.
--
-- All functions are CREATE OR REPLACE so CI re-application is a no-op.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- System-assigned Unique IDs: next N ids in the FERVENT-nnnnnn series for an
-- org. Advisory-locked so two concurrent callers can never mint the same id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_fervent_unique_ids(
  p_org_id uuid,
  p_count integer
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max bigint;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN ARRAY[]::text[];
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fervent_unique_id:' || p_org_id::text));

  SELECT COALESCE(MAX((substring(unique_id FROM '^FERVENT-(\d+)$'))::bigint), 0)
  INTO v_max
  FROM public.fervent_data_repository
  WHERE org_id = p_org_id
    AND unique_id ~ '^FERVENT-\d+$';

  RETURN (
    SELECT array_agg('FERVENT-' || lpad((v_max + g)::text, 6, '0') ORDER BY g)
    FROM generate_series(1, p_count) AS g
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_fervent_unique_ids(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Duplicate candidates for a batch of incoming rows that had no Unique ID
-- match. p_records: [{"idx": 0, "full_name": ..., "mobile_number_1": ...,
-- "mobile_number_2": ..., "official_email": ..., "personal_email_1": ...,
-- "personal_email_2": ...}, ...]
--
-- Matching, in order of confidence:
--   phone  — any incoming mobile equals any existing mobile, compared on the
--            last 10 digits so +91 / 0-prefix / formatting differences match
--   email  — any incoming email equals any existing email, case-insensitive
--   name   — normalised full name equal (the ambiguous tier the AI resolves)
--
-- One row per (incoming idx, existing record) with the strongest match type.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_fervent_duplicate_candidates(
  p_org_id uuid,
  p_records jsonb
)
RETURNS TABLE(incoming_idx integer, match_type text, existing_record jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH incoming AS (
    SELECT
      (r->>'idx')::integer AS idx,
      lower(regexp_replace(trim(COALESCE(r->>'full_name', '')), '\s+', ' ', 'g')) AS name_norm,
      NULLIF(right(regexp_replace(COALESCE(r->>'mobile_number_1', ''), '\D', '', 'g'), 10), '') AS phone1,
      NULLIF(right(regexp_replace(COALESCE(r->>'mobile_number_2', ''), '\D', '', 'g'), 10), '') AS phone2,
      NULLIF(lower(trim(COALESCE(r->>'official_email', ''))), '') AS email1,
      NULLIF(lower(trim(COALESCE(r->>'personal_email_1', ''))), '') AS email2,
      NULLIF(lower(trim(COALESCE(r->>'personal_email_2', ''))), '') AS email3
    FROM jsonb_array_elements(p_records) AS r
  ),
  existing AS (
    SELECT
      f.id, f.unique_id, f.full_name, f.company_name, f.designation, f.department,
      f.city, f.state, f.country, f.industry, f.linkedin_url,
      f.mobile_number_1, f.mobile_number_2, f.official_email,
      f.personal_email_1, f.personal_email_2,
      lower(regexp_replace(trim(COALESCE(f.full_name, '')), '\s+', ' ', 'g')) AS name_norm,
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
      'full_name', m.full_name,
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
$$;

GRANT EXECUTE ON FUNCTION public.find_fervent_duplicate_candidates(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Merge confirmed-duplicate incoming rows into their existing records.
-- p_merges: [{"target_id": "<uuid>", "record": {<fervent columns>}}, ...]
-- Incoming non-empty values overwrite; empty/missing values keep what's there.
-- The record keeps its existing unique_id (repository identity is stable).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_fervent_repository_batch(
  p_org_id uuid,
  p_import_job_id uuid,
  p_merges jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      full_name = COALESCE(NULLIF(trim(m.r->>'full_name'), ''), f.full_name),
      designation = COALESCE(NULLIF(trim(m.r->>'designation'), ''), f.designation),
      department = COALESCE(NULLIF(trim(m.r->>'department'), ''), f.department),
      designation_level = COALESCE(NULLIF(trim(m.r->>'designation_level'), ''), f.designation_level),
      city = COALESCE(NULLIF(trim(m.r->>'city'), ''), f.city),
      state = COALESCE(NULLIF(trim(m.r->>'state'), ''), f.state),
      country = COALESCE(NULLIF(trim(m.r->>'country'), ''), f.country),
      isd_code = COALESCE(NULLIF(trim(m.r->>'isd_code'), ''), f.isd_code),
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
$$;

GRANT EXECUTE ON FUNCTION public.merge_fervent_repository_batch(uuid, uuid, jsonb) TO service_role;
