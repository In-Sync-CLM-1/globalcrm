-- Applies to organisation: Ajimos (ajimos) only. Every other organisation is unchanged.
-- Dialixa call reports, read from the portal's call history by the dialixa-sync function every 5 minutes.
-- Switched on by organizations.settings.dialixa.reports = true (left OFF here until one real call confirms the details).
-- The player's number is used to find the player and is not stored here.

CREATE TABLE IF NOT EXISTS public.dialixa_portal_calls (
  portal_id       text PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  direction       text NOT NULL,
  status          text,
  started_at      timestamptz NOT NULL,
  duration_secs   integer NOT NULL DEFAULT 0,
  talk_secs       integer NOT NULL DEFAULT 0,
  disconnected_by text,
  hangup_cause    text,
  recording_url   text,
  call_log_id     uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  counted_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dialixa_portal_calls_org_start ON public.dialixa_portal_calls (org_id, started_at DESC);
ALTER TABLE public.dialixa_portal_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dialixa_portal_calls FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.dialixa_sync_state (
  org_id     uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_ok_at timestamptz,
  last_error text,
  failures   integer NOT NULL DEFAULT 0,
  alerted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dialixa_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dialixa_sync_state FROM anon, authenticated;
GRANT ALL ON public.dialixa_portal_calls, public.dialixa_sync_state TO service_role;

CREATE OR REPLACE FUNCTION public.dialixa_reports_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT id FROM organizations WHERE slug = 'ajimos' AND COALESCE((settings->'dialixa'->>'reports')::boolean, false);
$function$;

-- Server only: is reading switched on, and from when must calls be read?
CREATE OR REPLACE FUNCTION public.dialixa_sync_from()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT GREATEST(LEAST(COALESCE(s.last_ok_at, now()) - interval '1 day', now() - interval '2 days'), now() - interval '31 days')
  FROM (SELECT public.dialixa_reports_org() AS id) o LEFT JOIN dialixa_sync_state s ON s.org_id = o.id
  WHERE o.id IS NOT NULL;
$function$;

-- Server only: result of a run. Returns true when the owner must be told (3 runs failed in a row; at most every 6 hours).
CREATE OR REPLACE FUNCTION public.dialixa_sync_result(_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.dialixa_reports_org(); s record;
BEGIN
  IF v_org IS NULL THEN RETURN false; END IF;
  INSERT INTO dialixa_sync_state AS d (org_id, last_ok_at, last_error, failures)
  VALUES (v_org, CASE WHEN _error IS NULL THEN now() END, left(_error, 300), CASE WHEN _error IS NULL THEN 0 ELSE 1 END)
  ON CONFLICT (org_id) DO UPDATE SET
    last_ok_at = COALESCE(EXCLUDED.last_ok_at, d.last_ok_at), last_error = EXCLUDED.last_error,
    failures = CASE WHEN _error IS NULL THEN 0 ELSE d.failures + 1 END,
    alerted_at = CASE WHEN _error IS NULL THEN NULL ELSE d.alerted_at END, updated_at = now()
  RETURNING * INTO s;
  IF s.failures >= 3 AND (s.alerted_at IS NULL OR s.alerted_at < now() - interval '6 hours') THEN
    UPDATE dialixa_sync_state SET alerted_at = now() WHERE org_id = v_org;
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

-- Server only: the player a number belongs to; the caller's own players first.
CREATE OR REPLACE FUNCTION public.dialixa_find_contact(_org uuid, _user uuid, _number text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_digits text := right(regexp_replace(COALESCE(_number, ''), '\D', '', 'g'), 10); v_id uuid; v_hash text;
BEGIN
  IF length(v_digits) <> 10 THEN RETURN NULL; END IF;
  IF public.pii_protected(_org) THEN
    v_hash := public.pii_hash('phone', v_digits);
    SELECT id INTO v_id FROM contacts WHERE org_id = _org AND phone_hash = v_hash
     ORDER BY (assigned_to = _user) DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM contacts WHERE org_id = _org AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_digits
     ORDER BY (assigned_to = _user) DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  RETURN v_id;
END;
$function$;

-- Server only: calls read from the portal. Sending the same call again only refreshes it.
-- A matched call joins the outcome the caller saved for it, so it is counted once; it carries the same marker as a
-- phone-app call (phone_app_key), so dashboards and later outcomes treat both alike.
CREATE OR REPLACE FUNCTION public.dialixa_ingest_calls(_calls jsonb, _users jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.dialixa_reports_org();
  c jsonb; u jsonb; v_id text; v_user uuid; v_contact uuid; v_in boolean; v_start timestamptz; v_dur int; v_talk int;
  v_status text; v_end timestamptz; v_key text; v_row record; v_click record; v_log uuid; v_act uuid; v_masked text; v_desc text;
  n_new int := 0; n_seen int := 0; n_nomatch int := 0; n_skipped int := 0;
BEGIN
  IF v_org IS NULL THEN RETURN jsonb_build_object('off', true); END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(_calls) LOOP
    v_id := NULLIF(c->>'id', ''); v_start := NULLIF(c->>'startedAt', '')::timestamptz;
    IF v_id IS NULL OR v_start IS NULL OR c->>'status' = 'in-progress' THEN n_skipped := n_skipped + 1; CONTINUE; END IF;
    v_in := c->>'direction' = 'inbound';
    v_talk := LEAST(GREATEST(COALESCE(floor((c->>'talkTimeSec')::numeric), 0), 0), 4 * 3600)::int;
    v_dur := GREATEST(LEAST(GREATEST(COALESCE(floor((c->>'durationSec')::numeric), 0), 0), 4 * 3600)::int, v_talk);
    v_end := v_start + make_interval(secs => v_dur);
    v_status := CASE WHEN v_talk > 0 THEN 'completed' WHEN v_in THEN 'missed' WHEN c->>'status' = 'failed' THEN 'failed' ELSE 'no-answer' END;

    -- The caller: the portal user's email is the CRM email; the extension is the second way.
    v_user := NULL;
    SELECT x INTO u FROM jsonb_array_elements(_users) x WHERE x->>'id' = c->>'userId' LIMIT 1;
    IF u IS NOT NULL THEN
      SELECT p.id INTO v_user FROM profiles p JOIN auth.users a ON a.id = p.id
       WHERE p.org_id = v_org AND lower(a.email) = lower(u->>'email') LIMIT 1;
      IF v_user IS NULL THEN
        SELECT e.user_id INTO v_user FROM dialixa_extensions e WHERE e.org_id = v_org AND e.extension = u->>'sipExtension';
      END IF;
    END IF;

    -- The player: the other side's number, whichever field the portal puts it in.
    v_contact := public.dialixa_find_contact(v_org, v_user, CASE WHEN v_in THEN c->>'from' ELSE c->>'to' END);
    IF v_contact IS NULL THEN
      v_contact := public.dialixa_find_contact(v_org, v_user, CASE WHEN v_in THEN c->>'to' ELSE c->>'from' END);
    END IF;

    INSERT INTO dialixa_portal_calls AS d (portal_id, org_id, user_id, contact_id, direction, status, started_at, duration_secs,
      talk_secs, disconnected_by, hangup_cause, recording_url)
    VALUES (v_id, v_org, v_user, v_contact, CASE WHEN v_in THEN 'inbound' ELSE 'outbound' END, v_status, v_start, v_dur, v_talk,
      left(c->>'disconnectedBy', 40), left(COALESCE(c->>'hangupCauseText', c->>'hangupCause'), 120), left(c->>'recordingUrl', 1000))
    ON CONFLICT (portal_id) DO UPDATE SET user_id = COALESCE(d.user_id, EXCLUDED.user_id), contact_id = COALESCE(d.contact_id, EXCLUDED.contact_id),
      status = EXCLUDED.status, duration_secs = EXCLUDED.duration_secs, talk_secs = EXCLUDED.talk_secs,
      disconnected_by = EXCLUDED.disconnected_by, hangup_cause = EXCLUDED.hangup_cause, recording_url = EXCLUDED.recording_url, updated_at = now()
    RETURNING * INTO v_row;

    IF v_row.user_id IS NULL OR v_row.contact_id IS NULL THEN n_nomatch := n_nomatch + 1; CONTINUE; END IF;
    IF v_row.counted_at IS NOT NULL THEN
      n_seen := n_seen + 1;
      IF v_row.call_log_id IS NOT NULL THEN
        UPDATE call_logs SET call_duration = v_talk, conversation_duration = v_talk, status = v_status,
               answered_at = CASE WHEN v_talk > 0 THEN COALESCE(answered_at, v_end - make_interval(secs => v_talk)) END, ended_at = v_end
         WHERE id = v_row.call_log_id AND (call_duration IS DISTINCT FROM v_talk OR status IS DISTINCT FROM v_status);
      END IF;
      CONTINUE;
    END IF;

    v_key := 'dialixa-' || v_id; v_log := NULL; v_act := NULL;
    IF NOT (v_in AND v_talk = 0) THEN
      -- The outcome saved from the softphone panel for this very call.
      SELECT l.id, l.activity_id INTO v_click FROM dialixa_calls k JOIN call_logs l ON l.id = k.call_log_id
       WHERE k.org_id = v_org AND k.user_id = v_row.user_id AND k.contact_id = v_row.contact_id
         AND k.direction = CASE WHEN v_in THEN 'inbound' ELSE 'outbound' END AND l.phone_app_key IS NULL
         AND k.created_at BETWEEN v_start - interval '3 minutes' AND v_start + interval '3 minutes'
       ORDER BY abs(extract(epoch FROM k.created_at - v_start)) LIMIT 1;
      IF v_click.id IS NULL THEN
        -- Or an outcome picked by hand for this player around the call.
        SELECT l.id, l.activity_id INTO v_click FROM call_logs l
         WHERE l.org_id = v_org AND l.agent_id = v_row.user_id AND l.contact_id = v_row.contact_id AND l.dialled_by_hand
           AND l.phone_app_key IS NULL AND COALESCE(l.call_duration, 0) = 0 AND l.disposition_id IS NOT NULL
           AND l.created_at BETWEEN v_start - interval '2 minutes' AND v_end + interval '30 minutes'
         ORDER BY l.created_at LIMIT 1;
      END IF;
      v_log := v_click.id; v_act := v_click.activity_id;
    END IF;

    IF v_log IS NOT NULL THEN
      UPDATE call_logs SET phone_app_key = v_key, call_duration = v_talk, conversation_duration = v_talk, started_at = v_start,
        answered_at = CASE WHEN v_talk > 0 THEN v_end - make_interval(secs => v_talk) END, ended_at = v_end, status = v_status,
        call_type = v_row.direction, direction = v_row.direction
      WHERE id = v_log;
      IF v_act IS NOT NULL THEN UPDATE contact_activities SET call_duration = v_talk WHERE id = v_act; END IF;
    ELSE
      v_desc := CASE WHEN v_talk > 0 THEN format('Dialixa call, %s:%s', v_talk / 60, lpad((v_talk % 60)::text, 2, '0'))
                     WHEN v_in THEN 'Missed Dialixa call from the player' ELSE 'Dialixa call, not answered' END;
      SELECT phone INTO v_masked FROM contacts WHERE id = v_row.contact_id;
      INSERT INTO contact_activities (contact_id, org_id, activity_type, subject, description, created_by, completed_at, call_duration,
        morning_reminder_sent, pre_action_reminder_sent)
      VALUES (v_row.contact_id, v_org, 'call', CASE WHEN v_in THEN 'Incoming Dialixa call' ELSE 'Dialixa call' END, v_desc,
        v_row.user_id, v_end, v_talk, false, false) RETURNING id INTO v_act;
      INSERT INTO call_logs (org_id, contact_id, agent_id, caller_type, call_type, direction, status, exotel_call_sid, from_number, to_number,
        call_duration, conversation_duration, started_at, answered_at, ended_at, activity_id, dialled_by_hand, phone_app_key)
      VALUES (v_org, v_row.contact_id, v_row.user_id, 'human', v_row.direction, v_row.direction, v_status, v_key, '', COALESCE(v_masked, ''),
        v_talk, v_talk, v_start, CASE WHEN v_talk > 0 THEN v_end - make_interval(secs => v_talk) END, v_end, v_act, true, v_key)
      RETURNING id INTO v_log;
    END IF;
    UPDATE dialixa_portal_calls SET call_log_id = v_log, counted_at = now() WHERE portal_id = v_id;
    n_new := n_new + 1;
  END LOOP;
  RETURN jsonb_build_object('new', n_new, 'seen', n_seen, 'no_match', n_nomatch, 'skipped', n_skipped);
END;
$function$;

-- The manager's and admins' report.
CREATE OR REPLACE FUNCTION public.dialixa_call_report(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.dialixa_reports_org(); v_start timestamptz; v_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR public.get_user_org_id(auth.uid()) IS DISTINCT FROM v_org
     OR NOT public.phone_app_is_privileged(v_org) THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  v_start := _from::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_end := (_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
  RETURN jsonb_build_object(
    'enabled', true,
    'last_ok_at', (SELECT last_ok_at FROM dialixa_sync_state WHERE org_id = v_org),
    'callers', COALESCE((SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT d.user_id, COALESCE(max(trim(concat_ws(' ', p.first_name, p.last_name))), 'Not a CRM user') AS name,
        count(*) AS calls, count(*) FILTER (WHERE d.direction = 'outbound') AS outbound,
        count(*) FILTER (WHERE d.direction = 'inbound') AS inbound, count(*) FILTER (WHERE d.talk_secs > 0) AS connected,
        count(*) FILTER (WHERE d.talk_secs >= 60) AS clean, sum(d.talk_secs) AS talk_secs
      FROM dialixa_portal_calls d LEFT JOIN profiles p ON p.id = d.user_id
      WHERE d.org_id = v_org AND d.started_at >= v_start AND d.started_at < v_end GROUP BY d.user_id) x), '[]'::jsonb),
    'total', (SELECT count(*) FROM dialixa_portal_calls WHERE org_id = v_org AND started_at >= v_start AND started_at < v_end),
    'calls', COALESCE((SELECT jsonb_agg(x ORDER BY x.started_at DESC) FROM (
      SELECT d.portal_id AS id, d.user_id, COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Not a CRM user') AS caller,
        d.contact_id, COALESCE(NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Not in the CRM') AS player,
        d.direction, d.status, d.started_at, d.talk_secs, d.disconnected_by, d.hangup_cause, d.recording_url, cd.name AS outcome
      FROM dialixa_portal_calls d
      LEFT JOIN profiles p ON p.id = d.user_id LEFT JOIN contacts c ON c.id = d.contact_id
      LEFT JOIN call_logs l ON l.id = d.call_log_id LEFT JOIN call_dispositions cd ON cd.id = l.disposition_id
      WHERE d.org_id = v_org AND d.started_at >= v_start AND d.started_at < v_end
      ORDER BY d.started_at DESC LIMIT 500) x), '[]'::jsonb));
END;
$function$;

-- Same as before, plus whether Dialixa reports are on (also while calling itself is off).
CREATE OR REPLACE FUNCTION public.my_dialixa_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o record; e record; v_reports boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('enabled', false, 'reports', false); END IF;
  SELECT id, settings INTO o FROM organizations WHERE id = public.get_user_org_id(auth.uid()) AND slug = 'ajimos';
  IF o.id IS NULL THEN RETURN jsonb_build_object('enabled', false, 'reports', false); END IF;
  v_reports := COALESCE((o.settings->'dialixa'->>'reports')::boolean, false);
  IF NOT COALESCE((o.settings->'dialixa'->>'enabled')::boolean, false) THEN
    RETURN jsonb_build_object('enabled', false, 'reports', v_reports);
  END IF;
  SELECT extension, sip_password_encrypted IS NOT NULL AS has_login INTO e
    FROM dialixa_extensions WHERE user_id = auth.uid() AND org_id = o.id;
  RETURN jsonb_build_object(
    'enabled', true, 'reports', v_reports, 'extension', e.extension,
    'softphone', COALESCE(e.has_login, false)
      AND COALESCE(o.settings->'dialixa'->'softphone'->>'ws_url', '') <> ''
      AND COALESCE(o.settings->'dialixa'->'softphone'->>'domain', '') <> '');
END;
$function$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['dialixa_reports_org()', 'dialixa_sync_from()', 'dialixa_sync_result(text)',
    'dialixa_find_contact(uuid, uuid, text)', 'dialixa_ingest_calls(jsonb, jsonb)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO service_role';
  END LOOP;
  REVOKE ALL ON FUNCTION public.dialixa_call_report(date, date) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.dialixa_call_report(date, date) TO authenticated;
END
$grants$;
