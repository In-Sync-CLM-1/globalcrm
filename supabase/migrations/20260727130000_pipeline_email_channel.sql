-- Add an "email" channel to the stage-driven action automation, alongside the
-- existing call/whatsapp channels. Channel configuration moves from a bare
-- template_name string to a real FK into each channel's template registry
-- (communication_templates for WhatsApp, email_templates for email) so the
-- admin UI can show only approved/active templates with a live preview.
-- template_name/language_code stay in place as a legacy fallback for the
-- WhatsApp rows already wired by hand — nothing existing breaks.

-- 1. Widen the channel check + add template FK columns -----------------------
alter table public.pipeline_stage_actions
  drop constraint if exists pipeline_stage_actions_action_type_check;
alter table public.pipeline_stage_actions
  add constraint pipeline_stage_actions_action_type_check
  check (action_type in ('call', 'whatsapp', 'email'));

alter table public.pipeline_stage_actions
  add column if not exists whatsapp_template_id uuid references public.communication_templates(id) on delete set null,
  add column if not exists email_template_id uuid references public.email_templates(id) on delete set null;

alter table public.pipeline_action_queue
  drop constraint if exists pipeline_action_queue_action_type_check;
alter table public.pipeline_action_queue
  add constraint pipeline_action_queue_action_type_check
  check (action_type in ('call', 'whatsapp', 'email'));

alter table public.pipeline_action_queue
  add column if not exists email_template_id uuid references public.email_templates(id) on delete set null;

-- 2. Propagate email_template_id through the enqueue trigger -----------------
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

  insert into public.pipeline_action_queue
    (org_id, contact_id, stage_id, action_type, template_name, language_code, email_template_id)
  values
    (NEW.org_id, NEW.id, NEW.pipeline_stage_id, act.action_type, act.template_name, act.language_code, act.email_template_id)
  on conflict (contact_id, stage_id) where status = 'pending' do nothing;

  return NEW;
end;
$$;

-- 3. Email send log — mirrors whatsapp_logs so the dispatcher, dashboard and
--    wallet billing follow the same shape for the new channel.
create table if not exists public.pipeline_email_log (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  contact_id       uuid references public.contacts(id) on delete set null,
  email_template_id uuid references public.email_templates(id) on delete set null,
  to_email         text not null,
  subject          text,
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error_text       text,
  cost_charged     numeric,
  resend_message_id text,
  sent_at          timestamptz,
  failed_at        timestamptz,
  created_at       timestamptz not null default now()
);
alter table public.pipeline_email_log enable row level security;

create index if not exists idx_pipeline_email_log_org_created on public.pipeline_email_log (org_id, created_at desc);

drop policy if exists "Users can view email log in their org" on public.pipeline_email_log;
create policy "Users can view email log in their org"
  on public.pipeline_email_log for select
  using (org_id = get_user_org_id(auth.uid()));

drop policy if exists "Service role has full access to pipeline_email_log" on public.pipeline_email_log;
create policy "Service role has full access to pipeline_email_log"
  on public.pipeline_email_log for all
  using (auth.jwt()->>'role' = 'service_role')
  with check (auth.jwt()->>'role' = 'service_role');
