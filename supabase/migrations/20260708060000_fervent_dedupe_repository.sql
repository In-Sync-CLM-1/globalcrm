-- One-time cleanup of duplicate fervent_data_repository rows for Fervent
-- Communication, caused by repeated re-imports of the same CSV before
-- import-time duplicate detection existed (added 2026-07-06) and before the
-- concurrent-duplicate-import race was closed (2026-07-07).
--
-- Two passes, both scoped to the Fervent org only:
--
-- 1) Records with a mobile number: "same person" = same full_name AND same
--    mobile_number_1. Deliberately NOT grouping by mobile_number_1 alone —
--    some numbers are a shared company line used by several distinct real
--    contacts (verified: 25 such groups exist and must stay separate).
--    The earliest-created row per group survives; any column left blank on
--    the survivor is filled in from a duplicate that has a value, so no
--    data is lost even if the older upload was less complete.
--
-- 2) Records with neither a mobile number nor an official email (can't be
--    matched by contact info): only merged when every other column is
--    already identical to another row — a true duplicate, not a fuzzy
--    match. No fill-in needed since by definition nothing differs.
--
-- Idempotent: re-running finds no groups with count(*) > 1 the second time,
-- so this is a no-op on an already-deduplicated table.

do $$
declare
  fervent_org_id uuid := '6235726a-56f9-4851-9413-bc5cca39e90d';
