-- IEDUP: wire the "Send WhatsApp - Short Attendance" action.
-- Stage already existed (stage_order=8) named just "Short Attendance" with no
-- pipeline_stage_actions row. Rename to match the "Send WhatsApp - X" convention
-- the other stages use, then seed the action -> template_name mapping.
-- Meta template iedup_cmyuva_short_attendance_v1 (id 1283164690255245) is the
-- "low / NIL attendance reminder" UTILITY template with a लॉगिन करें URL button.

update public.pipeline_stages
   set name = 'Send WhatsApp - Short Attendance',
       updated_at = now()
 where id = 'f83bc2cd-0b17-4540-a895-94cc1c90185b'
   and org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'
   and name = 'Short Attendance';

insert into public.pipeline_stage_actions
  (org_id, stage_id, action_type, template_name, language_code, is_active)
values
  ('6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d',
   'f83bc2cd-0b17-4540-a895-94cc1c90185b',
   'whatsapp',
   'iedup_cmyuva_short_attendance_v1',
   'hi',
   true)
on conflict (stage_id) do update
   set action_type   = excluded.action_type,
       template_name = excluded.template_name,
       language_code = excluded.language_code,
       is_active     = true;
