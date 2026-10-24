-- IEDUP dashboard: every figure is aggregated inside the database and returned as one
-- small JSON document, so the dashboard no longer downloads raw rows (the API caps a
-- response at 1000 rows, which silently under-counted busy periods).
create or replace function public.get_iedup_dashboard_stats(
  p_org  uuid,
  p_from timestamptz,
  p_to   timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1 as ok
    where auth.uid() is null
       or exists (select 1 from profiles pr
                  where pr.id = auth.uid() and (pr.org_id = p_org or pr.is_platform_admin))
  ),
  wa as (
    select w.* from whatsapp_logs w, allowed
    where w.org_id = p_org and w.created_at >= p_from and w.created_at <= p_to
  ),
  cl as (
    select c.* from call_logs c, allowed
    where c.org_id = p_org and c.caller_type = 'ai' and c.created_at >= p_from and c.created_at <= p_to
  ),
  em as (
    select e.* from pipeline_email_log e, allowed
    where e.org_id = p_org and e.created_at >= p_from and e.created_at <= p_to
  ),
  events as (
    select (coalesce(sent_at, created_at) at time zone 'Asia/Kolkata')::date d, 'wa_sent' k
      from wa where status in ('sent','delivered','read')
    union all
    select (coalesce(delivered_at, sent_at, created_at) at time zone 'Asia/Kolkata')::date, 'wa_delivered'
      from wa where status in ('delivered','read') or delivered_at is not null
    union all
    select (coalesce(read_at, sent_at, created_at) at time zone 'Asia/Kolkata')::date, 'wa_opened'
      from wa where status = 'read' or read_at is not null
    union all
    select (coalesce(started_at, created_at) at time zone 'Asia/Kolkata')::date, 'placed' from cl
    union all
    select (coalesce(started_at, created_at) at time zone 'Asia/Kolkata')::date, 'connected'
      from cl where coalesce(conversation_duration, 0) >= 5
    union all
    select (coalesce(sent_at, created_at) at time zone 'Asia/Kolkata')::date, 'email_sent'
      from em where status = 'sent'
    union all
    select (coalesce(failed_at, created_at) at time zone 'Asia/Kolkata')::date, 'email_failed'
      from em where status = 'failed'
  ),
  daily as (
    select d, jsonb_object_agg(k, n) as counts
    from (select d, k, count(*) n from events group by d, k) x
    group by d
  )
  select jsonb_build_object(
    'wa', (select jsonb_build_object(
        'sent',      count(*) filter (where status in ('sent','delivered','read')),
        'delivered', count(*) filter (where status in ('delivered','read') or delivered_at is not null),
        'opened',    count(*) filter (where status = 'read' or read_at is not null),
        'failed',    count(*) filter (where status = 'failed'),
        'cost',      coalesce(sum(cost_charged), 0)) from wa),
    'calls', (select jsonb_build_object(
        'placed',    count(*),
        'connected', count(*) filter (where coalesce(conversation_duration, 0) >= 5),
        'total_sec', coalesce(sum(conversation_duration), 0)) from cl),
    'email', (select jsonb_build_object(
        'sent',   count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status = 'failed'),
        'cost',   coalesce(sum(cost_charged), 0)) from em),
    'by_template', coalesce((select jsonb_agg(jsonb_build_object('template', template_name, 'sent', s, 'opened', o))
        from (select template_name,
                     count(*) filter (where status in ('sent','delivered','read')) s,
                     count(*) filter (where status = 'read' or read_at is not null) o
              from wa group by template_name) t), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d) || counts order by d) from daily), '[]'::jsonb)
  );
$$;

grant execute on function public.get_iedup_dashboard_stats(uuid, timestamptz, timestamptz) to authenticated, service_role;
