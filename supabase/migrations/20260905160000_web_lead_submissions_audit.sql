-- Audit trail for every hit on web-lead-intake, not just the ones that become
-- a contact. Born from WorkSync's Google Ads landing page getting junk
-- conversions with no way to tell a blocked bot from a real lead that failed
-- for some other reason — this table is the answer: every submission is
-- logged with its IP, timestamp, and why it was or wasn't accepted, before
-- any other validation runs.
create table if not exists public.web_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text,
  source_url text,
  ip text,
  user_agent text,
  blocked boolean not null default false,
  block_reason text,           -- 'honeypot' | 'turnstile_failed' | null
  contact_id uuid references public.contacts(id) on delete set null
);
create index if not exists web_lead_submissions_created_at_idx on public.web_lead_submissions(created_at desc);
create index if not exists web_lead_submissions_blocked_idx on public.web_lead_submissions(blocked);
alter table public.web_lead_submissions enable row level security;
