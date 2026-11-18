-- Ajimos only: outcomes for calls dialled by hand (from the caller's own phone) are saved as call
-- records, so they show in the Pipeline Disposition column and filter and are counted on the team and
-- caller dashboards exactly like system calls. They are marked as dialled by hand so they can be told
-- apart from system calls later. Every other organisation is unchanged.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS dialled_by_hand boolean NOT NULL DEFAULT false;

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
  c_ajimos constant uuid := '819f6346-30c4-46a9-95e5-5851554ba8cd';
  v_user uuid := auth.uid();
  v_contact record;
  v_privileged boolean;
  v_activity uuid := _activity_id;
  v_log uuid;
  v_new_stage uuid;
  v_contacted_stage uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
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

  -- Same as a system call: a contact still in "New" moves to "Contacted".
  SELECT id INTO v_new_stage FROM pipeline_stages WHERE org_id = c_ajimos AND name ILIKE 'new' AND is_active LIMIT 1;
  IF v_new_stage IS NOT NULL AND v_contact.pipeline_stage_id = v_new_stage THEN
    SELECT id INTO v_contacted_stage FROM pipeline_stages WHERE org_id = c_ajimos AND name ILIKE 'contacted' AND is_active LIMIT 1;
    IF v_contacted_stage IS NOT NULL THEN
      UPDATE contacts SET pipeline_stage_id = v_contacted_stage WHERE id = _contact_id;
    END IF;
  END IF;

  RETURN v_log;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_manual_call_outcome(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_call_outcome(uuid, uuid, uuid, text, timestamptz, uuid) TO authenticated;
