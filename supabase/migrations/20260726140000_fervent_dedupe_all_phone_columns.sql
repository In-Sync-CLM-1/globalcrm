-- =============================================================================
-- FERVENT DEDUPE: MATCH ON EVERY PHONE COLUMN, NOT JUST THE TWO MOBILES
--
-- The repository stores a phone in any of FOUR columns — mobile_number_1,
-- mobile_number_2, direct_number, phone_number — but duplicate detection only
-- ever compared the two mobile_* ones. Any record whose number arrived in
-- phone_number or direct_number was therefore invisible to the phone tier and
-- fell through to the weaker name tier, or straight to insert.
--
-- That is not an edge case in this data: of 23,021 rows, 15,618 (68%) carry a
-- phone ONLY in phone_number/direct_number. 1,052 distinct numbers currently
-- sit on more than one row, accounting for 1,234 redundant records — one number
-- appears 8 times.
--
-- The reported case: "Prateek Kumar", phone_number 9545694434, five copies
-- across two import jobs on 2026-07-26, with mobile_number_1/2 both empty.
--
-- Fix: normalise ALL FOUR columns (last 10 digits, digits only, >= 8 digits)
-- and match on them, so it no longer matters which column a number lands in on
-- either side. Matching is cross-column: a number in phone_number on the
-- incoming row matches the same number in mobile_number_1 on an existing row.
--
-- Shape: the previous version joined incoming to existing with a chain of ORs,
-- which forces a nested loop — 500 incoming x 23k existing per batch. Adding a
-- third and fourth phone column to that made a 500-row batch exceed the
-- statement timeout outright. Each tier is now its own equi-join on an unnested
-- value, so Postgres can hash-join: one scan of the repository per tier, probed
-- by the batch. Tier precedence (phone > email > name) is applied afterwards
-- with DISTINCT ON, preserving the previous contract — one row per
-- (incoming row, matched record), labelled with its strongest match type.
-- The name tier still only proposes; the caller's AI same-person check decides.
-- =============================================================================

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
  repo AS (
    SELECT f.id, f.mobile_number_1, f.mobile_number_2, f.direct_number, f.phone_number,
           f.official_email, f.personal_email_1, f.personal_email_2,
           lower(regexp_replace(trim(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), '\s+', ' ', 'g')) AS name_norm
    FROM public.fervent_data_repository f
    WHERE f.org_id = p_org_id
  ),
  repo_phone AS (
    SELECT DISTINCT f.id, p
    FROM repo f,
         LATERAL unnest(ARRAY[f.mobile_number_1, f.mobile_number_2, f.direct_number, f.phone_number]) AS rp,
         LATERAL (SELECT NULLIF(right(regexp_replace(COALESCE(rp, ''), '\D', '', 'g'), 10), '') AS p) AS n
    WHERE n.p IS NOT NULL AND length(n.p) >= 8
  ),
  repo_email AS (
    SELECT DISTINCT f.id, e
    FROM repo f,
         LATERAL unnest(ARRAY[f.official_email, f.personal_email_1, f.personal_email_2]) AS re,
         LATERAL (SELECT NULLIF(lower(trim(COALESCE(re, ''))), '') AS e) AS n
    WHERE n.e IS NOT NULL
  ),
  hits AS (
    SELECT i.idx, r.id, 1 AS tier FROM incoming_phone i JOIN repo_phone r USING (p)
    UNION ALL
    SELECT i.idx, r.id, 2 AS tier FROM incoming_email i JOIN repo_email r USING (e)
    UNION ALL
    SELECT i.idx, f.id, 3 AS tier
    FROM incoming i JOIN repo f ON f.name_norm = i.name_norm
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
