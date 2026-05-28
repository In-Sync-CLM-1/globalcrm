-- Surface failed WhatsApp sends as a 'Message Failed' status.
--
-- Today, whatsapp_logs.status='failed' (carrier rejection, e.g.
-- EX_INCAPABLE_RECIPIENT for numbers without WhatsApp) does not surface
-- anywhere in the Status column -- the view only maps 'sent'/'delivered'/'read'
-- to a disposition. The contact ends up looking unactioned even though we
-- already tried and the carrier said the recipient cannot receive.
--
-- 1. Add IEDUP's 'Message Failed' disposition (case-sensitive name; matched by
--    INNER JOIN inside contact_latest_disposition, so other orgs are unaffected).
-- 2. Extend the WA branch of the view to map status='failed' -> 'Message Failed',
--    timestamped by failed_at (with sensible fallbacks).

-- No unique constraint on (org_id, name); guard manually so re-running the
-- migration is a no-op.
insert into public.call_dispositions (org_id, name, category, is_active)
select '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d', 'Message Failed', 'message', true
where not exists (
  select 1 from public.call_dispositions
  where org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'
    and name   = 'Message Failed'
);

update public.call_dispositions
   set is_active = true,
       category  = coalesce(category, 'message')
 where org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'
   and name   = 'Message Failed';

create or replace view public.contact_latest_disposition as
with contact_action as (
  select c.id as contact_id, psa.action_type
  from public.contacts c
  left join public.pipeline_stage_actions psa
    on psa.stage_id = c.pipeline_stage_id
   and psa.is_active = true
),
events as (
  select cl.org_id, cl.contact_id, cl.id as call_log_id, cl.disposition_id,
         d.name as disposition_name, d.category as disposition_category,
         cl.created_at as dispositioned_at,
         'call'::text as event_channel
  from public.call_logs cl
  join public.call_dispositions d on d.id = cl.disposition_id
  where cl.contact_id is not null and cl.disposition_id is not null

  union all

  select wl.org_id, wl.contact_id, null::uuid as call_log_id, d.id as disposition_id,
         d.name as disposition_name, d.category as disposition_category,
         coalesce(wl.read_at, wl.delivered_at, wl.sent_at, wl.failed_at, wl.created_at) as dispositioned_at,
         'whatsapp'::text as event_channel
  from public.whatsapp_logs wl
  join public.call_dispositions d
    on d.org_id = wl.org_id
   and d.name = case wl.status
                  when 'read'      then 'Message Opened'
                  when 'delivered' then 'Message Delivered'
                  when 'sent'      then 'Message Sent'
                  when 'failed'    then 'Message Failed'
                end
  where wl.contact_id is not null
    and wl.status in ('sent','delivered','read','failed')
)
select distinct on (e.contact_id)
  e.org_id, e.contact_id, e.call_log_id, e.disposition_id,
  e.disposition_name, e.disposition_category, e.dispositioned_at
from events e
left join contact_action ca on ca.contact_id = e.contact_id
where
  ca.action_type is null
  or (ca.action_type = 'call'     and e.event_channel = 'call')
  or (ca.action_type = 'whatsapp' and e.event_channel = 'whatsapp')
order by e.contact_id, e.dispositioned_at desc;

grant select on public.contact_latest_disposition to authenticated;
