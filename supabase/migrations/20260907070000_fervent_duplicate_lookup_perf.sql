-- Fixes the 2026-09-04 Fervent bulk-import stall: find_fervent_duplicate_candidates
-- normalised phone/email/name on the fly for every row of the ENTIRE org repository
-- on every single 500-row batch call. That was fine when the repository was small,
-- but at 288k+ rows (Fervent Communication org) it takes 6-8s per call, right at the
-- edge of Postgres's statement_timeout -- so batches started failing with 57014
-- ("canceling statement due to statement timeout"), the row-by-row fallback made it
-- worse (500 individual round trips, same per-call cost), and the whole invocation
-- got killed by the platform before a single batch ever checkpointed. Result: the
-- stale-job safety net re-kicked the exact same doomed batch every 2 minutes forever,
-- with zero progress (see import_jobs id 8437dc70-e242-4f80-ad3a-247ac89f978a).
--
-- Fix: add expression indexes matching the exact normalisation used, and rewrite the
-- lookup as a per-column JOIN against the (small) set of incoming normalised values
-- instead of unnesting+normalising all 288k repository rows on every call. This turns
-- an O(incoming * repo_size) scan into an O(incoming * log(repo_size)) index probe.

CREATE INDEX IF NOT EXISTS idx_fervent_repo_phone1_norm ON public.fervent_data_repository
  (org_id, (NULLIF(right(regexp_replace(COALESCE(mobile_number_1, ''), '\D', '', 'g'), 10), '')));
CREATE INDEX IF NOT EXISTS idx_fervent_repo_phone2_norm ON public.fervent_data_repository
  (org_id, (NULLIF(right(regexp_replace(COALESCE(mobile_number_2, ''), '\D', '', 'g'), 10), '')));
CREATE INDEX IF NOT EXISTS idx_fervent_repo_phone3_norm ON public.fervent_data_repository
  (org_id, (NULLIF(right(regexp_replace(COALESCE(direct_number, ''), '\D', '', 'g'), 10), '')));
CREATE INDEX IF NOT EXISTS idx_fervent_repo_phone4_norm ON public.fervent_data_repository
  (org_id, (NULLIF(right(regexp_replace(COALESCE(phone_number, ''), '\D', '', 'g'), 10), '')));

CREATE INDEX IF NOT EXISTS idx_fervent_repo_email1_norm ON public.fervent_data_repository
  (org_id, (NULLIF(lower(trim(COALESCE(official_email, ''))), '')));
CREATE INDEX IF NOT EXISTS idx_fervent_repo_email2_norm ON public.fervent_data_repository
  (org_id, (NULLIF(lower(trim(COALESCE(personal_email_1, ''))), '')));
CREATE INDEX IF NOT EXISTS idx_fervent_repo_email3_norm ON public.fervent_data_repository
  (org_id, (NULLIF(lower(trim(COALESCE(personal_email_2, ''))), '')));

