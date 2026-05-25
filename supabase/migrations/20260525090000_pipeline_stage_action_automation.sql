-- Stage-driven action automation (window-gated).
-- When a contact lands on an "action stage", an action is queued; a cron
-- dispatcher fires it (AI call or WhatsApp template) ONLY inside the org's
-- saved calling window (organization_settings.calling_windows — configurable,
-- read live at dispatch time). Disposition auto-fills from call/WA progress.

-- 1. Config: which stages trigger which action --------------------------------
create table if not exists public.pipeline_stage_actions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  stage_id      uuid not null unique references public.pipeline_stages(id) on delete cascade,
  action_type   text not null check (action_type in ('call','whatsapp')),
  template_name text,                       -- WhatsApp template (null for calls)
  language_code text not null default 'hi',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.pipeline_stage_actions enable row level security;

-- 2. Queue of pending actions -------------------------------------------------
create table if not exists public.pipeline_action_queue (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  stage_id      uuid not null references public.pipeline_stages(id) on delete cascade,
  action_type   text not null check (action_type in ('call','whatsapp')),
  template_name text,
  language_code text not null default 'hi',
  status        text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts      int  not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
alter table public.pipeline_action_queue enable row level security;

create index if not exists idx_paq_pending on public.pipeline_action_queue (org_id, created_at) where status = 'pending';
-- one pending action per contact+stage (re-staging after completion re-fires)
create unique index if not exists uq_paq_pending on public.pipeline_action_queue (contact_id, stage_id) where status = 'pending';

-- 3. Enqueue trigger on contacts ----------------------------------------------
create or replace function public.fn_enqueue_pipeline_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare act record;
begin
  if NEW.pipeline_stage_id is null then
    return NEW;
  end if;
  -- only on insert, or when the stage actually changed
  if TG_OP = 'UPDATE' and NEW.pipeline_stage_id is not distinct from OLD.pipeline_stage_id then
    return NEW;
  end if;

  select * into act
  from public.pipeline_stage_actions
  where stage_id = NEW.pipeline_stage_id and is_active = true
  limit 1;

  if not found then
    return NEW;
  end if;

  insert into public.pipeline_action_queue (org_id, contact_id, stage_id, action_type, template_name, language_code)
  values (NEW.org_id, NEW.id, NEW.pipeline_stage_id, act.action_type, act.template_name, act.language_code)
  on conflict (contact_id, stage_id) where status = 'pending' do nothing;

  return NEW;
end;
$$;

drop trigger if exists trg_enqueue_pipeline_action on public.contacts;
create trigger trg_enqueue_pipeline_action
  after insert or update of pipeline_stage_id on public.contacts
  for each row execute function public.fn_enqueue_pipeline_action();

-- 4. Seed IEDUP's 6 action stages --------------------------------------------
insert into public.pipeline_stage_actions (org_id, stage_id, action_type, template_name, language_code)
select ps.org_id, ps.id,
  case when ps.name = 'Call' then 'call' else 'whatsapp' end,
  case ps.name
    when 'Send WhatsApp - After certificate' then 'iedup_cmyuva_certificate_ready_v1'
    when 'Send WhatsApp - After registration & payment verification' then 'iedup_cmyuva_registration_steps_v1'
    when 'Send WhatsApp - Payment failed' then 'iedup_cmyuva_payment_failed_v1'
    when 'Send WhatsApp - Add help desk number' then 'iedup_cmyuva_training_helpdesk_v1'
    when 'Send WhatsApp - Photo rejected' then 'iedup_cmyuva_photo_reupload_v1'
    else null
  end,
  'hi'
from public.pipeline_stages ps
where ps.org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'
  and ps.is_active = true
  and ps.name in (
    'Call',
    'Send WhatsApp - After certificate',
    'Send WhatsApp - After registration & payment verification',
    'Send WhatsApp - Payment failed',
    'Send WhatsApp - Add help desk number',
    'Send WhatsApp - Photo rejected'
  )
on conflict (stage_id) do update
  set action_type = excluded.action_type,
      template_name = excluded.template_name,
      language_code = excluded.language_code,
      is_active = true;

-- 5. Disposition view: surface WhatsApp progress alongside calls --------------
-- WhatsApp branch is scoped by INNER JOIN on call_dispositions name, so only
-- orgs that defined Message Sent/Delivered/Opened (i.e. IEDUP) are affected.
create or replace view public.contact_latest_disposition as
with events as (
  select cl.org_id, cl.contact_id, cl.id as call_log_id, cl.disposition_id,
         d.name as disposition_name, d.category as disposition_category,
         cl.created_at as dispositioned_at
  from public.call_logs cl
  join public.call_dispositions d on d.id = cl.disposition_id
  where cl.contact_id is not null and cl.disposition_id is not null

  union all

  select wm.org_id, wm.contact_id, null::uuid as call_log_id, d.id as disposition_id,
         d.name as disposition_name, d.category as disposition_category,
         coalesce(wm.read_at, wm.delivered_at, wm.sent_at, wm.created_at) as dispositioned_at
  from public.whatsapp_messages wm
  join public.call_dispositions d
    on d.org_id = wm.org_id
   and d.name = case wm.status
                  when 'read'      then 'Message Opened'
                  when 'delivered' then 'Message Delivered'
                  when 'sent'      then 'Message Sent'
                end
  where wm.contact_id is not null
    and wm.direction = 'outbound'
    and wm.status in ('sent','delivered','read')
)
select distinct on (contact_id)
  org_id, contact_id, call_log_id, disposition_id,
  disposition_name, disposition_category, dispositioned_at
from events
order by contact_id, dispositioned_at desc;

grant select on public.contact_latest_disposition to authenticated;

-- 6. Cron: run the dispatcher every 5 minutes (window check is inside the fn) --
select cron.unschedule('pipeline-action-dispatcher-5min')
where exists (select 1 from cron.job where jobname = 'pipeline-action-dispatcher-5min');

select cron.schedule(
  'pipeline-action-dispatcher-5min',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://ejzjrvazegaxrhqizgaa.supabase.co/functions/v1/pipeline-action-dispatcher',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
