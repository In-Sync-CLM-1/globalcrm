-- IEDUP pipeline list: one function that returns enriched, action-aware,
-- server-side-paginated + filterable beneficiaries. "Status" reflects the
-- COMPLETION OF THE CONTACT'S ACTUAL ACTION (WhatsApp send / call), not just
-- call attempts — so a WhatsApp beneficiary no longer always reads "Pending".
-- Filters (Action stage, Status, Disposition, date) apply across the whole set,
-- not just the visible page.
--
-- SECURITY DEFINER so it can read the operational tables (call_logs, whatsapp_logs)
-- regardless of per-user RLS, guarded to the caller's own org (or service role).
create or replace function public.get_iedup_beneficiaries(
  p_org         uuid,
  p_limit       int,
  p_offset      int,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_stage_id    uuid default null,
  p_status      text default null,
  p_disposition text default null
)
returns table (
  id uuid, first_name text, last_name text, name_hi text, phone text,
  do_not_call boolean, created_at timestamptz, pipeline_stage_id uuid,
  action text, attempts int, connected int, last_call_at timestamptz,
  disposition text, status text, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select c.id, c.first_name, c.last_name, c.name_hi, c.phone, c.do_not_call,
           c.created_at, c.pipeline_stage_id,
           ps.name as action, psa.action_type as action_type
    from contacts c
    left join pipeline_stages ps on ps.id = c.pipeline_stage_id
    left join pipeline_stage_actions psa on psa.stage_id = c.pipeline_stage_id and psa.is_active
    where c.org_id = p_org
      -- org guard: caller must belong to p_org (service role has null auth.uid())
      and (auth.uid() is null
           or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.org_id = p_org))
      and (p_from is null or c.created_at >= p_from)
      and (p_to is null or c.created_at <= p_to)
      and (p_stage_id is null or c.pipeline_stage_id = p_stage_id)
  ),
  cs as (
    select contact_id,
           count(*)::int as attempts,
           count(*) filter (where coalesce(conversation_duration,0) >= 5)::int as connected,
           max(started_at) as last_call_at
    from call_logs
    where org_id = p_org and caller_type = 'ai' and started_at is not null
    group by contact_id
  ),
  ws as (
    select contact_id,
           max(case status when 'read' then 5 when 'delivered' then 4
                           when 'sent' then 3 when 'queued' then 2
                           when 'failed' then 1 else 0 end) as rank
    from whatsapp_logs
    where org_id = p_org
    group by contact_id
  ),
  enriched as (
    select b.id, b.first_name, b.last_name, b.name_hi, b.phone, b.do_not_call,
           b.created_at, b.pipeline_stage_id, b.action,
           coalesce(cs.attempts,0) as attempts,
           coalesce(cs.connected,0) as connected,
           cs.last_call_at,
           cld.disposition_name as disposition,
           case
             when b.do_not_call then 'Do not call'
             when b.action_type = 'whatsapp' then
               case ws.rank when 5 then 'Opened' when 4 then 'Delivered'
                            when 3 then 'Sent' when 1 then 'Failed' else 'Pending' end
             when b.action_type = 'call' then
               case when coalesce(cs.connected,0) > 0 then 'Connected'
                    when coalesce(cs.attempts,0) >= 3 then 'Max attempts'
                    when coalesce(cs.attempts,0) > 0 then 'Attempted'
                    else 'Pending' end
             when coalesce(cs.connected,0) > 0 then 'Connected'
             when coalesce(cs.attempts,0) > 0 then 'Attempted'
             else 'No action'
           end as status
    from base b
    left join cs on cs.contact_id = b.id
    left join ws on ws.contact_id = b.id
    left join contact_latest_disposition cld on cld.contact_id = b.id
  ),
  filtered as (
    select * from enriched
    where (p_status is null or status = p_status)
      and (p_disposition is null
           or (p_disposition = 'none' and disposition is null)
           or disposition = p_disposition)
  )
  select id, first_name, last_name, name_hi, phone, do_not_call, created_at,
         pipeline_stage_id, action, attempts, connected, last_call_at,
         disposition, status, count(*) over() as total_count
  from filtered
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_iedup_beneficiaries(uuid, int, int, timestamptz, timestamptz, uuid, text, text) to authenticated, service_role;
