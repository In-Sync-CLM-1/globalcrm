-- Bring-your-own-key for PII protection: an org admin sets the encryption key from Data Protection > Encryption.
-- rotate_pii_key swaps the vault key AND re-encrypts every protected value (and recomputes the match hashes,
-- which are keyed too) in ONE transaction, so a failure leaves the old key and old data untouched.
-- get_pii_encryption_proof shows an admin real evidence (masked value, stored ciphertext, decrypt check)
-- without ever returning the plain number.

create or replace function public.rotate_pii_key(_new_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  old_k text; sid uuid; n_c int; n_p int; n_e int; n_l int; n_ce int; t record; k text; v text; off jsonb := '{}';
begin
  if auth.role() <> 'service_role' then raise exception 'rotate_pii_key is for the key-rotation function only'; end if;
  if _new_key is null or length(_new_key) < 16 then raise exception 'Encryption key must be at least 16 characters'; end if;
  select id, decrypted_secret into sid, old_k from vault.decrypted_secrets where name = 'PII_ENCRYPTION_KEY' limit 1;
  if sid is null then raise exception 'PII_ENCRYPTION_KEY not found in vault'; end if;
  if old_k = _new_key then raise exception 'That is already the current key'; end if;
  set local statement_timeout = 0;

  -- the plain columns only hold masked text; the row triggers must not run during a pure re-encrypt
  for t in select tgrelid::regclass::text as tbl, tgname from pg_trigger
           where not tgisinternal and tgenabled = 'O'
             and tgrelid in ('public.contacts'::regclass, 'public.contact_phones'::regclass, 'public.contact_emails'::regclass, 'public.call_logs'::regclass) loop
    execute format('alter table %s disable trigger %I', t.tbl, t.tgname);
    off := off || jsonb_build_object(t.tbl || '|' || t.tgname, t.tgname);
  end loop;

  perform vault.update_secret(sid, _new_key);

  update public.contacts set phone_encrypted = pgp_sym_encrypt(pgp_sym_decrypt(phone_encrypted, old_k), _new_key) where phone_encrypted is not null;
  get diagnostics n_c = row_count;
  update public.contacts set email_encrypted = pgp_sym_encrypt(pgp_sym_decrypt(email_encrypted, old_k), _new_key) where email_encrypted is not null;
  get diagnostics n_ce = row_count;
  update public.contact_phones set phone_encrypted = pgp_sym_encrypt(pgp_sym_decrypt(phone_encrypted, old_k), _new_key) where phone_encrypted is not null;
  get diagnostics n_p = row_count;
  update public.contact_emails set email_encrypted = pgp_sym_encrypt(pgp_sym_decrypt(email_encrypted, old_k), _new_key) where email_encrypted is not null;
  get diagnostics n_e = row_count;
  update public.call_logs set lead_number_encrypted = pgp_sym_encrypt(pgp_sym_decrypt(lead_number_encrypted, old_k), _new_key) where lead_number_encrypted is not null;
  get diagnostics n_l = row_count;

  -- keyed match hashes follow the key
  update public.contacts set phone_hash = public.pii_hash('phone', pgp_sym_decrypt(phone_encrypted, _new_key)) where phone_encrypted is not null;
  update public.contacts set email_hash = public.pii_hash('email', pgp_sym_decrypt(email_encrypted, _new_key)) where email_encrypted is not null;

  -- turn back on exactly the triggers that were on (a few call_logs webhook triggers are deliberately off)
  for k, v in select * from jsonb_each_text(off) loop
    execute format('alter table %s enable trigger %I', split_part(k, '|', 1), v);
  end loop;

  return jsonb_build_object('contacts', n_c + n_ce, 'contact_phones', n_p, 'contact_emails', n_e, 'call_logs', n_l);
end $$;
revoke all on function public.rotate_pii_key(text) from public, anon, authenticated;
grant execute on function public.rotate_pii_key(text) to service_role;

create or replace function public.pii_key_configured()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'PII_ENCRYPTION_KEY')
$$;
revoke all on function public.pii_key_configured() from public, anon;
grant execute on function public.pii_key_configured() to authenticated, service_role;

create or replace function public.get_pii_encryption_proof()
returns table(kind text, shown_in_app text, stored_ciphertext_hex text, ciphertext_bytes int, decrypts_correctly boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare org uuid; c record; ok boolean;
begin
  select p.org_id into org from public.profiles p where p.id = auth.uid();
  if org is null or not exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.org_id = org and r.is_active and r.role in ('admin', 'super_admin')) then
    raise exception 'Admins only';
  end if;
  select id, phone, phone_encrypted, phone_hash into c from public.contacts where org_id = org and phone_encrypted is not null order by created_at desc limit 1;
  if c.id is not null then
    begin ok := public.pii_hash('phone', public.decrypt_pii(c.phone_encrypted)) = c.phone_hash; exception when others then ok := false; end;
    kind := 'Phone number'; shown_in_app := c.phone; stored_ciphertext_hex := encode(c.phone_encrypted, 'hex'); ciphertext_bytes := octet_length(c.phone_encrypted); decrypts_correctly := ok; return next;
  end if;
  select id, email, email_encrypted, email_hash into c from public.contacts where org_id = org and email_encrypted is not null order by created_at desc limit 1;
  if c.id is not null then
    begin ok := public.pii_hash('email', public.decrypt_pii(c.email_encrypted)) = c.email_hash; exception when others then ok := false; end;
    kind := 'Email'; shown_in_app := c.email; stored_ciphertext_hex := encode(c.email_encrypted, 'hex'); ciphertext_bytes := octet_length(c.email_encrypted); decrypts_correctly := ok; return next;
  end if;
end $$;
revoke all on function public.get_pii_encryption_proof() from public, anon;
grant execute on function public.get_pii_encryption_proof() to authenticated;
