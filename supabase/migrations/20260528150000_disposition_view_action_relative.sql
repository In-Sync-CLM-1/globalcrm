-- Make contact_latest_disposition action-relative.
--
-- Before: the view UNIONs call_logs + whatsapp_logs and picks the latest event
-- by timestamp per contact. For an IEDUP Call-action contact, the post-call
-- WhatsApp follow-up (ai-bolna-webhook sendPostCallWhatsApp, 5s after the call
-- ends) is always more recent than the call_log row -- so the contact's Status
-- ended up showing "Message Sent/Delivered/Opened" even though the chosen
-- ACTION was Call. The Status should reflect the action's own channel.
--
-- After: the view scopes each contact's events to the channel that matches
-- their CURRENT pipeline_stage's action_type:
--   * action_type='call'     -> only call_logs events count toward Status
--   * action_type='whatsapp' -> only whatsapp_logs events count toward Status
--   * action unconfigured    -> fall back to any latest event (non-IEDUP orgs
--                                that don't use pipeline_stage_actions yet)
--
-- Output schema is unchanged, so existing readers keep working.

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
         coalesce(wl.read_at, wl.delivered_at, wl.sent_at, wl.created_at) as dispositioned_at,
         'whatsapp'::text as event_channel
  from public.whatsapp_logs wl
  join public.call_dispositions d
    on d.org_id = wl.org_id
   and d.name = case wl.status
                  when 'read'      then 'Message Opened'
                  when 'delivered' then 'Message Delivered'
                  when 'sent'      then 'Message Sent'
                end
  where wl.contact_id is not null
    and wl.status in ('sent','delivered','read')
)
select distinct on (e.contact_id)
  e.org_id, e.contact_id, e.call_log_id, e.disposition_id,
  e.disposition_name, e.disposition_category, e.dispositioned_at
from events e
left join contact_action ca on ca.contact_id = e.contact_id
where
  -- Channel-of-event must match the contact's current action channel.
  -- When no action is configured (no IEDUP-style stage automation), fall back
  -- to any latest event so legacy / non-IEDUP orgs are unaffected.
  ca.action_type is null
  or (ca.action_type = 'call'     and e.event_channel = 'call')
  or (ca.action_type = 'whatsapp' and e.event_channel = 'whatsapp')
order by e.contact_id, e.dispositioned_at desc;

grant select on public.contact_latest_disposition to authenticated;
