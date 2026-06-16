-- DPDP (Digital Personal Data Protection Act, 2023) compliance surface for globalcrm.
-- Ported from the vendor-empanelment implementation, mapped to globalcrm's model:
--   data principal      = a contact / lead (contacts table)
--   data fiduciary      = an organization (organizations)
--   org scoping + RLS   = get_user_org_id(auth.uid()) / is_platform_admin(auth.uid())
--                         / has_role(auth.uid(),'admin'::app_role)
-- ADD-ONLY: no existing table/column/policy is dropped or altered destructively.
-- PII encryption is NON-DESTRUCTIVE: encrypted twins are populated alongside the
-- existing plaintext columns (the live app + 62k+ shared contacts keep reading
-- plaintext); decryption flows through an audited SECURITY DEFINER RPC.

-- ---------------------------------------------------------------------------
-- 0. Crypto prerequisites (both already installed; guarded for portability)
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- PII encryption key in Supabase Vault (create once; never in code/logs).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'PII_ENCRYPTION_KEY') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'PII_ENCRYPTION_KEY',
      'AES-256 key for DPDP PII encryption (globalcrm)'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 1. encrypt / decrypt helpers (vault-keyed, SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.encrypt_pii(plaintext text)
returns bytea
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare k text;
begin
  if plaintext is null or plaintext = '' then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'PII_ENCRYPTION_KEY' limit 1;
  if k is null then raise exception 'PII_ENCRYPTION_KEY not found in vault'; end if;
  return extensions.pgp_sym_encrypt(plaintext, k);
end;
$$;

create or replace function public.decrypt_pii(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare k text;
begin
  if ciphertext is null then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'PII_ENCRYPTION_KEY' limit 1;
  if k is null then raise exception 'PII_ENCRYPTION_KEY not found in vault'; end if;
  return extensions.pgp_sym_decrypt(ciphertext, k);
end;
$$;

revoke all on function public.encrypt_pii(text) from public, anon, authenticated;
revoke all on function public.decrypt_pii(bytea) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Encrypted PII twins on contacts (PII subset only — not every column).
--    Plaintext columns are intentionally KEPT so live reads never break.
-- ---------------------------------------------------------------------------
alter table public.contacts add column if not exists email_encrypted bytea;
alter table public.contacts add column if not exists phone_encrypted bytea;

create or replace function public.encrypt_contact_pii()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  -- mirror plaintext PII into encrypted twins on write (non-destructive)
  if new.email is not null and new.email <> '' then
    new.email_encrypted := public.encrypt_pii(new.email);
  end if;
  if new.phone is not null and new.phone <> '' then
    new.phone_encrypted := public.encrypt_pii(new.phone);
  end if;
  return new;
end;
$$;

drop trigger if exists encrypt_contact_pii_trigger on public.contacts;
create trigger encrypt_contact_pii_trigger
  before insert or update of email, phone on public.contacts
  for each row execute function public.encrypt_contact_pii();

-- ---------------------------------------------------------------------------
-- 3. PII access audit log
-- ---------------------------------------------------------------------------
create table if not exists public.pii_access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  table_name text not null,
  column_name text not null,
  contact_id uuid,
  purpose text not null default 'display',
  accessed_at timestamptz not null default now()
);
alter table public.pii_access_log enable row level security;
create index if not exists idx_pii_access_log_org on public.pii_access_log(org_id);
create index if not exists idx_pii_access_log_time on public.pii_access_log(accessed_at desc);

drop policy if exists "admins view pii audit" on public.pii_access_log;
create policy "admins view pii audit" on public.pii_access_log for select to authenticated
  using (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)));
drop policy if exists "system inserts pii audit" on public.pii_access_log;
create policy "system inserts pii audit" on public.pii_access_log for insert to authenticated
  with check (true);

-- audited, authorized decryption of a contact's PII
create or replace function public.get_contact_decrypted(p_contact_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare caller uuid; c_org uuid; result json;
begin
  caller := auth.uid();
  select org_id into c_org from public.contacts where id = p_contact_id;
  if c_org is null then raise exception 'Contact not found'; end if;
  if not (is_platform_admin(caller) or c_org = get_user_org_id(caller)) then
    raise exception 'Unauthorized';
  end if;
  insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
    values (c_org, caller, 'contacts', 'email,phone', p_contact_id, 'data_principal_view');
  select json_build_object(
    'id', v.id,
    'email', coalesce(public.decrypt_pii(v.email_encrypted), v.email),
    'phone', coalesce(public.decrypt_pii(v.phone_encrypted), v.phone)
  ) into result from public.contacts v where v.id = p_contact_id;
  return result;
end;
$$;
grant execute on function public.get_contact_decrypted(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Consent records (per data principal)
-- ---------------------------------------------------------------------------
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  data_principal_identifier text not null,   -- email/phone captured at consent time
  consent_version text not null default '1.0',
  purpose text not null default 'sales_outreach',
  channels text[] not null default '{}',      -- e.g. {call,whatsapp,email}
  status text not null default 'granted',      -- granted | withdrawn
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  source text,                                 -- web_form | api | import | manual
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.consent_records enable row level security;
create index if not exists idx_consent_org on public.consent_records(org_id);
create index if not exists idx_consent_contact on public.consent_records(contact_id);

drop policy if exists "org reads consent" on public.consent_records;
create policy "org reads consent" on public.consent_records for select to authenticated
  using (is_platform_admin(auth.uid()) or org_id = get_user_org_id(auth.uid()));
drop policy if exists "admins manage consent" on public.consent_records;
create policy "admins manage consent" on public.consent_records for all to authenticated
  using (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)))
  with check (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)));
