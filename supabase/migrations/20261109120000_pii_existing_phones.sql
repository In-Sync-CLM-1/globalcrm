-- Phone-based duplicate lookup for contact uploads (used by process-bulk-import
-- for orgs with import_cleanup on, whose files carry phones but no emails).
-- Matches on the last 10 digits; for PII-protected orgs contacts.phone is
-- masked, so match on the keyed hash instead.
create or replace function public.pii_existing_phones(_org uuid, _phones text[])
returns table (phone text, contact_id uuid, assigned_to uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p, c.id, c.assigned_to
  from unnest(_phones) p
  join lateral (
    select c.id, c.assigned_to from public.contacts c
    where c.org_id = _org
      and case when public.pii_protected(_org)
               then c.phone_hash = public.pii_hash('phone', p)
               else right(regexp_replace(c.phone, '\D', '', 'g'), 10) = right(regexp_replace(p, '\D', '', 'g'), 10)
          end
    order by c.created_at
    limit 1
  ) c on true
$$;

revoke all on function public.pii_existing_phones(uuid, text[]) from public, anon, authenticated;
grant execute on function public.pii_existing_phones(uuid, text[]) to service_role;
