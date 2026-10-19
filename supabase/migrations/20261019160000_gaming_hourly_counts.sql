-- Calls per date and hour of the day (IST) for the Gaming dashboards' single graph.
-- Counts human callers' calls only. A new dial is a lead's first-ever human call.
-- Runs as the caller (RLS applies).

create or replace function public.gaming_hourly_counts(
  _org uuid, _from date, _to date, _agent uuid default null
)
returns table (day date, hour int, calls bigint, new_dials bigint, connected_calls bigint, clean_calls bigint)
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select l.agent_id, l.started_at, l.answered_at, l.call_duration,
           row_number() over (partition by l.contact_id order by l.started_at) as nth
    from call_logs l
    where l.org_id = _org and l.started_at is not null and l.caller_type = 'human'
  )
  select (r.started_at at time zone 'Asia/Kolkata')::date as day,
         extract(hour from (r.started_at at time zone 'Asia/Kolkata'))::int as hour,
         count(*) as calls,
         count(*) filter (where r.nth = 1) as new_dials,
         count(*) filter (where r.answered_at is not null) as connected_calls,
         count(*) filter (where coalesce(r.call_duration, 0) >= 60) as clean_calls
  from ranked r
  where r.agent_id is not null
    and (_agent is null or r.agent_id = _agent)
    and r.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
    and r.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  group by 1, 2
  order by 1, 2;
$$;

grant execute on function public.gaming_hourly_counts(uuid, date, date, uuid) to authenticated;
