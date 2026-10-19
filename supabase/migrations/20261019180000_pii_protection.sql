-- PII protection for orgs that switch it on (organizations.settings.pii_protection.enabled = true).
--
-- Contact phone numbers and emails are kept ENCRYPTED (pgp_sym_encrypt, key in Supabase Vault). The plain
-- columns (contacts.phone / email, contact_phones.phone, contact_emails.email, the lead side of
-- call_logs.to_number / from_number) hold only MASKED text, so a browser, an API response or an export
-- never carries a real number. The real value is decrypted only:
--   * on the server (service role) when a call is placed or an email is sent, and
--   * for admins through reveal_contact_pii / reveal_contacts_pii, which write the pii_access_log.
-- Callers (agents) cannot decrypt anything: decrypt_pii is not executable by authenticated users and the
-- reveal functions check the admin role.
--
-- Orgs that have not switched it on keep today's behaviour exactly. Idempotent.

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function public.pii_protected(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (settings -> 'pii_protection' ->> 'enabled')::boolean from public.organizations where id = _org), false)
$$;

create or replace function public.pii_is_masked(_t text)
returns boolean language sql immutable as $$ select position('•' in coalesce(_t, '')) > 0 $$;

create or replace function public.pii_mask_phone(_t text)
returns text language plpgsql immutable as $$
declare d text; n int; cc text;
begin
  if _t is null or _t = '' then return _t; end if;
  d := regexp_replace(_t, '\D', '', 'g'); n := length(d);
  if n <= 3 then return repeat('•', n); end if;
  cc := case when left(btrim(_t), 1) = '+' and n > 10 then '+' || left(d, n - 10) || ' ' else '' end;
  return cc || repeat('•', greatest(3, least(n, 10) - 3)) || ' ' || right(d, 3);
end $$;

create or replace function public.pii_mask_email(_t text)
returns text language plpgsql immutable as $$
declare nm text; dm text;
begin
  if _t is null or _t = '' then return _t; end if;
  if position('@' in _t) = 0 then return repeat('•', least(length(_t), 6)); end if;
  nm := split_part(_t, '@', 1); dm := substr(_t, position('@' in _t) + 1);
  return left(nm, 1) || repeat('•', greatest(3, least(length(nm) - 1, 6))) || '@' || dm;
end $$;

-- Keyed hash so a lead can still be matched for duplicates without storing the number or email.
create or replace function public.pii_hash(_kind text, _v text)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare k text; norm text;
begin
  if _v is null or _v = '' then return null; end if;
  norm := case when _kind = 'phone' then right(regexp_replace(_v, '\D', '', 'g'), 10) else lower(btrim(_v)) end;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'PII_ENCRYPTION_KEY' limit 1;
  if k is null then raise exception 'PII_ENCRYPTION_KEY not found in vault'; end if;
  return encode(extensions.hmac(convert_to(norm, 'UTF8'), convert_to(k || ':index', 'UTF8'), 'sha256'), 'hex');
end $$;

