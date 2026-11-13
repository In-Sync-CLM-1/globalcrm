-- A new dial is a lead's first-ever call by a human caller (AI calls do not count, and are not caller rows).
drop function if exists public.gaming_caller_day_stats(uuid, date, date, uuid);

create function public.gaming_caller_day_stats(
  _org uuid, _from date, _to date, _agent uuid default null
)
returns table (
  agent_id uuid, day date, login_at timestamptz, logout_at timestamptz,
  work_secs bigint, idle_secs bigint, calls bigint, new_dials bigint, connected_calls bigint,
  clean_calls bigint, registrations bigint, activations bigint, talk_secs bigint
)
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select l.id, l.agent_id, l.contact_id, l.started_at, l.answered_at, l.call_duration, l.disposition_id,
           row_number() over (partition by l.contact_id order by l.started_at) as nth
    from call_logs l
    where l.org_id = _org and l.started_at is not null and l.caller_type = 'human'
  ),
  c as (
    select r.agent_id,
           (r.started_at at time zone 'Asia/Kolkata')::date as day,
           r.started_at,
           r.started_at + make_interval(secs => coalesce(r.call_duration, 0)) as ended,
           coalesce(r.call_duration, 0) as dur,
           (r.nth = 1) as is_new,
           (r.answered_at is not null) as answered,
           d.name as dname
    from ranked r
    left join call_dispositions d on d.id = r.disposition_id
    where r.agent_id is not null
      and (_agent is null or r.agent_id = _agent)
      and r.started_at >= (_from::timestamp at time zone 'Asia/Kolkata')
      and r.started_at <  ((_to + 1)::timestamp at time zone 'Asia/Kolkata')
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
           count(*) filter (where is_new) as new_dials,
           count(*) filter (where answered) as connected_calls,
           count(*) filter (where dur >= 60) as clean_calls,
           count(*) filter (where dname = 'Registered') as registrations,
           count(*) filter (where dname = 'Activated') as activations,
           sum(dur) as talk_secs
    from g group by agent_id, day
  ),
  j as (
    select s.*, coalesce(a.sign_in_time, s.first_start) as login_at, coalesce(a.sign_out_time, s.last_end) as logout_at
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
         j.calls, j.new_dials, j.connected_calls, j.clean_calls, j.registrations, j.activations, j.talk_secs::bigint
  from j
  order by j.day, j.agent_id;
$$;

grant execute on function public.gaming_caller_day_stats(uuid, date, date, uuid) to authenticated;
