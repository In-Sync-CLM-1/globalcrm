-- Applies to organisation: Ajimos (ajimos). Dialixa calls only.
-- A contact added by hand can hold its locked number only in contact_phones; the call used to say
-- "no callable number". Fall back to the primary (then any) locked extra phone.
CREATE OR REPLACE FUNCTION public.dialixa_call_target(_call_id uuid, _user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
  IF COALESCE(v_digits, '') = '' AND public.pii_protected(c.org_id) THEN
    SELECT public.decrypt_pii(p.phone_encrypted) INTO v_digits FROM contact_phones p
     WHERE p.contact_id = c.contact_id AND p.phone_encrypted IS NOT NULL
     ORDER BY COALESCE(p.is_primary, false) DESC, p.created_at LIMIT 1;
    IF v_digits LIKE '%•%' THEN v_digits := NULL; END IF;
  END IF;
  v_digits := regexp_replace(COALESCE(v_digits, ''), '\D', '', 'g');
  -- Indian numbers go as 10 digits, as in Dialixa's guide; others with their country code.
  IF length(v_digits) = 12 AND v_digits LIKE '91%' THEN v_digits := right(v_digits, 10); END IF;
  IF length(v_digits) = 11 AND v_digits LIKE '0%' THEN v_digits := right(v_digits, 10); END IF;
  RETURN jsonb_build_object('extension', e.extension, 'name', v_name,
    'number', CASE WHEN length(v_digits) BETWEEN 10 AND 15 THEN v_digits END);
END;
$function$;
