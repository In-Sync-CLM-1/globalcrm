-- Applies to organisation: Ajimos (ajimos) only. Every other organisation is unchanged.
-- Click-to-call through Dialixa, with a softphone inside the CRM.
--   * organizations.settings.dialixa.enabled switches it on (left OFF here until the Dialixa logins are in).
--   * organizations.settings.dialixa.softphone = {ws_url, domain, ice_servers} connects the softphone in the CRM.
--     Without it, calls still start and the caller answers in Dialixa's own softphone.
--   * A caller without a Dialixa extension keeps calling through the In-Sync Phone app.
-- Dialixa confirms only that a call was started, so dashboards keep counting saved outcomes. The times
-- the softphone was on the line are kept on dialixa_calls and are not shown as talk time.

CREATE TABLE IF NOT EXISTS public.dialixa_extensions (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  extension    text NOT NULL CHECK (extension ~ '^\d{2,12}$'),
  sip_username text,
  sip_password_encrypted bytea,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dialixa_extensions_org_ext_uniq UNIQUE (org_id, extension)
);
ALTER TABLE public.dialixa_extensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dialixa_extensions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.dialixa_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  direction    text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'failed')),
  http_status  integer,
  failure      text,
  line_answered_at timestamptz,
  line_ended_at    timestamptz,
  call_log_id  uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dialixa_calls_user ON public.dialixa_calls (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialixa_calls_contact ON public.dialixa_calls (contact_id);
ALTER TABLE public.dialixa_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dialixa_calls FROM anon, authenticated;
GRANT ALL ON public.dialixa_extensions, public.dialixa_calls TO service_role;

-- The signed-in user's organisation, when Dialixa is switched on for it. Ajimos only: the Dialixa account is theirs.
CREATE OR REPLACE FUNCTION public.dialixa_org()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_org FROM organizations
   WHERE id = public.get_user_org_id(auth.uid()) AND slug = 'ajimos'
     AND COALESCE((settings->'dialixa'->>'enabled')::boolean, false);
  IF v_org IS NULL THEN RAISE EXCEPTION 'Dialixa calling is not switched on for your organisation'; END IF;
  RETURN v_org;
END;
$function$;
REVOKE ALL ON FUNCTION public.dialixa_org() FROM PUBLIC, anon, authenticated;

-- Ajimos admins keep the extensions, also before calling is switched on.
CREATE OR REPLACE FUNCTION public.dialixa_admin_org()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT o.id INTO v_org FROM organizations o
   WHERE o.id = public.get_user_org_id(auth.uid()) AND o.slug = 'ajimos'
     AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = auth.uid() AND r.org_id = o.id
                 AND r.is_active = true AND r.role IN ('admin', 'super_admin'));
  IF v_org IS NULL THEN RAISE EXCEPTION 'Only admins can manage Dialixa extensions'; END IF;
  RETURN v_org;
END;
$function$;
REVOKE ALL ON FUNCTION public.dialixa_admin_org() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_dialixa_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o record; e record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT id, settings INTO o FROM organizations
   WHERE id = public.get_user_org_id(auth.uid()) AND slug = 'ajimos'
     AND COALESCE((settings->'dialixa'->>'enabled')::boolean, false);
  IF o.id IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT extension, sip_password_encrypted IS NOT NULL AS has_login INTO e
    FROM dialixa_extensions WHERE user_id = auth.uid() AND org_id = o.id;
  RETURN jsonb_build_object(
    'enabled', true, 'extension', e.extension,
    'softphone', COALESCE(e.has_login, false)
      AND COALESCE(o.settings->'dialixa'->'softphone'->>'ws_url', '') <> ''
      AND COALESCE(o.settings->'dialixa'->'softphone'->>'domain', '') <> '');
END;
$function$;

-- The caller's own softphone login. Nobody can read another person's.
CREATE OR REPLACE FUNCTION public.my_dialixa_softphone()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_org uuid := public.dialixa_org(); v_cfg jsonb; e record; v_key text;
BEGIN
  SELECT settings->'dialixa'->'softphone' INTO v_cfg FROM organizations WHERE id = v_org;
  SELECT * INTO e FROM dialixa_extensions WHERE user_id = auth.uid() AND org_id = v_org;
  IF e.user_id IS NULL OR e.sip_password_encrypted IS NULL OR COALESCE(v_cfg->>'ws_url', '') = '' THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'PII_ENCRYPTION_KEY' LIMIT 1;
  RETURN jsonb_build_object(
    'ws_url', v_cfg->>'ws_url', 'domain', v_cfg->>'domain',
    'ice_servers', COALESCE(v_cfg->'ice_servers', '[]'::jsonb),
    'extension', e.extension, 'username', COALESCE(NULLIF(e.sip_username, ''), e.extension),
    'password', extensions.pgp_sym_decrypt(e.sip_password_encrypted, v_key));
