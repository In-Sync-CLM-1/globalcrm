-- get_ai_agent_analytics ignored p_org_id whenever a user was logged in and
-- derived the org from the caller's own profile (get_user_org_id). A platform
-- admin (profiles.is_platform_admin=true, org_id NULL) therefore resolved to a
-- NULL org and the function returned zero rows — so the dashboard "AI Agents"
-- tab was permanently empty for platform admins on every org/date window, even
-- when AI calls existed. Fix: let a platform admin (and service role) target a
-- specific org via p_org_id, while normal users stay locked to their own org.

CREATE OR REPLACE FUNCTION public.get_ai_agent_analytics(p_org_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(product text, total_dialed bigint, picked_up bigint, reached bigint, no_answer bigint, busy bigint, failed bigint, not_connected bigint, in_flight bigint, avg_talk_sec numeric, demos bigint, callbacks bigint, interested bigint, decision_maker bigint, not_interested bigint, not_qualified bigint, dnc bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    v_org := p_org_id;                                       -- service role / testing
  ELSIF is_platform_admin(auth.uid()) THEN
    v_org := COALESCE(p_org_id, get_user_org_id(auth.uid())); -- platform admin can target the org they're viewing
  ELSE
    v_org := get_user_org_id(auth.uid());                    -- normal users: locked to their own org
  END IF;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH calls AS (
    SELECT
      COALESCE(NULLIF(TRIM(c.product), ''), '(unassigned)') AS prod,
      cl.status,
      cl.call_duration,
      m.outcome_key
    FROM call_logs cl
    JOIN contacts c ON c.id = cl.contact_id
    LEFT JOIN ai_outcome_disposition_map m
      ON m.disposition_id = cl.disposition_id AND m.org_id = cl.org_id
    WHERE cl.org_id = v_org
      AND cl.caller_type = 'ai'
      AND cl.created_at >= now() - make_interval(days => p_days)
  )
  SELECT
    calls.prod,
    count(*) FILTER (WHERE status IN ('completed','no-answer','busy','failed','canceled','error'))            AS total_dialed,
    count(*) FILTER (WHERE status = 'completed' AND call_duration > 0)                                         AS picked_up,
    count(*) FILTER (WHERE outcome_key IN ('interested','not_interested','demo_agreed','callback',
                                           'decision_maker','not_qualified','do_not_call','wrong_person'))     AS reached,
    count(*) FILTER (WHERE status = 'no-answer' OR outcome_key = 'no_answer')                                  AS no_answer,
    count(*) FILTER (WHERE status = 'busy')                                                                    AS busy,
    count(*) FILTER (WHERE status IN ('failed','error'))                                                       AS failed,
    count(*) FILTER (WHERE outcome_key = 'not_connected')                                                      AS not_connected,
    count(*) FILTER (WHERE status IN ('queued','in_progress'))                                                 AS in_flight,
    round(avg(call_duration) FILTER (WHERE status = 'completed' AND call_duration > 0), 0)                     AS avg_talk_sec,
    count(*) FILTER (WHERE outcome_key = 'demo_agreed')                                                        AS demos,
    count(*) FILTER (WHERE outcome_key = 'callback')                                                           AS callbacks,
    count(*) FILTER (WHERE outcome_key = 'interested')                                                         AS interested,
    count(*) FILTER (WHERE outcome_key = 'decision_maker')                                                     AS decision_maker,
    count(*) FILTER (WHERE outcome_key = 'not_interested')                                                     AS not_interested,
    count(*) FILTER (WHERE outcome_key = 'not_qualified')                                                      AS not_qualified,
    count(*) FILTER (WHERE outcome_key IN ('do_not_call','wrong_person'))                                      AS dnc
  FROM calls
  GROUP BY calls.prod
  ORDER BY reached DESC, picked_up DESC, total_dialed DESC;
END;
$function$;