create or replace function public.pii_scrub_json(j jsonb)
returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; o jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'object' then
    o := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if lower(k) in ('to', 'from', 'phone', 'mobile', 'number', 'customer_number', 'callto', 'callfrom') and jsonb_typeof(v) = 'string' then
        o := o || jsonb_build_object(k, public.pii_mask_phone(v #>> '{}'));
      elsif lower(k) = 'email' and jsonb_typeof(v) = 'string' then
        o := o || jsonb_build_object(k, public.pii_mask_email(v #>> '{}'));
      else
        o := o || jsonb_build_object(k, public.pii_scrub_json(v));
      end if;
    end loop;
    return o;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(public.pii_scrub_json(e)) from jsonb_array_elements(j) e), '[]'::jsonb);
  end if;
  return j;
end $$;

-- ── columns ──────────────────────────────────────────────────────────────────
alter table public.contacts add column if not exists phone_hash text;
alter table public.contacts add column if not exists email_hash text;
create index if not exists idx_contacts_org_phone_hash on public.contacts (org_id, phone_hash) where phone_hash is not null;
create index if not exists idx_contacts_org_email_hash on public.contacts (org_id, email_hash) where email_hash is not null;
alter table public.contact_phones add column if not exists phone_encrypted bytea;
alter table public.contact_emails add column if not exists email_encrypted bytea;
alter table public.call_logs add column if not exists lead_number_encrypted bytea;

-- ── contacts trigger (replaces the old mirror-only version) ─────────────────
create or replace function public.encrypt_contact_pii()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  if public.pii_protected(new.org_id) then
    -- email
    if new.email is not null and new.email <> '' then
      if not public.pii_is_masked(new.email) then
        new.email_encrypted := public.encrypt_pii(new.email);
        new.email_hash := public.pii_hash('email', new.email);
        new.email := public.pii_mask_email(new.email);
      elsif tg_op = 'UPDATE' then
        -- a masked value echoed back by a form must never overwrite the real, encrypted value
        new.email_encrypted := old.email_encrypted; new.email_hash := old.email_hash;
      end if;
    elsif tg_op = 'UPDATE' then
      new.email_encrypted := null; new.email_hash := null;
    end if;
    -- phone
    if new.phone is not null and new.phone <> '' then
      if not public.pii_is_masked(new.phone) then
        new.phone_encrypted := public.encrypt_pii(new.phone);
        new.phone_hash := public.pii_hash('phone', new.phone);
        new.phone := public.pii_mask_phone(new.phone);
      elsif tg_op = 'UPDATE' then
        new.phone_encrypted := old.phone_encrypted; new.phone_hash := old.phone_hash;
      end if;
    elsif tg_op = 'UPDATE' then
      new.phone_encrypted := null; new.phone_hash := null;
    end if;
    return new;
  end if;

  -- unchanged behaviour for every other org: mirror plaintext into the encrypted twins
  if new.email is not null and new.email <> '' then
    new.email_encrypted := public.encrypt_pii(new.email);
  end if;
  if new.phone is not null and new.phone <> '' then
    new.phone_encrypted := public.encrypt_pii(new.phone);
  end if;
  return new;
end $$;

-- ── secondary phone / email tables ──────────────────────────────────────────
create or replace function public.protect_contact_phones()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  if public.pii_protected(new.org_id) and new.phone is not null and new.phone <> '' then
    if not public.pii_is_masked(new.phone) then
      new.phone_encrypted := public.encrypt_pii(new.phone);
      new.phone := public.pii_mask_phone(new.phone);
    elsif tg_op = 'UPDATE' then
      new.phone_encrypted := old.phone_encrypted;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_contact_phones_trigger on public.contact_phones;
create trigger protect_contact_phones_trigger before insert or update of phone on public.contact_phones
  for each row execute function public.protect_contact_phones();

create or replace function public.protect_contact_emails()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  if public.pii_protected(new.org_id) and new.email is not null and new.email <> '' then
    if not public.pii_is_masked(new.email) then
      new.email_encrypted := public.encrypt_pii(new.email);
      new.email := public.pii_mask_email(new.email);
    elsif tg_op = 'UPDATE' then
      new.email_encrypted := old.email_encrypted;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_contact_emails_trigger on public.contact_emails;
create trigger protect_contact_emails_trigger before insert or update of email on public.contact_emails
  for each row execute function public.protect_contact_emails();

-- ── call logs: the lead's number ────────────────────────────────────────────
create or replace function public.protect_call_log_numbers()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  if public.pii_protected(new.org_id) then
    if new.call_type = 'inbound' then
      if new.from_number is not null and not public.pii_is_masked(new.from_number) then
        new.lead_number_encrypted := public.encrypt_pii(new.from_number);
        new.from_number := public.pii_mask_phone(new.from_number);
      end if;
    else
      if new.to_number is not null and not public.pii_is_masked(new.to_number) then
        new.lead_number_encrypted := public.encrypt_pii(new.to_number);
        new.to_number := public.pii_mask_phone(new.to_number);
      end if;
    end if;
    if new.exotel_raw_data is not null then new.exotel_raw_data := public.pii_scrub_json(new.exotel_raw_data); end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_call_log_numbers_trigger on public.call_logs;
create trigger protect_call_log_numbers_trigger before insert or update of to_number, from_number, exotel_raw_data on public.call_logs
  for each row execute function public.protect_call_log_numbers();

-- ── server-side resolvers (service role only) ───────────────────────────────
create or replace function public.pii_contact_phone(_contact_id uuid)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.decrypt_pii(c.phone_encrypted), c.phone) from public.contacts c where c.id = _contact_id
$$;
create or replace function public.pii_contact_email(_contact_id uuid)
returns text language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.decrypt_pii(c.email_encrypted), c.email) from public.contacts c where c.id = _contact_id
$$;
-- Which of these emails already exist as contacts of the org (works whether or not the org is protected).
create or replace function public.pii_existing_emails(_org uuid, _emails text[])
returns setof text language sql stable security definer set search_path = public, extensions as $$
  select e from unnest(_emails) e
  where exists (
    select 1 from public.contacts c where c.org_id = _org
      and case when public.pii_protected(_org) then c.email_hash = public.pii_hash('email', e) else lower(c.email) = lower(e) end
  )
