-- =============================================================================
-- FERVENT REPOSITORY: INSERT-OR-UPDATE ON RE-UPLOAD
--
-- Previously, when a re-uploaded row matched an existing record (by Unique ID,
-- or by Mobile/Email when no Unique ID was given), the new row was silently
-- discarded — reported as a "duplicate skipped". Any refreshed data on that
-- row (new phone, updated designation, etc.) was lost.
--
-- New rule (Unique ID is the reliable match key each contact is given):
--   - Unique ID matches an existing record for this org -> UPDATE that record
--     with every field from the new upload (latest upload always wins, same
--     "prefer latest" precedent as the 2026-07-08 duplicate-merge cleanup).
--   - Unique ID has no match -> INSERT as a new record.
--   - No Unique ID on the row at all -> unchanged fallback behaviour: dedupe
--     against Mobile Number 1 / Official Email and skip if it matches (no safe
--     key to update against, so we don't guess).
--
-- `upload_status` records, per record, which of those two things last happened
-- to it: 'fresh' (first-ever insert) or 'existing' (matched and updated).
-- =============================================================================

alter table public.fervent_data_repository
  add column if not exists upload_status text not null default 'fresh';

alter table public.fervent_data_repository
  drop constraint if exists fervent_data_repository_upload_status_check;

alter table public.fervent_data_repository
  add constraint fervent_data_repository_upload_status_check
  check (upload_status in ('fresh', 'existing'));

-- Backing index for both the ON CONFLICT upsert below and future unique_id
-- lookups. Partial (unique_id can be null; nulls are excluded so multiple
-- rows without a Unique ID never collide).
drop index if exists public.idx_fervent_repo_org_unique_id;
create unique index idx_fervent_repo_org_unique_id
  on public.fervent_data_repository (org_id, unique_id)
  where unique_id is not null;

-- Bulk insert-or-update for one import batch. Records with a unique_id are
-- upserted (matched rows get every field overwritten with the new values,
-- upload_status set to 'existing'); records without one are always inserted
-- fresh (the caller has already deduped those against Mobile/Official Email).
CREATE OR REPLACE FUNCTION public.upsert_fervent_repository_batch(
  p_org_id uuid,
  p_created_by uuid,
  p_import_job_id uuid,
  p_records jsonb
)
RETURNS TABLE(inserted_count integer, updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH incoming AS (
    SELECT * FROM jsonb_to_recordset(p_records) AS r(
      sr_no integer, unique_id text, db_sourced_year integer, ucdb_status text,
      company_name text, first_name text, last_name text, full_name text,
      designation text, department text, designation_level text,
      city text, state text, country text, isd_code text, std_code text,
      mobile_number_1 text, mobile_number_2 text, direct_number text, phone_number text,
      official_email text, personal_email_1 text, personal_email_2 text,
      linkedin_url text, domain_name text, website text, industry text,
      sub_industry text, employee_size text, turnover text, company_linkedin_url text
    )
  ),
  upserted AS (
    INSERT INTO public.fervent_data_repository (
      org_id, sr_no, unique_id, db_sourced_year, ucdb_status, company_name,
      first_name, last_name, full_name, designation, department, designation_level,
      city, state, country, isd_code, std_code, mobile_number_1, mobile_number_2,
      direct_number, phone_number, official_email, personal_email_1, personal_email_2,
      linkedin_url, domain_name, website, industry, sub_industry, employee_size,
      turnover, company_linkedin_url, created_by, import_job_id, upload_status
    )
    SELECT p_org_id, sr_no, unique_id, db_sourced_year, ucdb_status, company_name,
      first_name, last_name, full_name, designation, department, designation_level,
      city, state, country, isd_code, std_code, mobile_number_1, mobile_number_2,
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
      full_name = EXCLUDED.full_name,
      designation = EXCLUDED.designation,
      department = EXCLUDED.department,
      designation_level = EXCLUDED.designation_level,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      country = EXCLUDED.country,
      isd_code = EXCLUDED.isd_code,
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
$$;

GRANT EXECUTE ON FUNCTION public.upsert_fervent_repository_batch(uuid, uuid, uuid, jsonb) TO service_role;

-- Track updates alongside inserts/skips on the import job for reporting.
alter table public.import_jobs
  add column if not exists updated_count integer;
