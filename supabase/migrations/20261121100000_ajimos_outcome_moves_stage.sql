-- Ajimos only: a saved call outcome moves the player's pipeline stage.
--   Interested -> Interested
--   Registration > Registration Completed / ID Created -> Registered
--   Deposit > Deposit Completed -> Activated
--   Not Interested, Do Not Contact -> Lost
--   any other outcome -> Contacted, only if the player is at New
-- A player never moves backward (New, Contacted, Interested, Registered, Activated).
-- Lost applies only to players at New, Contacted or Interested.
-- Ends with a one-time catch-up using each Ajimos player's latest outcome.

CREATE OR REPLACE FUNCTION public.ajimos_apply_outcome_stage(
  _contact_id uuid, _disposition_id uuid, _sub_disposition_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_ajimos uuid := (SELECT id FROM public.organizations WHERE slug = 'ajimos');
  v_dname text;
  v_sname text;
  v_cur_id uuid;
  v_cur text;
  v_cur_rank int;
  v_target text;
  v_target_rank int;
  v_target_id uuid;
  v_ranks text[] := ARRAY['new', 'contacted', 'interested', 'registered', 'activated'];
BEGIN
  IF c_ajimos IS NULL THEN RETURN; END IF;
  SELECT pipeline_stage_id INTO v_cur_id FROM contacts WHERE id = _contact_id AND org_id = c_ajimos;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT lower(name) INTO v_cur FROM pipeline_stages WHERE id = v_cur_id;
  v_cur_rank := array_position(v_ranks, v_cur);

  SELECT name INTO v_dname FROM call_dispositions WHERE id = _disposition_id AND org_id = c_ajimos;
  IF v_dname IS NULL THEN RETURN; END IF;
  SELECT name INTO v_sname FROM call_sub_dispositions WHERE id = _sub_disposition_id;

  IF v_dname = 'Interested' THEN v_target := 'interested';
  ELSIF v_dname = 'Registration' AND v_sname IN ('Registration Completed', 'ID Created') THEN v_target := 'registered';
  ELSIF v_dname = 'Deposit' AND v_sname = 'Deposit Completed' THEN v_target := 'activated';
  ELSIF v_dname IN ('Not Interested', 'Do Not Contact') THEN v_target := 'lost';
  ELSE v_target := 'contacted';
  END IF;

  IF v_target = 'lost' THEN
    IF v_cur_rank IS NULL OR v_cur_rank > 3 THEN RETURN; END IF;
  ELSIF v_target = 'contacted' THEN
    IF v_cur_rank IS DISTINCT FROM 1 THEN RETURN; END IF;
  ELSE
    v_target_rank := array_position(v_ranks, v_target);
    IF v_cur_rank IS NULL OR v_target_rank <= v_cur_rank THEN RETURN; END IF;
  END IF;

  SELECT id INTO v_target_id FROM pipeline_stages
   WHERE org_id = c_ajimos AND lower(name) = v_target AND is_active LIMIT 1;
  IF v_target_id IS NOT NULL THEN
    UPDATE contacts SET pipeline_stage_id = v_target_id WHERE id = _contact_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajimos_apply_outcome_stage(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

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

-- Correction path of the Pipeline dropdowns: the stage follows the corrected outcome too.
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

  SELECT id, agent_id, dialled_by_hand, created_at, activity_id INTO v_last
  FROM call_logs
  WHERE contact_id = _contact_id AND org_id = c_ajimos
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_last.dialled_by_hand AND v_last.agent_id = v_user
     AND v_last.created_at > now() - interval '5 minutes' THEN
    PERFORM public.check_manual_call_outcome(_contact_id, _disposition_id, _sub_disposition_id);
    UPDATE call_logs
       SET disposition_id = _disposition_id, sub_disposition_id = _sub_disposition_id
     WHERE id = v_last.id;
    IF v_last.activity_id IS NOT NULL THEN
      UPDATE contact_activities
         SET call_disposition_id = _disposition_id, call_sub_disposition_id = _sub_disposition_id
       WHERE id = v_last.activity_id;
    END IF;
    PERFORM public.ajimos_apply_outcome_stage(_contact_id, _disposition_id, _sub_disposition_id);
    RETURN v_last.id;
  END IF;

  RETURN public.save_manual_call_outcome(_contact_id, _disposition_id, _sub_disposition_id, NULL, NULL, NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_pipeline_call_outcome(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pipeline_call_outcome(uuid, uuid, uuid) TO authenticated;

-- One-time catch-up: apply the rule to each Ajimos player's latest outcome.
DO $catchup$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (l.contact_id) l.contact_id, l.disposition_id, l.sub_disposition_id
    FROM call_logs l
    JOIN organizations o ON o.id = l.org_id AND o.slug = 'ajimos'
    WHERE l.disposition_id IS NOT NULL AND l.contact_id IS NOT NULL
    ORDER BY l.contact_id, l.created_at DESC
  LOOP
    PERFORM public.ajimos_apply_outcome_stage(r.contact_id, r.disposition_id, r.sub_disposition_id);
  END LOOP;
END;
$catchup$;
