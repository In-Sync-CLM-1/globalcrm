-- Add product-aware variant of the candidate-selection RPC.
-- Same rules as the original, plus contacts.product must match the script's product
-- (so Riya only dials Worksync prospects, Anushree only dials Vendor Verification prospects).
--
-- contacts.product is text and case has been inconsistent ('Worksync', 'WorkSync', etc),
-- so we compare case-insensitively.

CREATE OR REPLACE FUNCTION public.get_ai_call_candidates(
  p_org uuid,
  p_limit int,
  p_product text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  phone text,
  company text,
  job_title text
)
LANGUAGE sql
STABLE
AS $$
  WITH attempts AS (
    SELECT contact_id,
           count(*) AS n,
           max(started_at) AS last_at
    FROM call_logs
    WHERE caller_type = 'ai'
      AND started_at IS NOT NULL
    GROUP BY contact_id
  ),
  team_phones AS (
    SELECT DISTINCT regexp_replace(coalesce(phone, ''), '\D', '', 'g') AS d
    FROM profiles
    WHERE org_id = p_org
      AND phone IS NOT NULL
      AND phone <> ''
  ),
  team_names AS (
    SELECT DISTINCT
      lower(trim(coalesce(first_name, ''))) || '|' || lower(trim(coalesce(last_name, ''))) AS full_name
    FROM profiles
    WHERE org_id = p_org
      AND coalesce(first_name, '') <> ''
  )
  SELECT c.id, c.first_name, c.last_name, c.phone, c.company, c.job_title
  FROM contacts c
  LEFT JOIN attempts a ON a.contact_id = c.id
  LEFT JOIN pipeline_stages ps ON ps.id = c.pipeline_stage_id
  WHERE c.org_id = p_org
    AND c.phone IS NOT NULL
    AND c.phone <> ''
    AND coalesce(c.do_not_call, false) = false
    AND coalesce(lower(ps.name), '') NOT IN ('won', 'lost')
    AND coalesce(a.n, 0) < 3
    AND (
      a.last_at IS NULL
      OR (a.last_at AT TIME ZONE 'Asia/Kolkata')::date
         < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
    )
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10)
        NOT IN (SELECT right(d, 10) FROM team_phones WHERE length(d) >= 10)
    AND (
      lower(trim(coalesce(c.first_name, ''))) || '|' || lower(trim(coalesce(c.last_name, '')))
    ) NOT IN (SELECT full_name FROM team_names)
    AND (
      p_product IS NULL
      OR lower(coalesce(c.product, '')) = lower(p_product)
    )
  ORDER BY
    a.n NULLS FIRST,
    a.last_at NULLS FIRST,
    c.created_at DESC,
    c.id
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_call_candidates(uuid, int, text) TO service_role;