END;
$function$;

-- Starts a call record after checking who may call whom. Returns only its id; the number stays on the server.
CREATE OR REPLACE FUNCTION public.dialixa_begin_call(_contact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.dialixa_org(); v_contact record; v_id uuid;
BEGIN
  PERFORM 1 FROM dialixa_extensions WHERE user_id = auth.uid() AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You have no Dialixa extension yet. Ask your administrator to add it.'; END IF;
  SELECT id, org_id, assigned_to INTO v_contact FROM contacts WHERE id = _contact_id;
  IF NOT FOUND OR v_contact.org_id <> v_org THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF NOT public.phone_app_is_privileged(v_org) AND v_contact.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only call contacts assigned to you';
  END IF;
  IF EXISTS (SELECT 1 FROM dialixa_calls WHERE user_id = auth.uid() AND direction = 'outbound'
             AND status <> 'failed' AND created_at > now() - interval '4 seconds') THEN
    RAISE EXCEPTION 'A call is already being started';
  END IF;
  INSERT INTO dialixa_calls (org_id, user_id, contact_id) VALUES (v_org, auth.uid(), _contact_id) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Server only: what to send to Dialixa for a call just begun. Reading the number is logged.
CREATE OR REPLACE FUNCTION public.dialixa_call_target(_call_id uuid, _user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c record; e record; v_digits text; v_name text;
BEGIN
  SELECT * INTO c FROM dialixa_calls WHERE id = _call_id AND user_id = _user_id
     AND status = 'requested' AND created_at > now() - interval '1 minute' FOR UPDATE;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT extension INTO e FROM dialixa_extensions WHERE user_id = _user_id AND org_id = c.org_id;
  IF e.extension IS NULL THEN RETURN NULL; END IF;
  IF public.pii_protected(c.org_id) THEN
    v_digits := public.pii_contact_phone(c.contact_id);
    INSERT INTO pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose, accessed_at)
    VALUES (c.org_id, _user_id, 'contacts', 'phone', c.contact_id, 'dialixa_call', now());
  ELSE
    SELECT phone INTO v_digits FROM contacts WHERE id = c.contact_id;
  END IF;
  SELECT trim(concat_ws(' ', first_name, last_name)) INTO v_name FROM contacts WHERE id = c.contact_id;
  IF v_digits LIKE '%•%' THEN v_digits := NULL; END IF;
  v_digits := regexp_replace(COALESCE(v_digits, ''), '\D', '', 'g');
  -- Indian numbers go as 10 digits, as in Dialixa's guide; others with their country code.
  IF length(v_digits) = 12 AND v_digits LIKE '91%' THEN v_digits := right(v_digits, 10); END IF;
  IF length(v_digits) = 11 AND v_digits LIKE '0%' THEN v_digits := right(v_digits, 10); END IF;
  RETURN jsonb_build_object('extension', e.extension, 'name', v_name,
    'number', CASE WHEN length(v_digits) BETWEEN 10 AND 15 THEN v_digits END);
END;
$function$;

-- The softphone reports when its line was answered and when it ended.
CREATE OR REPLACE FUNCTION public.dialixa_report_line(_call_id uuid, _event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.dialixa_org();
  IF _event = 'answered' THEN
    UPDATE dialixa_calls SET line_answered_at = COALESCE(line_answered_at, now()) WHERE id = _call_id AND user_id = auth.uid();
  ELSIF _event = 'ended' THEN
    UPDATE dialixa_calls SET line_ended_at = COALESCE(line_ended_at, now()) WHERE id = _call_id AND user_id = auth.uid();
  END IF;
END;
$function$;

-- A call arriving on the softphone: which of the caller's own contacts is it?
CREATE OR REPLACE FUNCTION public.dialixa_begin_incoming(_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.dialixa_org(); v_contact uuid; v_name text; v_id uuid;
BEGIN
  v_contact := public.phone_app_match_contact(v_org, public.phone_app_is_privileged(v_org), _number);
  IF v_contact IS NULL THEN RETURN NULL; END IF;
  SELECT trim(concat_ws(' ', first_name, last_name)) INTO v_name FROM contacts WHERE id = v_contact;
  INSERT INTO dialixa_calls (org_id, user_id, contact_id, direction, status)
  VALUES (v_org, auth.uid(), v_contact, 'inbound', 'accepted') RETURNING id INTO v_id;
  RETURN jsonb_build_object('call_id', v_id, 'contact_id', v_contact, 'name', v_name);
END;
$function$;

-- The outcome of a Dialixa call is an ordinary Ajimos outcome: same checks, same stage move, same dashboards.
CREATE OR REPLACE FUNCTION public.dialixa_save_outcome(
  _call_id uuid, _disposition_id uuid, _sub_disposition_id uuid DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c record; v_log uuid;
BEGIN
  PERFORM public.dialixa_org();
  SELECT * INTO c FROM dialixa_calls WHERE id = _call_id AND user_id = auth.uid() FOR UPDATE;
  IF c.id IS NULL OR c.contact_id IS NULL OR c.status = 'failed' THEN RAISE EXCEPTION 'Call not found'; END IF;
  IF c.call_log_id IS NOT NULL THEN RETURN c.call_log_id; END IF;
  v_log := public.save_manual_call_outcome(c.contact_id, _disposition_id, _sub_disposition_id,
    COALESCE(NULLIF(_notes, ''), CASE WHEN c.direction = 'inbound' THEN 'Incoming Dialixa call' ELSE 'Dialixa call' END), NULL, NULL);
  UPDATE dialixa_calls SET call_log_id = v_log WHERE id = c.id;
  RETURN v_log;
END;
$function$;

-- Admin screen. The softphone password can be set but never read back.
CREATE OR REPLACE FUNCTION public.dialixa_extensions_list()
RETURNS TABLE (user_id uuid, name text, extension text, sip_username text, has_password boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.dialixa_admin_org();
BEGIN
  RETURN QUERY
    SELECT p.id, trim(concat_ws(' ', p.first_name, p.last_name)), e.extension, e.sip_username, e.sip_password_encrypted IS NOT NULL
    FROM profiles p LEFT JOIN dialixa_extensions e ON e.user_id = p.id AND e.org_id = v_org
    WHERE p.org_id = v_org ORDER BY 2;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialixa_set_extension(
  _user_id uuid, _extension text, _sip_username text DEFAULT NULL, _sip_password text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_org uuid := public.dialixa_admin_org(); v_key text; v_pw bytea;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id AND org_id = v_org) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF COALESCE(trim(_extension), '') = '' THEN
    DELETE FROM dialixa_extensions WHERE user_id = _user_id AND org_id = v_org;
    RETURN;
  END IF;
  IF trim(_extension) !~ '^\d{2,12}$' THEN RAISE EXCEPTION 'The extension must be digits only'; END IF;
  IF EXISTS (SELECT 1 FROM dialixa_extensions x WHERE x.org_id = v_org AND x.extension = trim(_extension) AND x.user_id <> _user_id) THEN
    RAISE EXCEPTION 'This extension is already given to another user';
  END IF;
  IF COALESCE(_sip_password, '') <> '' THEN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'PII_ENCRYPTION_KEY' LIMIT 1;
    IF v_key IS NULL THEN RAISE EXCEPTION 'Passwords cannot be stored right now'; END IF;
    v_pw := extensions.pgp_sym_encrypt(_sip_password, v_key);
  END IF;
  INSERT INTO dialixa_extensions AS d (user_id, org_id, extension, sip_username, sip_password_encrypted, updated_by)
  VALUES (_user_id, v_org, trim(_extension), NULLIF(trim(_sip_username), ''), v_pw, auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id, extension = EXCLUDED.extension,
    sip_username = EXCLUDED.sip_username, updated_by = EXCLUDED.updated_by, updated_at = now(),
    sip_password_encrypted = COALESCE(EXCLUDED.sip_password_encrypted, d.sip_password_encrypted);
END;
$function$;

REVOKE ALL ON FUNCTION public.dialixa_call_target(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialixa_call_target(uuid, uuid) TO service_role;
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'my_dialixa_status()', 'my_dialixa_softphone()', 'dialixa_begin_call(uuid)', 'dialixa_report_line(uuid, text)',
    'dialixa_begin_incoming(text)', 'dialixa_save_outcome(uuid, uuid, uuid, text)', 'dialixa_extensions_list()',
    'dialixa_set_extension(uuid, text, text, text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated';
  END LOOP;
END
$grants$;

UPDATE public.organizations
   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{dialixa}', '{"enabled": false}'::jsonb, true)
 WHERE slug = 'ajimos' AND NOT (COALESCE(settings, '{}'::jsonb) ? 'dialixa');
