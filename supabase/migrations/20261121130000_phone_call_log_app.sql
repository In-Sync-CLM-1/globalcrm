-- Phone Call Log app (Android): callers dial from their own phones; the app sends the CRM
-- the calls made to / received from the caller's own contacts, and can start a call on the
-- phone when the caller clicks Call in the CRM.
--
-- Switched on per organisation: organizations.settings.phone_app.enabled = true.
-- Applies to organisation: Ajimos (ajimos) only. Every other organisation is unchanged.
--
-- Privacy: the app first downloads short fingerprints of the caller's own contacts' numbers
-- and drops every other call on the phone, so personal calls never reach the CRM. The server
-- checks every call it receives against the caller's contacts again and ignores the rest.
-- Calls from before the app was installed are never counted.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.phone_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_key      text NOT NULL,
  device_name     text,
  app_version     text,
  android_version text,
  counting_from   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  last_sync_at    timestamptz,
  last_sync_calls integer,
  connected_until timestamptz,
  call_log_allowed boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_devices_user_device_uniq UNIQUE (user_id, device_key)
);
CREATE INDEX IF NOT EXISTS idx_phone_devices_org ON public.phone_devices (org_id);

ALTER TABLE public.phone_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see their own phones" ON public.phone_devices;
CREATE POLICY "Users see their own phones" ON public.phone_devices
  FOR SELECT USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.phone_devices FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.phone_call_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'waiting'
              CHECK (status IN ('waiting', 'dialling', 'done', 'cancelled', 'expired', 'failed')),
  failure     text,
  device_id   uuid REFERENCES public.phone_devices(id) ON DELETE SET NULL,
  call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  claimed_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_phone_call_requests_user ON public.phone_call_requests (user_id, created_at DESC);

ALTER TABLE public.phone_call_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see their own call requests" ON public.phone_call_requests;
CREATE POLICY "Users see their own call requests" ON public.phone_call_requests
  FOR SELECT USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.phone_call_requests FROM anon, authenticated;

-- The phone listens for new requests over Realtime (rows hold no phone number).
DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'phone_call_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.phone_call_requests;
  END IF;
