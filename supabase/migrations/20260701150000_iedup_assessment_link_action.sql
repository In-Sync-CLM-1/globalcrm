-- IEDUP: new "Send WhatsApp - Assessment Link" pipeline stage + action.
-- Notifies a beneficiary that their CM YUVA assessment link is live (12h window)
-- and warns that missing it blocks certificate issuance.

with new_stage as (
  insert into public.pipeline_stages (org_id, name, stage_order, probability, color, is_active)
  select '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d', 'Send WhatsApp - Assessment Link', 9, 0, '#06b6d4', true
  where not exists (
    select 1 from public.pipeline_stages
    where org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'
      and name = 'Send WhatsApp - Assessment Link'
  )
  returning id, org_id
)
insert into public.pipeline_stage_actions (org_id, stage_id, action_type, template_name, language_code)
select org_id, id, 'whatsapp', 'iedup_cmyuva_assessment_link_v1', 'hi'
from new_stage
on conflict (stage_id) do update
  set action_type = excluded.action_type,
      template_name = excluded.template_name,
      language_code = excluded.language_code,
      is_active = true;