CREATE INDEX IF NOT EXISTS idx_fervent_repo_name_norm ON public.fervent_data_repository
  (org_id, (lower(regexp_replace(trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '\s+', ' ', 'g'))));

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
      ARRAY[
        r->>'mobile_number_1', r->>'mobile_number_2',
        r->>'direct_number',   r->>'phone_number'
      ] AS raw_phones,
      ARRAY[
        r->>'official_email', r->>'personal_email_1', r->>'personal_email_2'
      ] AS raw_emails
    FROM jsonb_array_elements(p_records) AS r
  ),
  incoming_phone AS (
    SELECT DISTINCT i.idx, p
    FROM incoming i,
         LATERAL unnest(i.raw_phones) AS rp,
         LATERAL (SELECT NULLIF(right(regexp_replace(COALESCE(rp, ''), '\D', '', 'g'), 10), '') AS p) AS n
    WHERE n.p IS NOT NULL AND length(n.p) >= 8
  ),
  incoming_email AS (
    SELECT DISTINCT i.idx, e
    FROM incoming i,
         LATERAL unnest(i.raw_emails) AS re,
         LATERAL (SELECT NULLIF(lower(trim(COALESCE(re, ''))), '') AS e) AS n
    WHERE n.e IS NOT NULL
  ),
  incoming_phone_vals AS (SELECT DISTINCT p FROM incoming_phone),
  incoming_email_vals AS (SELECT DISTINCT e FROM incoming_email),
  incoming_name_vals AS (SELECT DISTINCT name_norm FROM incoming WHERE name_norm <> ''),
  -- One UNION ALL branch per source column (instead of unnesting all four/three
  -- columns across the whole repository) so each branch can drive off the small
  -- incoming set and use its matching expression index above.
  repo_phone AS (
    SELECT f.id, v.p
    FROM incoming_phone_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(right(regexp_replace(COALESCE(f.mobile_number_1, ''), '\D', '', 'g'), 10), '') = v.p
    UNION ALL
    SELECT f.id, v.p
    FROM incoming_phone_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(right(regexp_replace(COALESCE(f.mobile_number_2, ''), '\D', '', 'g'), 10), '') = v.p
    UNION ALL
    SELECT f.id, v.p
    FROM incoming_phone_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(right(regexp_replace(COALESCE(f.direct_number, ''), '\D', '', 'g'), 10), '') = v.p
    UNION ALL
    SELECT f.id, v.p
    FROM incoming_phone_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(right(regexp_replace(COALESCE(f.phone_number, ''), '\D', '', 'g'), 10), '') = v.p
  ),
  repo_email AS (
    SELECT f.id, v.e
    FROM incoming_email_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(lower(trim(COALESCE(f.official_email, ''))), '') = v.e
    UNION ALL
    SELECT f.id, v.e
    FROM incoming_email_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(lower(trim(COALESCE(f.personal_email_1, ''))), '') = v.e
    UNION ALL
    SELECT f.id, v.e
    FROM incoming_email_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND NULLIF(lower(trim(COALESCE(f.personal_email_2, ''))), '') = v.e
  ),
  repo_name AS (
    SELECT f.id, v.name_norm
    FROM incoming_name_vals v
    JOIN public.fervent_data_repository f
      ON f.org_id = p_org_id
     AND lower(regexp_replace(trim(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), '\s+', ' ', 'g')) = v.name_norm
  ),
  hits AS (
    SELECT i.idx, r.id, 1 AS tier FROM incoming_phone i JOIN repo_phone r USING (p)
    UNION ALL
    SELECT i.idx, r.id, 2 AS tier FROM incoming_email i JOIN repo_email r USING (e)
    UNION ALL
    SELECT i.idx, f.id, 3 AS tier
    FROM incoming i JOIN repo_name f ON f.name_norm = i.name_norm
    WHERE i.name_norm <> ''
  ),
  best AS (
    SELECT DISTINCT ON (idx, id) idx, id, tier
    FROM hits
    ORDER BY idx, id, tier
  )
  SELECT
    b.idx,
    CASE b.tier WHEN 1 THEN 'phone' WHEN 2 THEN 'email' ELSE 'name' END,
    jsonb_build_object(
      'id', f.id,
      'unique_id', f.unique_id,
      'first_name', f.first_name,
      'last_name', f.last_name,
      'company_name', f.company_name,
      'designation', f.designation,
      'department', f.department,
      'city', f.city,
      'state', f.state,
      'country', f.country,
      'industry', f.industry,
      'linkedin_url', f.linkedin_url,
      'mobile_number_1', f.mobile_number_1,
      'mobile_number_2', f.mobile_number_2,
      'direct_number', f.direct_number,
      'phone_number', f.phone_number,
      'official_email', f.official_email,
      'personal_email_1', f.personal_email_1,
      'personal_email_2', f.personal_email_2
    )
  FROM best b
  JOIN public.fervent_data_repository f ON f.id = b.id;
$function$;