begin

  -- Pass 1: same full_name + same mobile_number_1.
  with groups as (
    select
      (array_agg(id order by created_at asc, id asc))[1] as survivor_id,
      array_agg(id order by created_at asc, id asc) as all_ids,
      (array_agg(sr_no order by (sr_no is null), created_at asc))[1] as m_sr_no,
      (array_agg(unique_id order by (unique_id is null), created_at asc))[1] as m_unique_id,
      (array_agg(db_sourced_year order by (db_sourced_year is null), created_at asc))[1] as m_db_sourced_year,
      (array_agg(ucdb_status order by (ucdb_status is null), created_at asc))[1] as m_ucdb_status,
      (array_agg(company_name order by (company_name is null), created_at asc))[1] as m_company_name,
      (array_agg(first_name order by (first_name is null), created_at asc))[1] as m_first_name,
      (array_agg(last_name order by (last_name is null), created_at asc))[1] as m_last_name,
      (array_agg(designation order by (designation is null), created_at asc))[1] as m_designation,
      (array_agg(department order by (department is null), created_at asc))[1] as m_department,
      (array_agg(designation_level order by (designation_level is null), created_at asc))[1] as m_designation_level,
      (array_agg(city order by (city is null), created_at asc))[1] as m_city,
      (array_agg(state order by (state is null), created_at asc))[1] as m_state,
      (array_agg(country order by (country is null), created_at asc))[1] as m_country,
      (array_agg(isd_code order by (isd_code is null), created_at asc))[1] as m_isd_code,
      (array_agg(std_code order by (std_code is null), created_at asc))[1] as m_std_code,
      (array_agg(mobile_number_2 order by (mobile_number_2 is null), created_at asc))[1] as m_mobile_number_2,
      (array_agg(direct_number order by (direct_number is null), created_at asc))[1] as m_direct_number,
      (array_agg(phone_number order by (phone_number is null), created_at asc))[1] as m_phone_number,
      (array_agg(official_email order by (official_email is null), created_at asc))[1] as m_official_email,
      (array_agg(personal_email_1 order by (personal_email_1 is null), created_at asc))[1] as m_personal_email_1,
      (array_agg(personal_email_2 order by (personal_email_2 is null), created_at asc))[1] as m_personal_email_2,
      (array_agg(linkedin_url order by (linkedin_url is null), created_at asc))[1] as m_linkedin_url,
      (array_agg(domain_name order by (domain_name is null), created_at asc))[1] as m_domain_name,
      (array_agg(website order by (website is null), created_at asc))[1] as m_website,
      (array_agg(industry order by (industry is null), created_at asc))[1] as m_industry,
      (array_agg(sub_industry order by (sub_industry is null), created_at asc))[1] as m_sub_industry,
      (array_agg(employee_size order by (employee_size is null), created_at asc))[1] as m_employee_size,
      (array_agg(turnover order by (turnover is null), created_at asc))[1] as m_turnover,
      (array_agg(company_linkedin_url order by (company_linkedin_url is null), created_at asc))[1] as m_company_linkedin_url,
      (array_agg(import_job_id order by (import_job_id is null), created_at asc))[1] as m_import_job_id,
      (array_agg(created_by order by (created_by is null), created_at asc))[1] as m_created_by
    from public.fervent_data_repository
    where org_id = fervent_org_id
      and full_name is not null and trim(full_name) <> ''
      and mobile_number_1 is not null and trim(mobile_number_1) <> ''
    group by lower(trim(full_name)), mobile_number_1
    having count(*) > 1
  ),
  filled as (
    update public.fervent_data_repository f set
      sr_no = g.m_sr_no,
      unique_id = g.m_unique_id,
      db_sourced_year = g.m_db_sourced_year,
      ucdb_status = g.m_ucdb_status,
      company_name = g.m_company_name,
      first_name = g.m_first_name,
      last_name = g.m_last_name,
      designation = g.m_designation,
      department = g.m_department,
      designation_level = g.m_designation_level,
      city = g.m_city,
      state = g.m_state,
      country = g.m_country,
      isd_code = g.m_isd_code,
      std_code = g.m_std_code,
      mobile_number_2 = g.m_mobile_number_2,
      direct_number = g.m_direct_number,
      phone_number = g.m_phone_number,
      official_email = g.m_official_email,
      personal_email_1 = g.m_personal_email_1,
      personal_email_2 = g.m_personal_email_2,
      linkedin_url = g.m_linkedin_url,
      domain_name = g.m_domain_name,
      website = g.m_website,
      industry = g.m_industry,
      sub_industry = g.m_sub_industry,
      employee_size = g.m_employee_size,
      turnover = g.m_turnover,
      company_linkedin_url = g.m_company_linkedin_url,
      import_job_id = g.m_import_job_id,
      created_by = g.m_created_by,
      updated_at = now()
    from groups g
    where f.id = g.survivor_id
    returning f.id
  )
  delete from public.fervent_data_repository f
  using groups g
  where f.org_id = fervent_org_id
    and f.id = any(g.all_ids)
    and f.id <> g.survivor_id;

  -- Pass 2: no mobile_number_1 and no official_email — merge only when every
  -- other column already matches exactly (true duplicate, no fill-in needed).
  with groups2 as (
    select
      (array_agg(id order by created_at asc, id asc))[1] as survivor_id,
      array_agg(id order by created_at asc, id asc) as all_ids
    from public.fervent_data_repository
    where org_id = fervent_org_id
      and (mobile_number_1 is null or trim(mobile_number_1) = '')
      and (official_email is null or trim(official_email) = '')
      and full_name is not null and trim(full_name) <> ''
    group by
      coalesce(sr_no::text,''), coalesce(unique_id,''), coalesce(db_sourced_year::text,''),
      coalesce(ucdb_status,''), coalesce(company_name,''), coalesce(first_name,''),
      coalesce(last_name,''), coalesce(full_name,''), coalesce(designation,''),
      coalesce(department,''), coalesce(designation_level,''), coalesce(city,''),
      coalesce(state,''), coalesce(country,''), coalesce(isd_code,''), coalesce(std_code,''),
      coalesce(mobile_number_2,''), coalesce(direct_number,''), coalesce(phone_number,''),
      coalesce(personal_email_1,''), coalesce(personal_email_2,''), coalesce(linkedin_url,''),
      coalesce(domain_name,''), coalesce(website,''), coalesce(industry,''),
      coalesce(sub_industry,''), coalesce(employee_size,''), coalesce(turnover,''),
      coalesce(company_linkedin_url,'')
    having count(*) > 1
  )
  delete from public.fervent_data_repository f
  using groups2 g
  where f.org_id = fervent_org_id
    and f.id = any(g.all_ids)
    and f.id <> g.survivor_id;

end $$;
