-- Website chatbot (TASK-0040): one row per visitor chat on in-sync.co.in.
-- Written only by the web-chat function (service role). Read by members of the
-- organisation the website routes to (In-Sync Demo); other organisations see nothing.
create table if not exists public.web_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id text not null unique,
  language text,                          -- language the visitor wrote in, e.g. "Hindi"
  ui_language text,                       -- en / hi labels chosen in the window
  start_page text,
  last_page text,
  transcript jsonb not null default '[]'::jsonb,  -- [{role, content, at}]
  message_count int not null default 0,
  is_anonymous boolean not null default true,      -- false once contact details are given
  contact_id uuid references public.contacts(id) on delete set null,  -- the order (lead), if placed
  order_count int not null default 0,
  ip text,
  user_agent text,
  turnstile_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists web_chat_conversations_org_created_idx on public.web_chat_conversations (org_id, created_at desc);
create index if not exists web_chat_conversations_ip_created_idx on public.web_chat_conversations (ip, created_at desc);

alter table public.web_chat_conversations enable row level security;

drop policy if exists "Org members read their website chats" on public.web_chat_conversations;
create policy "Org members read their website chats" on public.web_chat_conversations
  for select to authenticated
  using (org_id = public.get_user_org_id(auth.uid()));

revoke insert, update, delete on public.web_chat_conversations from anon, authenticated;
