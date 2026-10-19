-- AI calling on the in-house LiveKit stack (Exotel Voicebot -> bridge -> LiveKit agent).
-- Additive and org-gated: nothing here changes behaviour for an org until its
-- organizations.settings.ai_calling.enabled is true. Idempotent.

alter table public.call_logs add column if not exists room_name text;

-- Never two AI calls to the same contact at once (the DB is the real enforcement; the
-- application check is only the fast path with a clean message).
create unique index if not exists idx_call_logs_ai_one_active_per_contact
  on public.call_logs (contact_id)
  where caller_type = 'ai' and status in ('initiated', 'in-progress');

create table if not exists public.ai_call_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  script_id uuid not null references public.ai_call_scripts(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'calling', 'done', 'skipped', 'failed', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  call_log_id uuid references public.call_logs(id) on delete set null,
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_ai_call_queue_one_open_per_contact
  on public.ai_call_queue (contact_id) where status in ('pending', 'calling');
create index if not exists idx_ai_call_queue_due
  on public.ai_call_queue (org_id, status, next_attempt_at);

alter table public.ai_call_queue enable row level security;

drop policy if exists "Org members can view the AI call queue" on public.ai_call_queue;
create policy "Org members can view the AI call queue" on public.ai_call_queue
  for select to authenticated using (org_id = public.get_user_org_id(auth.uid()));
-- Writes happen only through the ai-call-* edge functions (service role).

-- Outcome -> sub-disposition, so an AI outcome can set both levels of the disposition.
alter table public.ai_outcome_disposition_map
  add column if not exists sub_disposition_id uuid references public.call_sub_dispositions(id) on delete set null;