-- public/edge-function consent capture (service role bypasses RLS; this allows anon intake too)
drop policy if exists "consent insert via intake" on public.consent_records;
create policy "consent insert via intake" on public.consent_records for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 5. Data principal rights requests (access / correction / erasure / nomination)
-- ---------------------------------------------------------------------------
create table if not exists public.data_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  requester_identifier text not null,          -- email/phone of the data principal
  request_type text not null,                  -- access | correction | erasure | nomination
  status text not null default 'pending',      -- pending | in_progress | completed | rejected
  details text,
  due_date timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  handled_by uuid,
  admin_notes text,
  source text default 'public_portal',
  created_at timestamptz not null default now()
);
alter table public.data_requests enable row level security;
create index if not exists idx_data_requests_org on public.data_requests(org_id, status);
create index if not exists idx_data_requests_created on public.data_requests(created_at desc);

drop policy if exists "org reads data requests" on public.data_requests;
create policy "org reads data requests" on public.data_requests for select to authenticated
  using (is_platform_admin(auth.uid()) or org_id = get_user_org_id(auth.uid()));
drop policy if exists "admins manage data requests" on public.data_requests;
create policy "admins manage data requests" on public.data_requests for all to authenticated
  using (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)))
  with check (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)));
drop policy if exists "data request insert via portal" on public.data_requests;
create policy "data request insert via portal" on public.data_requests for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 6. Breach register (DPDP s.8(6))
-- ---------------------------------------------------------------------------
create table if not exists public.data_breach_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text not null,
  impact text not null,
  remedial_steps text not null,
  contact_info text not null,
  affected_count integer,
  triggered_by uuid,
  triggered_at timestamptz not null default now()
);
alter table public.data_breach_notifications enable row level security;
create index if not exists idx_breach_org on public.data_breach_notifications(org_id);

drop policy if exists "org reads breaches" on public.data_breach_notifications;
create policy "org reads breaches" on public.data_breach_notifications for select to authenticated
  using (is_platform_admin(auth.uid()) or org_id = get_user_org_id(auth.uid()));
drop policy if exists "admins manage breaches" on public.data_breach_notifications;
create policy "admins manage breaches" on public.data_breach_notifications for all to authenticated
  using (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)))
  with check (is_platform_admin(auth.uid())
         or (org_id = get_user_org_id(auth.uid()) and has_role(auth.uid(),'admin'::app_role)));

-- ---------------------------------------------------------------------------
-- 7. Org-level DPDP config (DPO contact, retention, privacy policy)
-- ---------------------------------------------------------------------------
alter table public.organization_settings add column if not exists dpo_name text;
alter table public.organization_settings add column if not exists dpo_email text;
alter table public.organization_settings add column if not exists dpo_phone text;
alter table public.organization_settings add column if not exists grievance_email text;
alter table public.organization_settings add column if not exists privacy_policy_url text;
alter table public.organization_settings add column if not exists data_retention_days integer not null default 2555; -- ~7 years

-- ---------------------------------------------------------------------------
-- 8. Erasure (anonymisation) of a data principal — admin only, audited
-- ---------------------------------------------------------------------------
create or replace function public.erase_contact_pii(p_contact_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare caller uuid; c_org uuid;
begin
  caller := auth.uid();
  select org_id into c_org from public.contacts where id = p_contact_id;
  if c_org is null then raise exception 'Contact not found'; end if;
  if not (is_platform_admin(caller)
          or (c_org = get_user_org_id(caller) and has_role(caller,'admin'::app_role))) then
    raise exception 'Only an org admin can erase personal data';
  end if;

  update public.contacts set
    first_name = 'Redacted', last_name = 'Contact',
    email = null, email_encrypted = null,
    phone = null, phone_encrypted = null,
    address = null, city = null, state = null, postal_code = null,
    linkedin_url = null, twitter_url = null, github_url = null, facebook_url = null,
    photo_url = null, headline = null, person_locations = null,
    employment_history = null, education = null, phone_numbers = null,
    notes = '[erased on data-principal request]',
    do_not_call = true, do_not_email = true, do_not_whatsapp = true,
    opted_out = true, opt_out_reason = 'dpdp_erasure', opt_out_at = now(),
    updated_at = now()
  where id = p_contact_id;

  insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
    values (c_org, caller, 'contacts', 'all_pii', p_contact_id, 'erasure');

  if p_request_id is not null then
    update public.data_requests
      set status = 'completed', completed_at = now(), handled_by = caller
      where id = p_request_id and org_id = c_org;
  end if;

  return jsonb_build_object('contact_id', p_contact_id, 'erased', true);
end;
$$;
grant execute on function public.erase_contact_pii(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Retention sweep helper (invoked by a Cloudflare cron worker; no pg_cron)
--    Anonymises contacts whose last activity is older than the org's retention
--    window. Returns the count touched. Platform/service-role invocation.
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_expired_contacts(p_org_id uuid, p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare retention_days integer; n integer := 0; rec record;
begin
  select coalesce(data_retention_days, 2555) into retention_days
    from public.organization_settings where org_id = p_org_id;
  if retention_days is null then retention_days := 2555; end if;

  for rec in
    select id from public.contacts
    where org_id = p_org_id
      and opted_out is not true
      and coalesce(updated_at, created_at) < now() - make_interval(days => retention_days)
    limit p_limit
  loop
    update public.contacts set
      first_name = 'Redacted', last_name = 'Contact',
      email = null, email_encrypted = null, phone = null, phone_encrypted = null,
      notes = '[anonymised: retention period elapsed]',
      opted_out = true, opt_out_reason = 'dpdp_retention', opt_out_at = now(), updated_at = now()
    where id = rec.id;
    insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
      values (p_org_id, null, 'contacts', 'all_pii', rec.id, 'retention_anonymise');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.anonymize_expired_contacts(uuid, integer) from public, anon, authenticated;
