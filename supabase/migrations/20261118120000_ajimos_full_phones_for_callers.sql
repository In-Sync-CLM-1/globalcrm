-- Ajimos only: callers, the calling manager and admins see full phone numbers (TASK-0005).
-- Switched on per organisation by organizations.settings.pii_protection.full_phone_view = true.
-- Every other organisation keeps today's behaviour (the switch is off and the functions return nothing).
-- Callers get only the contacts assigned to them; admins, super admins and sales (calling) managers get
-- every contact of their own organisation. Each view is written to pii_access_log.

update public.organizations
   set settings = coalesce(settings, '{}'::jsonb)
     || jsonb_build_object('pii_protection', coalesce(settings -> 'pii_protection', '{}'::jsonb) || '{"full_phone_view": true}'::jsonb)
 where slug = 'ajimos';

create or replace function public.full_phone_view_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (o.settings -> 'pii_protection' ->> 'full_phone_view')::boolean
                     from public.organizations o where o.id = public.get_user_org_id(auth.uid())), false)
$$;

-- Full phone numbers (primary contact phone and the contact's extra phones) for contacts the caller may see.
create or replace function public.view_contact_phones(_ids uuid[])
returns table (contact_id uuid, phone text, is_contact_phone boolean, is_primary boolean, phone_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare _org uuid; _all boolean; _ok uuid[];
begin
  _org := public.get_user_org_id(auth.uid());
  if _org is null or not public.full_phone_view_enabled() then return; end if;
  if coalesce(array_length(_ids, 1), 0) > 500 then raise exception 'View at most 500 contacts at a time'; end if;
  _all := public.has_role(auth.uid(), 'admin'::app_role)
       or public.has_role(auth.uid(), 'super_admin'::app_role)
       or public.has_role(auth.uid(), 'sales_manager'::app_role);

  select coalesce(array_agg(c.id), '{}') into _ok from public.contacts c
   where c.id = any(_ids) and c.org_id = _org and (_all or c.assigned_to = auth.uid());

  insert into public.pii_access_log (org_id, user_id, table_name, column_name, contact_id, purpose)
    select _org, auth.uid(), 'contacts', 'phone', k, 'caller_view' from unnest(_ok) k;

  return query
    select c.id, coalesce(public.decrypt_pii(c.phone_encrypted), c.phone), true, false, null::uuid
      from public.contacts c where c.id = any(_ok)
    union all
    select p.contact_id, coalesce(public.decrypt_pii(p.phone_encrypted), p.phone), false, coalesce(p.is_primary, false), p.id
      from public.contact_phones p where p.contact_id = any(_ok);
end $$;

revoke all on function public.full_phone_view_enabled() from public, anon;
revoke all on function public.view_contact_phones(uuid[]) from public, anon;
grant execute on function public.full_phone_view_enabled(), public.view_contact_phones(uuid[]) to authenticated, service_role;
