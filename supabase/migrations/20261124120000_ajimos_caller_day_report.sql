-- Applies to organisation: Ajimos (ajimos) only.
-- 1) Day-wise caller report, counted from saved outcomes.
--    Connected = any outcome except Unreachable and Wrong Contact > Invalid Number.
--    Registered and Activated follow the same rule that moves the player's stage.
-- 2) Attendance switched on; the calling manager can see the team's attendance.

CREATE OR REPLACE FUNCTION public.gaming_caller_day_outcomes(_org uuid, _from date, _to date)
 RETURNS TABLE(agent_id uuid, day date, total bigint, connected bigint, interested bigint, follow_up bigint,
               registered bigint, activated bigint, not_interested bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select l.agent_id,
         (l.started_at at time zone 'Asia/Kolkata')::date as day,
         count(*),
         count(*) filter (where d.name not in ('Unreachable', 'Not Connected')
                            and not (d.name = 'Wrong Contact' and coalesce(s.name, '') = 'Invalid Number')),
         count(*) filter (where d.name = 'Interested'),
         count(*) filter (where d.name = 'Follow-up'),
         count(*) filter (where d.name = 'Registration' and s.name in ('Registration Completed', 'ID Created')),
         count(*) filter (where d.name = 'Deposit' and s.name = 'Deposit Completed'),
         count(*) filter (where d.name in ('Not Interested', 'Do Not Contact'))
  from call_logs l
  join call_dispositions d on d.id = l.disposition_id
  left join call_sub_dispositions s on s.id = l.sub_disposition_id
  where l.org_id = _org
    and l.agent_id is not null
    and l.caller_type = 'human'
    and l.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
    and l.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  group by 1, 2
  order by 1, 2;
$function$;
REVOKE ALL ON FUNCTION public.gaming_caller_day_outcomes(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gaming_caller_day_outcomes(uuid, date, date) TO authenticated;

UPDATE public.org_feature_access f
   SET is_enabled = true, enabled_at = now(), updated_at = now()
  FROM public.organizations o
 WHERE o.id = f.org_id AND o.slug = 'ajimos'
   AND f.feature_key IN ('attendance', 'attendance_regularization', 'hr_approvals');

DROP POLICY IF EXISTS ar_select_ajimos_manager ON public.attendance_records;
CREATE POLICY ar_select_ajimos_manager ON public.attendance_records
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT id FROM public.organizations WHERE slug = 'ajimos')
    AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.org_id = attendance_records.org_id
        AND r.role = 'sales_manager' AND r.is_active = true
    )
  );