END
$pub$;

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS phone_app_key text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS phone_device_id uuid REFERENCES public.phone_devices(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS call_logs_phone_app_key_uniq ON public.call_logs (agent_id, phone_app_key) WHERE phone_app_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The signed-in user's organisation, if the phone app is switched on for it.
CREATE OR REPLACE FUNCTION public.phone_app_org()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_org := public.get_user_org_id(auth.uid());
  IF v_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = v_org AND COALESCE((settings->'phone_app'->>'enabled')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'The phone app is not switched on for your organisation';
  END IF;
  RETURN v_org;
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_org() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.phone_app_is_privileged(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND org_id = _org AND is_active = true
      AND role IN ('admin', 'super_admin', 'sales_manager')
  );
$function$;
REVOKE ALL ON FUNCTION public.phone_app_is_privileged(uuid) FROM PUBLIC, anon, authenticated;

-- Fingerprint the phone computes too: first 16 hex characters of sha256 of the last 10 digits.
CREATE OR REPLACE FUNCTION public.phone_app_fingerprint(_digits text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN length(right(regexp_replace(COALESCE(_digits, ''), '\D', '', 'g'), 10)) = 10
    THEN left(encode(extensions.digest(convert_to(right(regexp_replace(_digits, '\D', '', 'g'), 10), 'UTF8'), 'sha256'), 'hex'), 16)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.phone_app_device(_org uuid, _device_key text)
RETURNS public.phone_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE d public.phone_devices;
BEGIN
  SELECT * INTO d FROM phone_devices WHERE user_id = auth.uid() AND device_key = _device_key AND org_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'This phone is not registered. Sign in again in the app.'; END IF;
  UPDATE phone_devices SET last_seen_at = now() WHERE id = d.id;
  RETURN d;
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_device(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- App calls
-- ---------------------------------------------------------------------------

-- First sign-in on a phone (and every app start). Counting starts at the first registration.
CREATE OR REPLACE FUNCTION public.phone_app_register(
  _device_key text, _device_name text DEFAULT NULL, _app_version text DEFAULT NULL,
  _android_version text DEFAULT NULL, _call_log_allowed boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  d public.phone_devices;
  v_name text;
  v_org_name text;
BEGIN
  IF COALESCE(length(_device_key), 0) < 16 THEN RAISE EXCEPTION 'Bad device key'; END IF;
  INSERT INTO phone_devices (org_id, user_id, device_key, device_name, app_version, android_version, last_seen_at, call_log_allowed)
  VALUES (v_org, auth.uid(), _device_key, left(_device_name, 80), left(_app_version, 20), left(_android_version, 20), now(), COALESCE(_call_log_allowed, true))
  ON CONFLICT (user_id, device_key) DO UPDATE
    SET org_id = EXCLUDED.org_id, device_name = EXCLUDED.device_name, app_version = EXCLUDED.app_version,
        android_version = EXCLUDED.android_version, last_seen_at = now(), call_log_allowed = EXCLUDED.call_log_allowed
  RETURNING * INTO d;

  SELECT trim(concat_ws(' ', first_name, last_name)) INTO v_name FROM profiles WHERE id = auth.uid();
  SELECT name INTO v_org_name FROM organizations WHERE id = v_org;
  RETURN jsonb_build_object(
    'device_id', d.id, 'counting_from', d.counting_from, 'user_name', v_name, 'org_name', v_org_name,
    'user_id', auth.uid(), 'click_to_call', true
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_register(text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_register(text, text, text, text, boolean) TO authenticated;

-- Fingerprints of the numbers the caller may log calls for: callers their assigned contacts,
-- the calling manager and admins every contact in the organisation.
-- One comma-separated text value (a set would be cut at the API's 1,000-row limit).
CREATE OR REPLACE FUNCTION public.phone_app_fingerprints(_device_key text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  v_priv boolean := public.phone_app_is_privileged(v_org);
  v_key text;
BEGIN
  PERFORM 1 FROM phone_devices WHERE user_id = auth.uid() AND device_key = _device_key AND org_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'This phone is not registered. Sign in again in the app.'; END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'PII_ENCRYPTION_KEY' LIMIT 1;
  RETURN (
    SELECT string_agg(DISTINCT f, ',') FROM (
      SELECT public.phone_app_fingerprint(
        CASE WHEN c.phone_encrypted IS NOT NULL AND v_key IS NOT NULL
             THEN extensions.pgp_sym_decrypt(c.phone_encrypted, v_key) ELSE c.phone END) AS f
      FROM contacts c
      WHERE c.org_id = v_org AND (v_priv OR c.assigned_to = auth.uid())
        AND (c.phone_encrypted IS NOT NULL OR COALESCE(c.phone, '') <> '')
    ) x WHERE f IS NOT NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_fingerprints(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_fingerprints(text) TO authenticated;

-- The contact a phone number belongs to, among the contacts this user may log calls for.
CREATE OR REPLACE FUNCTION public.phone_app_match_contact(_org uuid, _priv boolean, _number text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_digits text := right(regexp_replace(COALESCE(_number, ''), '\D', '', 'g'), 10);
  v_hash text;
  v_id uuid;
BEGIN
  IF length(v_digits) <> 10 THEN RETURN NULL; END IF;
  IF public.pii_protected(_org) THEN
    v_hash := public.pii_hash('phone', v_digits);
    SELECT c.id INTO v_id FROM contacts c
     WHERE c.org_id = _org AND c.phone_hash = v_hash AND (_priv OR c.assigned_to = auth.uid())
     ORDER BY (c.assigned_to = auth.uid()) DESC NULLS LAST, c.updated_at DESC NULLS LAST LIMIT 1;
  ELSE
    SELECT c.id INTO v_id FROM contacts c
     WHERE c.org_id = _org AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = v_digits
       AND (_priv OR c.assigned_to = auth.uid())
     ORDER BY (c.assigned_to = auth.uid()) DESC NULLS LAST, c.updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_match_contact(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- The phone sends the calls it matched. Each call:
--   {key, number, direction: outgoing|incoming|missed|rejected, started_at, duration, request_id?}
-- Returns counts. Sending the same call again is harmless.
CREATE OR REPLACE FUNCTION public.phone_app_save_calls(_device_key text, _calls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  v_priv boolean := public.phone_app_is_privileged(v_org);
  d public.phone_devices := public.phone_app_device(v_org, _device_key);
  v_me uuid := auth.uid();
  c jsonb;
  v_key text; v_dir text; v_start timestamptz; v_dur int; v_req uuid;
  v_contact uuid; v_phone text; v_status text; v_inbound boolean;
  v_existing uuid; v_outcome record; v_log uuid; v_act uuid; v_desc text;
  n_saved int := 0; n_merged int := 0; n_dup int := 0; n_ignored int := 0;
BEGIN
  IF jsonb_typeof(_calls) <> 'array' THEN RAISE EXCEPTION 'Calls must be a list'; END IF;
  IF jsonb_array_length(_calls) > 200 THEN RAISE EXCEPTION 'Send at most 200 calls at a time'; END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(_calls) LOOP
    v_key := left(c->>'key', 80);
    v_dir := c->>'direction';
    v_start := (c->>'started_at')::timestamptz;
    v_dur := LEAST(GREATEST(COALESCE((c->>'duration')::int, 0), 0), 4 * 3600);
    v_req := NULLIF(c->>'request_id', '')::uuid;

    IF v_key IS NULL OR v_start IS NULL OR v_dir NOT IN ('outgoing', 'incoming', 'missed', 'rejected')
       OR v_start < d.counting_from OR v_start > now() + interval '5 minutes' THEN
      n_ignored := n_ignored + 1; CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM call_logs WHERE agent_id = v_me AND phone_app_key = v_key) THEN
      n_dup := n_dup + 1; CONTINUE;
    END IF;

    v_contact := public.phone_app_match_contact(v_org, v_priv, c->>'number');
    IF v_contact IS NULL THEN n_ignored := n_ignored + 1; CONTINUE; END IF;
    SELECT phone INTO v_phone FROM contacts WHERE id = v_contact;

    v_inbound := v_dir <> 'outgoing';
    v_status := CASE WHEN v_dur > 0 THEN 'completed'
                     WHEN v_dir = 'missed' THEN 'missed'
                     WHEN v_dir = 'rejected' THEN 'rejected'
                     ELSE 'no-answer' END;
    v_desc := CASE WHEN v_dur > 0 THEN format('Phone call, %s:%s', v_dur / 60, lpad((v_dur % 60)::text, 2, '0'))
                   WHEN v_inbound THEN 'Missed call from the player'
                   ELSE 'Phone call, not answered' END;

    -- An outcome picked by hand for this player shortly before the phone reported the call
    -- (no call behind it yet) becomes this call, so the call is counted once.
    v_outcome := NULL;
    SELECT l.id, l.activity_id INTO v_outcome FROM call_logs l
     WHERE NOT (v_inbound AND v_dur = 0) AND l.org_id = v_org AND l.agent_id = v_me AND l.contact_id = v_contact
       AND l.dialled_by_hand AND l.phone_app_key IS NULL AND COALESCE(l.call_duration, 0) = 0
       AND l.disposition_id IS NOT NULL
       AND l.created_at BETWEEN v_start - interval '2 minutes' AND v_start + make_interval(secs => v_dur) + interval '30 minutes'
     ORDER BY l.created_at LIMIT 1;

    IF v_outcome.id IS NOT NULL THEN
      UPDATE call_logs SET
        phone_app_key = v_key, phone_device_id = d.id, call_duration = v_dur, conversation_duration = v_dur,
        started_at = v_start, answered_at = CASE WHEN v_dur > 0 THEN v_start END,
        ended_at = v_start + make_interval(secs => v_dur), status = v_status,
        call_type = CASE WHEN v_inbound THEN 'inbound' ELSE 'outbound' END,
        direction = CASE WHEN v_inbound THEN 'inbound' ELSE 'outbound' END
      WHERE id = v_outcome.id;
      IF v_outcome.activity_id IS NOT NULL THEN
        UPDATE contact_activities SET call_duration = v_dur WHERE id = v_outcome.activity_id;
      END IF;
      v_log := v_outcome.id;
      n_merged := n_merged + 1;
    ELSE
      INSERT INTO contact_activities (
        contact_id, org_id, activity_type, subject, description, created_by, completed_at, call_duration,
        morning_reminder_sent, pre_action_reminder_sent
      ) VALUES (
        v_contact, v_org, 'call', CASE WHEN v_inbound THEN 'Incoming phone call' ELSE 'Phone call' END, v_desc,
        v_me, v_start + make_interval(secs => v_dur), v_dur, false, false
      ) RETURNING id INTO v_act;

      INSERT INTO call_logs (
        org_id, contact_id, agent_id, caller_type, call_type, direction, status,
        exotel_call_sid, from_number, to_number, call_duration, conversation_duration,
        started_at, answered_at, ended_at, activity_id, dialled_by_hand, phone_app_key, phone_device_id
      ) VALUES (
        v_org, v_contact, v_me, 'human',
        CASE WHEN v_inbound THEN 'inbound' ELSE 'outbound' END,
        CASE WHEN v_inbound THEN 'inbound' ELSE 'outbound' END,
        v_status, 'phone-' || v_key, '', COALESCE(v_phone, ''), v_dur, v_dur,
        v_start, CASE WHEN v_dur > 0 THEN v_start END, v_start + make_interval(secs => v_dur),
        v_act, true, v_key, d.id
      ) RETURNING id INTO v_log;
      n_saved := n_saved + 1;
    END IF;

    IF v_req IS NOT NULL THEN
      UPDATE phone_call_requests SET status = 'done', call_log_id = v_log, finished_at = now()
       WHERE id = v_req AND user_id = v_me AND contact_id = v_contact AND status IN ('waiting', 'dialling');
    END IF;
  END LOOP;

  UPDATE phone_devices SET last_sync_at = now(), last_sync_calls = n_saved + n_merged WHERE id = d.id;
  RETURN jsonb_build_object('saved', n_saved, 'merged', n_merged, 'duplicates', n_dup, 'ignored', n_ignored);
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_save_calls(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_save_calls(text, jsonb) TO authenticated;

-- Every two minutes while the app is running. Keeps click-to-call available and returns any
-- call request the phone may have missed while it was offline.
CREATE OR REPLACE FUNCTION public.phone_app_heartbeat(_device_key text, _call_log_allowed boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  d public.phone_devices := public.phone_app_device(v_org, _device_key);
BEGIN
  UPDATE phone_devices SET connected_until = now() + interval '5 minutes', call_log_allowed = COALESCE(_call_log_allowed, true)
   WHERE id = d.id;
  UPDATE phone_call_requests SET status = 'expired', finished_at = now()
   WHERE user_id = auth.uid() AND status = 'waiting' AND expires_at < now();
  RETURN jsonb_build_object('waiting', COALESCE((
    SELECT jsonb_agg(id ORDER BY created_at) FROM phone_call_requests
     WHERE user_id = auth.uid() AND status = 'waiting' AND expires_at > now()), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_heartbeat(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_heartbeat(text, boolean) TO authenticated;

-- The app signs off (sign-out, or the caller stops the app).
CREATE OR REPLACE FUNCTION public.phone_app_disconnect(_device_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE phone_devices SET connected_until = NULL WHERE user_id = auth.uid() AND device_key = _device_key;
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_disconnect(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_disconnect(text) TO authenticated;

-- The phone takes a call request: returns the number to dial (each view is logged).
CREATE OR REPLACE FUNCTION public.phone_app_claim_request(_device_key text, _request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  d public.phone_devices := public.phone_app_device(v_org, _device_key);
  r public.phone_call_requests;
  v_number text; v_name text;
BEGIN
  UPDATE phone_call_requests SET status = 'dialling', claimed_at = now(), device_id = d.id,
         expires_at = now() + interval '30 minutes'
   WHERE id = _request_id AND user_id = auth.uid() AND status = 'waiting' AND expires_at > now()
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'This call request has already been handled or has expired'); END IF;

  SELECT public.pii_contact_phone(c.id), trim(concat_ws(' ', c.first_name, c.last_name))
    INTO v_number, v_name FROM contacts c WHERE c.id = r.contact_id;
  IF length(right(regexp_replace(COALESCE(v_number, ''), '\D', '', 'g'), 10)) <> 10 THEN
    UPDATE phone_call_requests SET status = 'failed', failure = 'The contact has no usable number', finished_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'The contact has no usable number');
  END IF;
  IF public.pii_protected(v_org) THEN
    INSERT INTO pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose, accessed_at)
    VALUES (v_org, auth.uid(), 'contacts', 'phone', r.contact_id, 'phone_app_call', now());
  END IF;
  v_number := regexp_replace(v_number, '[^\d+]', '', 'g');
  IF v_number !~ '^\+' AND length(v_number) = 10 THEN v_number := '+91' || v_number; END IF;
  RETURN jsonb_build_object('ok', true, 'number', v_number, 'contact_name', v_name, 'request_id', r.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_claim_request(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_claim_request(text, uuid) TO authenticated;

-- The phone could not place the call (no permission, caller declined, call not found).
CREATE OR REPLACE FUNCTION public.phone_app_fail_request(_device_key text, _request_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.phone_app_org();
BEGIN
  PERFORM public.phone_app_device(v_org, _device_key);
  UPDATE phone_call_requests SET status = 'failed', failure = left(_reason, 200), finished_at = now()
   WHERE id = _request_id AND user_id = auth.uid() AND status IN ('waiting', 'dialling');
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_fail_request(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_fail_request(text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- CRM screen calls
-- ---------------------------------------------------------------------------

-- Is the phone app on for my organisation, and is my phone connected right now?
CREATE OR REPLACE FUNCTION public.my_phone_app_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org uuid; d record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  v_org := public.get_user_org_id(auth.uid());
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org AND COALESCE((settings->'phone_app'->>'enabled')::boolean, false)) THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  SELECT device_name, last_sync_at, connected_until INTO d FROM phone_devices
   WHERE user_id = auth.uid() AND org_id = v_org ORDER BY last_seen_at DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object(
    'enabled', true, 'installed', d.device_name IS NOT NULL OR d.last_sync_at IS NOT NULL,
    'device_name', d.device_name, 'last_sync_at', d.last_sync_at,
    'connected', COALESCE(d.connected_until > now(), false));
END;
$function$;
REVOKE ALL ON FUNCTION public.my_phone_app_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_phone_app_status() TO authenticated;

-- Click Call in the CRM: ask my phone to dial this contact.
CREATE OR REPLACE FUNCTION public.request_phone_call(_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  v_priv boolean := public.phone_app_is_privileged(v_org);
  v_contact record;
  v_id uuid;
BEGIN
  SELECT id, org_id, assigned_to INTO v_contact FROM contacts WHERE id = _contact_id;
  IF NOT FOUND OR v_contact.org_id <> v_org THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF NOT v_priv AND v_contact.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only call contacts assigned to you';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM phone_devices WHERE user_id = auth.uid() AND org_id = v_org AND connected_until > now()) THEN
    RAISE EXCEPTION 'Your phone is not connected. Open the In-Sync Phone app on your phone and try again.';
  END IF;
  UPDATE phone_call_requests SET status = 'cancelled', finished_at = now()
   WHERE user_id = auth.uid() AND status = 'waiting';
  INSERT INTO phone_call_requests (org_id, user_id, contact_id) VALUES (v_org, auth.uid(), _contact_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.request_phone_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_phone_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_phone_call(_request_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE phone_call_requests SET status = 'cancelled', finished_at = now()
   WHERE id = _request_id AND user_id = auth.uid() AND status IN ('waiting', 'dialling');
$function$;
REVOKE ALL ON FUNCTION public.cancel_phone_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_phone_call(uuid) TO authenticated;

-- Where a click-to-call has got to, with the call's length once the phone reports it.
CREATE OR REPLACE FUNCTION public.get_phone_call_request(_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'status', CASE WHEN r.status = 'waiting' AND r.expires_at < now() THEN 'expired'
                   WHEN r.status = 'dialling' AND r.expires_at < now() THEN 'failed' ELSE r.status END,
    'failure', CASE WHEN r.status = 'dialling' AND r.expires_at < now() THEN 'The phone did not report the call' ELSE r.failure END,
    'call_log_id', r.call_log_id, 'duration', l.call_duration, 'call_status', l.status,
    'disposition_id', l.disposition_id, 'sub_disposition_id', l.sub_disposition_id)
  FROM phone_call_requests r LEFT JOIN call_logs l ON l.id = r.call_log_id
  WHERE r.id = _request_id AND r.user_id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.get_phone_call_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phone_call_request(uuid) TO authenticated;

-- Outcome for a call the phone reported (click-to-call dialog).
CREATE OR REPLACE FUNCTION public.set_phone_call_outcome(
  _call_log_id uuid, _disposition_id uuid, _sub_disposition_id uuid DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.phone_app_org();
  v_log record;
BEGIN
  SELECT id, contact_id, agent_id, activity_id INTO v_log FROM call_logs
   WHERE id = _call_log_id AND org_id = v_org AND phone_app_key IS NOT NULL;
  IF NOT FOUND OR v_log.agent_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Call not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM call_dispositions WHERE id = _disposition_id AND org_id = v_org AND is_active) THEN
    RAISE EXCEPTION 'Unknown outcome';
  END IF;
  IF _sub_disposition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM call_sub_dispositions WHERE id = _sub_disposition_id AND disposition_id = _disposition_id
  ) THEN RAISE EXCEPTION 'Unknown sub-option'; END IF;

  UPDATE call_logs SET disposition_id = _disposition_id, sub_disposition_id = _sub_disposition_id,
         notes = COALESCE(NULLIF(_notes, ''), notes)
   WHERE id = v_log.id;
  IF v_log.activity_id IS NOT NULL THEN
    UPDATE contact_activities SET call_disposition_id = _disposition_id, call_sub_disposition_id = _sub_disposition_id,
           subject = 'Call completed', description = COALESCE(NULLIF(_notes, ''), description)
     WHERE id = v_log.activity_id;
  END IF;
  IF to_regprocedure('public.ajimos_apply_outcome_stage(uuid,uuid,uuid)') IS NOT NULL THEN
    PERFORM public.ajimos_apply_outcome_stage(v_log.contact_id, _disposition_id, _sub_disposition_id);
  END IF;
  RETURN v_log.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_phone_call_outcome(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_call_outcome(uuid, uuid, uuid, text) TO authenticated;

-- Manager view: each caller's phone, when it last checked in and last sent calls.
CREATE OR REPLACE FUNCTION public.phone_app_team_status()
RETURNS TABLE (user_id uuid, device_name text, last_seen_at timestamptz, last_sync_at timestamptz, connected boolean, call_log_allowed boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.phone_app_org();
BEGIN
  IF NOT public.phone_app_is_privileged(v_org) THEN RAISE EXCEPTION 'Only managers can see the team''s phones'; END IF;
  RETURN QUERY
    SELECT DISTINCT ON (p.user_id) p.user_id, p.device_name, p.last_seen_at, p.last_sync_at,
           COALESCE(p.connected_until > now(), false), p.call_log_allowed
    FROM phone_devices p WHERE p.org_id = v_org
    ORDER BY p.user_id, p.last_seen_at DESC NULLS LAST;
END;
$function$;
REVOKE ALL ON FUNCTION public.phone_app_team_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_app_team_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- Outcomes picked by hand attach to the phone call they belong to
-- ---------------------------------------------------------------------------

-- Same as before, plus: if the phone already reported a call to this player in the last
-- 30 minutes that has no outcome yet, the outcome goes on that call instead of a new one.
CREATE OR REPLACE FUNCTION public.save_manual_call_outcome(
  _contact_id uuid,
  _disposition_id uuid,
  _sub_disposition_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _follow_up_at timestamptz DEFAULT NULL,
  _activity_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_ajimos uuid := (SELECT id FROM public.organizations WHERE slug = 'ajimos');
  v_user uuid := auth.uid();
  v_contact record;
  v_privileged boolean;
  v_activity uuid := _activity_id;
  v_log uuid;
  v_phone record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF c_ajimos IS NULL THEN RAISE EXCEPTION 'Not available for this organisation'; END IF;
  IF public.get_user_org_id(v_user) IS DISTINCT FROM c_ajimos THEN
    RAISE EXCEPTION 'Not available for this organisation';
  END IF;

  SELECT id, org_id, assigned_to, phone, pipeline_stage_id INTO v_contact FROM contacts WHERE id = _contact_id;
  IF NOT FOUND OR v_contact.org_id <> c_ajimos THEN RAISE EXCEPTION 'Contact not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_user AND org_id = c_ajimos AND is_active = true
      AND role IN ('admin', 'super_admin', 'sales_manager')
  ) INTO v_privileged;
  IF NOT v_privileged AND v_contact.assigned_to IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'You can only save outcomes on contacts assigned to you';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM call_dispositions WHERE id = _disposition_id AND org_id = c_ajimos AND is_active) THEN
    RAISE EXCEPTION 'Unknown outcome';
  END IF;
  IF _sub_disposition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM call_sub_dispositions WHERE id = _sub_disposition_id AND disposition_id = _disposition_id
  ) THEN
    RAISE EXCEPTION 'Unknown sub-option';
  END IF;

  IF v_activity IS NULL THEN
    -- A call the phone app reported in the last 30 minutes, with no outcome yet.
    SELECT l.id, l.activity_id INTO v_phone FROM call_logs l
     WHERE l.org_id = c_ajimos AND l.contact_id = _contact_id AND l.agent_id = v_user
       AND l.phone_app_key IS NOT NULL AND l.disposition_id IS NULL
       AND NOT (l.direction = 'inbound' AND l.answered_at IS NULL)
       AND COALESCE(l.ended_at, l.started_at) > now() - interval '30 minutes'
     ORDER BY l.started_at DESC LIMIT 1;
    IF v_phone.id IS NOT NULL THEN
      UPDATE call_logs SET disposition_id = _disposition_id, sub_disposition_id = _sub_disposition_id,
             notes = COALESCE(NULLIF(_notes, ''), notes)
       WHERE id = v_phone.id;
      IF v_phone.activity_id IS NOT NULL THEN
        UPDATE contact_activities SET call_disposition_id = _disposition_id, call_sub_disposition_id = _sub_disposition_id,
               subject = 'Call completed', description = COALESCE(NULLIF(_notes, ''), description),
               next_action_date = COALESCE(_follow_up_at, next_action_date),
               next_action_notes = CASE WHEN _follow_up_at IS NOT NULL THEN 'Callback scheduled' ELSE next_action_notes END
         WHERE id = v_phone.activity_id;
      END IF;
      PERFORM public.ajimos_apply_outcome_stage(_contact_id, _disposition_id, _sub_disposition_id);
      RETURN v_phone.id;
    END IF;
  END IF;

  IF v_activity IS NOT NULL THEN
    -- Outcome logged through Log Activity: link to that activity (must be this caller's own, on this contact).
    IF NOT EXISTS (
      SELECT 1 FROM contact_activities
      WHERE id = v_activity AND contact_id = _contact_id AND org_id = c_ajimos AND created_by = v_user
    ) THEN
      RAISE EXCEPTION 'Activity not found';
    END IF;
    SELECT id INTO v_log FROM call_logs WHERE activity_id = v_activity;
    IF v_log IS NOT NULL THEN RETURN v_log; END IF;
  ELSE
    INSERT INTO contact_activities (
      contact_id, org_id, activity_type, subject, description,
      call_disposition_id, call_sub_disposition_id, created_by, completed_at,
      next_action_date, next_action_notes, morning_reminder_sent, pre_action_reminder_sent
    ) VALUES (
      _contact_id, c_ajimos, 'call', 'Call completed', COALESCE(NULLIF(_notes, ''), 'Call dialled by hand'),
      _disposition_id, _sub_disposition_id, v_user, now(),
      _follow_up_at,
      CASE WHEN _follow_up_at IS NOT NULL THEN 'Callback scheduled' END,
      false, false
    ) RETURNING id INTO v_activity;
  END IF;

  INSERT INTO call_logs (
    org_id, contact_id, agent_id, caller_type, call_type, direction, status,
    exotel_call_sid, from_number, to_number, call_duration,
    started_at, ended_at, disposition_id, sub_disposition_id, notes, activity_id, dialled_by_hand
  ) VALUES (
    c_ajimos, _contact_id, v_user, 'human', 'outbound', 'outbound', 'completed',
    'manual-' || gen_random_uuid()::text, '', COALESCE(v_contact.phone, ''), 0,
    now(), now(), _disposition_id, _sub_disposition_id, NULLIF(_notes, ''), v_activity, true
  ) RETURNING id INTO v_log;

  -- The outcome moves the player's stage (never backward).
  PERFORM public.ajimos_apply_outcome_stage(_contact_id, _disposition_id, _sub_disposition_id);

  RETURN v_log;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_manual_call_outcome(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_call_outcome(uuid, uuid, uuid, text, timestamptz, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Ajimos dashboards: outcomes saved stay the Calls figure; phone-reported calls add
-- phone calls, connected calls, clean calls (1 minute or more) and talk time.
-- Missed incoming calls are shown on the player's history but not counted as the caller's calls.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.gaming_caller_day_stats(uuid, date, date, uuid);
CREATE FUNCTION public.gaming_caller_day_stats(_org uuid, _from date, _to date, _agent uuid DEFAULT NULL::uuid)
 RETURNS TABLE(agent_id uuid, day date, login_at timestamp with time zone, logout_at timestamp with time zone, work_secs bigint, idle_secs bigint, calls bigint, new_dials bigint, connected_calls bigint, clean_calls bigint, registrations bigint, activations bigint, talk_secs bigint, phone_calls bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ranked as (
    select l.id, l.agent_id, l.contact_id, l.started_at, l.answered_at, l.call_duration, l.disposition_id, l.sub_disposition_id,
           l.phone_app_key, l.direction,
           row_number() over (partition by l.contact_id order by l.started_at) as nth
    from call_logs l
    where l.org_id = _org and l.started_at is not null and l.caller_type = 'human'
      and not (l.direction = 'inbound' and l.answered_at is null)
  ),
  c as (
    select r.agent_id,
           (r.started_at at time zone 'Asia/Kolkata')::date as day,
           r.started_at,
           r.started_at + make_interval(secs => coalesce(r.call_duration, 0)) as ended,
           coalesce(r.call_duration, 0) as dur,
           (r.nth = 1) as is_new,
           (r.answered_at is not null) as answered,
           (r.disposition_id is not null) as has_outcome,
           (r.phone_app_key is not null) as from_phone,
           d.name as dname,
           sd.name as sname
    from ranked r
    left join call_dispositions d on d.id = r.disposition_id
    left join call_sub_dispositions sd on sd.id = r.sub_disposition_id
    where r.agent_id is not null
      and (_agent is null or r.agent_id = _agent)
      and r.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
      and r.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  ),
  g as (
    select c.*, c.started_at - lag(c.ended) over (partition by c.agent_id, c.day order by c.started_at) as gap
    from c
  ),
  s as (
    select agent_id, day,
           min(started_at) as first_start, max(ended) as last_end,
           sum(extract(epoch from gap)) filter (where gap > interval '5 minutes') as gap_idle,
           count(*) filter (where has_outcome) as calls,
           count(*) filter (where is_new) as new_dials,
           count(*) filter (where answered) as connected_calls,
           count(*) filter (where dur >= 60) as clean_calls,
           count(*) filter (where dname = 'Registered' or (dname = 'Registration' and sname = 'Registration Completed')) as registrations,
           count(*) filter (where dname = 'Activated' or (dname = 'Deposit' and sname = 'Deposit Completed')) as activations,
           sum(dur) as talk_secs,
           count(*) filter (where from_phone) as phone_calls
    from g group by agent_id, day
  ),
  j as (
    select s.*, coalesce(a.sign_in_time, s.first_start) as login_at, coalesce(a.sign_out_time, s.last_end) as logout_at
    from s
    left join attendance_records a
      on a.org_id = _org and a.user_id = s.agent_id and a.date = s.day
  )
  select j.agent_id, j.day, j.login_at, j.logout_at,
         greatest(0, extract(epoch from (j.logout_at - j.login_at))
           - (coalesce(j.gap_idle, 0)
              + greatest(0, extract(epoch from (j.first_start - j.login_at)))
              + greatest(0, extract(epoch from (j.logout_at - j.last_end)))))::bigint as work_secs,
         greatest(0, least(extract(epoch from (j.logout_at - j.login_at)),
           coalesce(j.gap_idle, 0)
           + greatest(0, extract(epoch from (j.first_start - j.login_at)))
           + greatest(0, extract(epoch from (j.logout_at - j.last_end)))))::bigint as idle_secs,
         j.calls, j.new_dials, j.connected_calls, j.clean_calls, j.registrations, j.activations, j.talk_secs::bigint, j.phone_calls
  from j
  order by j.day, j.agent_id;
$function$;
GRANT EXECUTE ON FUNCTION public.gaming_caller_day_stats(uuid, date, date, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.gaming_hourly_counts(uuid, date, date, uuid);
CREATE FUNCTION public.gaming_hourly_counts(_org uuid, _from date, _to date, _agent uuid DEFAULT NULL::uuid)
 RETURNS TABLE(day date, hour integer, calls bigint, new_dials bigint, connected_calls bigint, clean_calls bigint, phone_calls bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ranked as (
    select l.agent_id, l.started_at, l.answered_at, l.call_duration, l.disposition_id, l.phone_app_key,
           row_number() over (partition by l.contact_id order by l.started_at) as nth
    from call_logs l
    where l.org_id = _org and l.started_at is not null and l.caller_type = 'human'
      and not (l.direction = 'inbound' and l.answered_at is null)
  )
  select (r.started_at at time zone 'Asia/Kolkata')::date as day,
         extract(hour from (r.started_at at time zone 'Asia/Kolkata'))::int as hour,
         count(*) filter (where r.disposition_id is not null) as calls,
         count(*) filter (where r.nth = 1) as new_dials,
         count(*) filter (where r.answered_at is not null) as connected_calls,
         count(*) filter (where coalesce(r.call_duration, 0) >= 60) as clean_calls,
         count(*) filter (where r.phone_app_key is not null) as phone_calls
  from ranked r
  where r.agent_id is not null
    and (_agent is null or r.agent_id = _agent)
    and r.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
    and r.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  group by 1, 2
  order by 1, 2;
$function$;
GRANT EXECUTE ON FUNCTION public.gaming_hourly_counts(uuid, date, date, uuid) TO authenticated;

-- Outcome counts only include calls that have an outcome.
CREATE OR REPLACE FUNCTION public.gaming_disposition_counts(_org uuid, _from date, _to date, _agent uuid DEFAULT NULL::uuid)
 RETURNS TABLE(agent_id uuid, disposition_id uuid, sub_disposition_id uuid, calls bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select l.agent_id, l.disposition_id, l.sub_disposition_id, count(*)
  from call_logs l
  where l.org_id = _org
    and l.agent_id is not null
    and l.disposition_id is not null
    and (_agent is null or l.agent_id = _agent)
    and l.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
    and l.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  group by 1, 2, 3;
$function$;

-- Switch it on for Ajimos.
UPDATE public.organizations
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{phone_app}', '{"enabled": true}'::jsonb, true)
 WHERE slug = 'ajimos';
