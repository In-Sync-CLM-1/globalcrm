-- Caller productivity reports used by the Gaming CRM dashboards.
-- Both functions run as the caller (RLS applies) and read call_logs + attendance_records.
-- A "clean call" lasts 60 seconds or more. Registrations and activations are calls whose
-- disposition is named 'Registered' / 'Activated'. Idle time is every gap between calls
-- longer than 5 minutes, plus the time between login and the first call and between the
-- last call and logout, so work + idle always equals the logged-in span.

create or replace function public.gaming_caller_day_stats(
  _org uuid, _from date, _to date, _agent uuid default null
)
returns table (
  agent_id uuid, day date, login_at timestamptz, logout_at timestamptz,
  work_secs bigint, idle_secs bigint, calls bigint, connected_calls bigint,
  clean_calls bigint, registrations bigint, activations bigint, talk_secs bigint
)
language sql stable security invoker set search_path = public as $$
  with c as (
    select l.agent_id,
           (l.started_at at time zone 'Asia/Kolkata')::date as day,
           l.started_at,
           l.started_at + make_interval(secs => coalesce(l.call_duration, 0)) as ended,
           coalesce(l.call_duration, 0) as dur,
           d.name as dname
    from call_logs l
    left join call_dispositions d on d.id = l.disposition_id
    where l.org_id = _org
      and l.agent_id is not null
      and (_agent is null or l.agent_id = _agent)
      and l.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
      and l.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  ),
  g as (
    select c.*, c.started_at - lag(c.ended) over (partition by c.agent_id, c.day order by c.started_at) as gap
    from c
  ),
  s as (
    select agent_id, day,
           min(started_at) as first_start, max(ended) as last_end,
           sum(extract(epoch from gap)) filter (where gap > interval '5 minutes') as gap_idle,
           count(*) as calls,
           count(*) filter (where dname is not null and dname not in ('Not Connected', 'Wrong Number')) as connected_calls,
           count(*) filter (where dur >= 60) as clean_calls,
           count(*) filter (where dname = 'Registered') as registrations,
           count(*) filter (where dname = 'Activated') as activations,
           sum(dur) as talk_secs
    from g group by agent_id, day
  ),
  j as (
    select s.*, a.sign_in_time, a.sign_out_time,
           coalesce(a.sign_in_time, s.first_start) as login_at,
           coalesce(a.sign_out_time, s.last_end) as logout_at
    from s
    left join attendance_records a
      on a.org_id = _org and a.user_id = s.agent_id and a.date = s.day
  )
  select j.agent_id, j.day, j.login_at, j.logout_at,
         greatest(0, extract(epoch from (j.logout_at - j.login_at))
           - (coalesce(j.gap_idle, 0)
              + greatest(0, extract(epoch from (j.first_start - j.login_at)))
              + greatest(0, extract(epoch from (j.logout_at - j.last_end)))))::bigint as work_secs,
         greatest(0, least(extract(epoch from (j.logout_at - j.login_at)),
           coalesce(j.gap_idle, 0)
           + greatest(0, extract(epoch from (j.first_start - j.login_at)))
           + greatest(0, extract(epoch from (j.logout_at - j.last_end)))))::bigint as idle_secs,
         j.calls, j.connected_calls, j.clean_calls, j.registrations, j.activations, j.talk_secs::bigint
  from j
  order by j.day, j.agent_id;
$$;

create or replace function public.gaming_disposition_counts(
  _org uuid, _from date, _to date, _agent uuid default null
)
returns table (agent_id uuid, disposition_id uuid, sub_disposition_id uuid, calls bigint)
language sql stable security invoker set search_path = public as $$
  select l.agent_id, l.disposition_id, l.sub_disposition_id, count(*)
  from call_logs l
  where l.org_id = _org
    and l.agent_id is not null
    and (_agent is null or l.agent_id = _agent)
    and l.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
    and l.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
  group by 1, 2, 3;
$$;

grant execute on function public.gaming_caller_day_stats(uuid, date, date, uuid) to authenticated;
grant execute on function public.gaming_disposition_counts(uuid, date, date, uuid) to authenticated;
