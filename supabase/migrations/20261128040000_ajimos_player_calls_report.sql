-- Applies to organisation: Ajimos (ajimos) only (the one screen that calls it).
-- New and returning players in the chosen dates. Runs with the reader's own access, so a caller sees only their players.
CREATE OR REPLACE FUNCTION public.ajimos_player_calls(_from date, _to date, _agent uuid DEFAULT NULL, _type text DEFAULT NULL,
  _limit integer DEFAULT 25, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT id FROM organizations WHERE slug = 'ajimos' AND id = public.get_user_org_id(auth.uid())),
  r AS (
    SELECT l.contact_id, min(l.started_at) AS first_in, max(l.started_at) AS last_in, count(*) AS calls
    FROM call_logs l JOIN o ON o.id = l.org_id
    WHERE l.contact_id IS NOT NULL AND l.caller_type = 'human' AND (_agent IS NULL OR l.agent_id = _agent)
      AND NOT (l.direction = 'inbound' AND l.answered_at IS NULL)
      AND l.started_at >= (_from::timestamp AT TIME ZONE 'Asia/Kolkata') AND l.started_at < ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
    GROUP BY l.contact_id
  ),
  p AS (
    SELECT r.*, c.id AS cid, trim(concat_ws(' ', c.first_name, c.last_name)) AS name,
      CASE WHEN EXISTS (SELECT 1 FROM call_logs b WHERE b.contact_id = r.contact_id AND b.caller_type = 'human'
                          AND b.started_at < (_from::timestamp AT TIME ZONE 'Asia/Kolkata')) OR r.calls > 1
           THEN 'returning' ELSE 'new' END AS type
    FROM r JOIN contacts c ON c.id = r.contact_id
  )
  SELECT jsonb_build_object(
    'new', (SELECT count(*) FROM p WHERE type = 'new'), 'returning', (SELECT count(*) FROM p WHERE type = 'returning'),
    'rows', COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT cid AS contact_id, name, first_in, last_in, calls, type FROM p WHERE _type IS NULL OR type = _type
      ORDER BY last_in DESC, cid LIMIT LEAST(_limit, 5000) OFFSET _offset) x), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.ajimos_player_calls(date, date, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajimos_player_calls(date, date, uuid, text, integer, integer) TO authenticated;
