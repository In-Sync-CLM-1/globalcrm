-- Hard cap on AI dialing per contact:
--   * If any prior AI call connected (conversation_duration >= 5 sec), never call again.
--   * Otherwise, max 3 attempted AI calls (started_at not null).
-- Mirrors CONNECTED_THRESHOLD_SEC = 5 in supabase/functions/_shared/aiCalling.ts.

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
           count(*) FILTER (WHERE coalesce(conversation_duration, 0) >= 5) AS connected,
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
    AND coalesce(a.connected, 0) = 0                -- never call again once connected
    AND coalesce(a.n, 0) < 3                         -- otherwise max 3 attempts
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

-- Helper RPC so the UI + ai-bulk-call can check eligibility for a specific set
-- of contacts without re-implementing the rule.
CREATE OR REPLACE FUNCTION public.contact_ai_call_stats(
  p_contact_ids uuid[]
)
RETURNS TABLE (
  contact_id uuid,
  attempts int,
  connected int
)
LANGUAGE sql
STABLE
AS $$
  SELECT cl.contact_id,
         count(*)::int AS attempts,
         count(*) FILTER (WHERE coalesce(cl.conversation_duration, 0) >= 5)::int AS connected
  FROM call_logs cl
  WHERE cl.caller_type = 'ai'
    AND cl.started_at IS NOT NULL
    AND cl.contact_id = ANY(p_contact_ids)
  GROUP BY cl.contact_id;
$$;

GRANT EXECUTE ON FUNCTION public.contact_ai_call_stats(uuid[]) TO service_role, authenticated;
