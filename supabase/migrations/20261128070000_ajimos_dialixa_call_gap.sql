-- Applies to organisation: Ajimos (ajimos). Dialixa calling only.
-- The admin sets the gap between calls when calling one player after another
-- (settings.dialixa.next_call_gap_sec, 0-600 seconds, default 3).

CREATE OR REPLACE FUNCTION public.my_dialixa_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o record; e record; v_reports boolean; v_gap int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('enabled', false, 'reports', false); END IF;
  SELECT id, settings INTO o FROM organizations WHERE id = public.get_user_org_id(auth.uid()) AND slug = 'ajimos';
  IF o.id IS NULL THEN RETURN jsonb_build_object('enabled', false, 'reports', false); END IF;
  v_reports := COALESCE((o.settings->'dialixa'->>'reports')::boolean, false);
  v_gap := COALESCE((o.settings->'dialixa'->>'next_call_gap_sec')::int, 3);
  IF NOT COALESCE((o.settings->'dialixa'->>'enabled')::boolean, false) THEN
    RETURN jsonb_build_object('enabled', false, 'reports', v_reports, 'next_call_gap', v_gap);
  END IF;
  SELECT extension, sip_password_encrypted IS NOT NULL AS has_login INTO e
    FROM dialixa_extensions WHERE user_id = auth.uid() AND org_id = o.id;
  RETURN jsonb_build_object(
    'enabled', true, 'reports', v_reports, 'extension', e.extension, 'next_call_gap', v_gap,
    'softphone', COALESCE(e.has_login, false)
      AND COALESCE(o.settings->'dialixa'->'softphone'->>'ws_url', '') <> ''
      AND COALESCE(o.settings->'dialixa'->'softphone'->>'domain', '') <> '');
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialixa_set_call_gap(_seconds int)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org uuid := public.dialixa_admin_org();
BEGIN
  IF _seconds IS NULL OR _seconds < 0 OR _seconds > 600 THEN
    RAISE EXCEPTION 'The gap must be between 0 and 600 seconds';
  END IF;
  UPDATE organizations
     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{dialixa}',
           COALESCE(settings->'dialixa', '{}'::jsonb) || jsonb_build_object('next_call_gap_sec', _seconds))
   WHERE id = v_org;
  RETURN _seconds;
END;
$function$;
REVOKE ALL ON FUNCTION public.dialixa_set_call_gap(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dialixa_set_call_gap(int) TO authenticated;
