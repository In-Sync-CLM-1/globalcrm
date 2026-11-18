-- Ajimos only: callers set the call outcome straight from the Pipeline list (two dropdowns per row).
-- A change by the same person within 5 minutes of their last pick on that contact is a correction:
-- it replaces that pick (same call record, same activity) and is not counted as another call.
-- After 5 minutes, or when someone else's call came in between, it is saved as a new call dialled by hand.

CREATE OR REPLACE FUNCTION public.set_pipeline_call_outcome(
  _contact_id uuid,
  _disposition_id uuid,
  _sub_disposition_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_ajimos uuid := (SELECT id FROM public.organizations WHERE slug = 'ajimos');
  v_user uuid := auth.uid();
  v_last record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- The contact's most recent call record of any kind.
  SELECT id, agent_id, dialled_by_hand, created_at, activity_id INTO v_last
  FROM call_logs
  WHERE contact_id = _contact_id AND org_id = c_ajimos
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_last.dialled_by_hand AND v_last.agent_id = v_user
     AND v_last.created_at > now() - interval '5 minutes' THEN
    -- Same checks as a new save (organisation, permission, valid outcome), without inserting.
    PERFORM public.check_manual_call_outcome(_contact_id, _disposition_id, _sub_disposition_id);
    UPDATE call_logs
       SET disposition_id = _disposition_id, sub_disposition_id = _sub_disposition_id
     WHERE id = v_last.id;
    IF v_last.activity_id IS NOT NULL THEN
      UPDATE contact_activities
         SET call_disposition_id = _disposition_id, call_sub_disposition_id = _sub_disposition_id
       WHERE id = v_last.activity_id;
    END IF;
    RETURN v_last.id;
  END IF;

  RETURN public.save_manual_call_outcome(_contact_id, _disposition_id, _sub_disposition_id, NULL, NULL, NULL);
END;
$function$;

-- Shared checks: signed-in user in Ajimos, may act on this contact, outcome and sub-option are valid.
CREATE OR REPLACE FUNCTION public.check_manual_call_outcome(
  _contact_id uuid,
  _disposition_id uuid,
  _sub_disposition_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_ajimos uuid := (SELECT id FROM public.organizations WHERE slug = 'ajimos');
  v_user uuid := auth.uid();
  v_contact record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF c_ajimos IS NULL OR public.get_user_org_id(v_user) IS DISTINCT FROM c_ajimos THEN
    RAISE EXCEPTION 'Not available for this organisation';
  END IF;
  SELECT id, org_id, assigned_to INTO v_contact FROM contacts WHERE id = _contact_id;
  IF NOT FOUND OR v_contact.org_id <> c_ajimos THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_user AND org_id = c_ajimos AND is_active = true
      AND role IN ('admin', 'super_admin', 'sales_manager')
  ) AND v_contact.assigned_to IS DISTINCT FROM v_user THEN
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
END;
$function$;

REVOKE ALL ON FUNCTION public.check_manual_call_outcome(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_manual_call_outcome(uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_pipeline_call_outcome(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pipeline_call_outcome(uuid, uuid, uuid) TO authenticated;
