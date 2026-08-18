-- Auto-assign newly created/uploaded contacts to whoever created them,
-- for orgs that opt in via organization_settings.auto_assign_to_creator.
-- ============================================================
-- Requested for RMPL (Redefine) only: a contact a user manually adds, or
-- a row that lands via bulk import (process-bulk-import sets created_by =
-- the uploader but never touches assigned_to), should default to that
-- same user as the owner instead of sitting unassigned.
--
-- Implemented as a single BEFORE INSERT trigger on contacts, gated per-org,
-- rather than editing every creation path (dialog / QuickDial / external-
-- entity convert / bulk import) individually -- a new creation path added
-- later gets this for free, and other orgs' unassigned-pool workflows are
-- untouched since the flag defaults to false.
-- ============================================================

alter table public.organization_settings
  add column if not exists auto_assign_to_creator boolean not null default false;

create or replace function public.assign_new_contact_to_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is null
     and new.created_by is not null
     and exists (
       select 1 from public.organization_settings os
       where os.org_id = new.org_id and os.auto_assign_to_creator
     )
  then
    new.assigned_to := new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_new_contact_to_creator on public.contacts;
create trigger trg_assign_new_contact_to_creator
  before insert on public.contacts
  for each row
  execute function public.assign_new_contact_to_creator();

-- Turn it on for RMPL (Redefine).
insert into public.organization_settings (org_id, auto_assign_to_creator)
values ('9b3528ad-8946-4f31-a1ca-1c8d3d782fb9', true)
on conflict (org_id) do update set auto_assign_to_creator = true;
