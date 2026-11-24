-- TASK-0165: IEDUP dashboard, messages by template and channel, whichever way they were sent (automatic, from RAMP, or from the CRM).
-- RAMP login codes go straight to WhatsApp and are not in whatsapp_logs; RAMP reports how many it sent per day here.
create table if not exists public.direct_message_counts (
  org_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  source text not null,
  channel text not null,
  template text not null,
  sent integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, day, source, channel, template)
);
alter table public.direct_message_counts enable row level security; -- read only through the function below; written by the service role
revoke all on public.direct_message_counts from anon, authenticated;

create or replace function public.get_iedup_message_table(p_org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1 as ok
    where auth.role() = 'service_role'
       or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.org_id = p_org or pr.is_platform_admin))
  ),
  wa as (
    select 'WhatsApp' as channel, coalesce(w.template_name, '(no template)') as template,
           count(*) filter (where w.status in ('sent','delivered','read')) as sent,
           count(*) filter (where w.status in ('delivered','read') or w.delivered_at is not null) as delivered,
           count(*) filter (where w.status = 'read' or w.read_at is not null) as opened,
           count(*) filter (where w.status = 'failed') as failed
    from whatsapp_logs w, allowed
    where w.org_id = p_org and w.created_at >= p_from and w.created_at <= p_to
    group by 2
  ),
  em_rows as (
    select case
             when t.name is not null then t.name
             -- the part that changes from message to message (class, date, course) is left off
             when e.subject ~ '^(New class|Today''s class|Class reminder|Class link is live|Your live class has started|Class cancelled|Class moved|Class update): ' then split_part(e.subject, ': ', 1)
             when e.subject like 'Thank you for applying to %' then 'Thank you for applying'
             else coalesce(nullif(trim(e.subject), ''), '(no subject)')
           end as template,
           (e.status = 'failed' or (e.status = 'sent' and coalesce(e.last_event, '') in ('failed','bounced','suppressed'))) as is_failed,
           e.status, e.last_event, e.delivered_at, e.opened_at
    from pipeline_email_log e
    cross join allowed
    left join email_templates t on t.id = e.email_template_id
    where e.org_id = p_org and e.created_at >= p_from and e.created_at <= p_to
  ),
  em as (
    select 'Email' as channel, template,
           count(*) filter (where status = 'sent' and not is_failed) as sent,
           count(*) filter (where not is_failed and (delivered_at is not null or last_event in ('delivered','opened','clicked'))) as delivered,
           count(*) filter (where not is_failed and (opened_at is not null or last_event in ('opened','clicked'))) as opened,
           count(*) filter (where is_failed) as failed
    from em_rows group by template
  ),
  direct as (
    select d.channel, d.template, sum(d.sent)::bigint as sent
    from direct_message_counts d, allowed
    where d.org_id = p_org and d.day >= (p_from at time zone 'Asia/Kolkata')::date and d.day <= (p_to at time zone 'Asia/Kolkata')::date
    group by 1, 2
  ),
  rows as (
    select channel, template, sent, delivered, opened, failed, true as tracked from wa
    union all select channel, template, sent, delivered, opened, failed, true from em
    union all select channel, template, sent, null, null, null, false from direct
  )
  select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'template', template, 'sent', sent, 'delivered', delivered, 'opened', opened, 'failed', failed, 'tracked', tracked)
                            order by sent desc, template), '[]'::jsonb)
  from rows where sent > 0 or coalesce(failed, 0) > 0;
$$;
revoke all on function public.get_iedup_message_table(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_iedup_message_table(uuid, timestamptz, timestamptz) to authenticated, service_role;