$$;

revoke all on function public.pii_contact_phone(uuid) from public, anon, authenticated;
revoke all on function public.pii_contact_email(uuid) from public, anon, authenticated;
revoke all on function public.pii_existing_emails(uuid, text[]) from public, anon, authenticated;
revoke all on function public.pii_hash(text, text) from public, anon, authenticated;
grant execute on function public.pii_contact_phone(uuid), public.pii_contact_email(uuid), public.pii_existing_emails(uuid, text[]), public.pii_hash(text, text) to service_role;

-- ── admin reveal (audited) ──────────────────────────────────────────────────
create or replace function public.pii_caller_is_admin(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin(auth.uid())
      or (_org = public.get_user_org_id(auth.uid())
          and (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role)))
$$;

create or replace function public.reveal_contact_pii(_contact_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare c record;
begin
  select org_id, phone, email, phone_encrypted, email_encrypted into c from public.contacts where id = _contact_id;
  if not found then raise exception 'Contact not found'; end if;
  if not public.pii_caller_is_admin(c.org_id) then raise exception 'Only admins can reveal contact details'; end if;
  insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
    values (c.org_id, auth.uid(), 'contacts', 'email,phone', _contact_id, 'admin_reveal');
  return json_build_object('phone', coalesce(public.decrypt_pii(c.phone_encrypted), c.phone), 'email', coalesce(public.decrypt_pii(c.email_encrypted), c.email));
end $$;

create or replace function public.reveal_contacts_pii(_ids uuid[])
returns table (id uuid, phone text, email text) language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(array_length(_ids, 1), 0) > 200 then raise exception 'Reveal at most 200 contacts at a time'; end if;
  if exists (select 1 from public.contacts c where c.id = any(_ids) and not public.pii_caller_is_admin(c.org_id)) then
    raise exception 'Only admins can reveal contact details';
  end if;
  insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
    select c.org_id, auth.uid(), 'contacts', 'email,phone', c.id, 'admin_reveal' from public.contacts c where c.id = any(_ids);
  return query select c.id, coalesce(public.decrypt_pii(c.phone_encrypted), c.phone), coalesce(public.decrypt_pii(c.email_encrypted), c.email)
    from public.contacts c where c.id = any(_ids);
end $$;

-- The older single-contact decrypt now also refuses non-admins when the org is protected.
create or replace function public.get_contact_decrypted(p_contact_id uuid)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare caller uuid; c_org uuid; result json;
begin
  caller := auth.uid();
  select org_id into c_org from public.contacts where id = p_contact_id;
  if c_org is null then raise exception 'Contact not found'; end if;
  if not (public.is_platform_admin(caller) or c_org = public.get_user_org_id(caller)) then raise exception 'Unauthorized'; end if;
  if public.pii_protected(c_org) and not public.pii_caller_is_admin(c_org) then raise exception 'Only admins can reveal contact details'; end if;
  insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
    values (c_org, caller, 'contacts', 'email,phone', p_contact_id, 'data_principal_view');
  select json_build_object('id', v.id, 'email', coalesce(public.decrypt_pii(v.email_encrypted), v.email), 'phone', coalesce(public.decrypt_pii(v.phone_encrypted), v.phone))
    into result from public.contacts v where v.id = p_contact_id;
  return result;
end $$;

revoke all on function public.reveal_contact_pii(uuid) from public, anon;
revoke all on function public.reveal_contacts_pii(uuid[]) from public, anon;
revoke all on function public.get_contact_decrypted(uuid) from public, anon;
revoke all on function public.pii_caller_is_admin(uuid) from public, anon;
grant execute on function public.reveal_contact_pii(uuid), public.reveal_contacts_pii(uuid[]), public.get_contact_decrypted(uuid), public.pii_caller_is_admin(uuid) to authenticated, service_role;
