-- Beneficiaries' Disposition column reads contact_latest_disposition, which
-- only ever unioned call_logs and whatsapp_logs. Email was added as a raw-fire
-- channel (20260728110000) but the view was never extended, so every email
-- send shows "--" regardless of whether it actually sent. Add the missing
-- email branch and seed the two dispositions it joins against for IEDUP.
--
-- Also repoints the channel filter (contact_action CTE) to prefer the raw
-- contacts.action_channel IEDUP now writes per-contact, falling back to the
-- old pipeline_stage_actions lookup for orgs still on stage-driven automation
-- (per-org untouched, per 20260728110000). Without this, IEDUP contacts whose
-- pipeline_stage_id still carries a leftover active whatsapp/call stage-action
-- would keep having their email events filtered out even after the union fix.

insert into public.call_dispositions (org_id, name, category, is_active)
select '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d', 'Email Sent', 'neutral', true
where not exists (
  select 1 from public.call_dispositions
  where org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d' and name = 'Email Sent'
);

insert into public.call_dispositions (org_id, name, category, is_active)
select '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d', 'Email Failed', 'message', true
where not exists (
  select 1 from public.call_dispositions
  where org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d' and name = 'Email Failed'
);

create or replace view public.contact_latest_disposition as
with contact_action as (
  select c.id as contact_id,
         coalesce(c.action_channel, psa.action_type) as action_type
  from public.contacts c
  left join public.pipeline_stage_actions psa
    on psa.stage_id = c.pipeline_stage_id and psa.is_active = true
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

  union all

  select pel.org_id, pel.contact_id, null::uuid as call_log_id, d.id as disposition_id,
         d.name as disposition_name, d.category as disposition_category,
         coalesce(pel.sent_at, pel.failed_at, pel.created_at) as dispositioned_at,
         'email'::text as event_channel
  from public.pipeline_email_log pel
  join public.call_dispositions d
    on d.org_id = pel.org_id
   and d.name = case pel.status
                  when 'sent'   then 'Email Sent'
                  when 'failed' then 'Email Failed'
                end
  where pel.contact_id is not null
    and pel.status in ('sent','failed')
)
select distinct on (e.contact_id)
  e.org_id, e.contact_id, e.call_log_id, e.disposition_id,
  e.disposition_name, e.disposition_category, e.dispositioned_at
from events e
left join contact_action ca on ca.contact_id = e.contact_id
where ca.action_type is null
   or (ca.action_type = 'call' and e.event_channel = 'call')
   or (ca.action_type = 'whatsapp' and e.event_channel = 'whatsapp')
   or (ca.action_type = 'email' and e.event_channel = 'email')
order by e.contact_id, e.dispositioned_at desc;

grant select on public.contact_latest_disposition to authenticated;
