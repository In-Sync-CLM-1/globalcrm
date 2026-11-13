-- Capture the RMPL project number when a contact is moved to the WON stage.
-- ============================================================
-- Requested for RMPL (Redefine) only: Pulkit's new-client invoice incentive is
-- computed from RMPL project numbers, so the number must be recorded at the
-- moment the deal is won. Gated per-org (flag defaults to false), enforced in
-- the database so every path that changes a stage (drag, table dropdown, edit
-- dialog, bulk) is covered, not just the pipeline UI.
-- ============================================================

alter table public.organization_settings
  add column if not exists require_project_number_on_won boolean not null default false;

alter table public.contacts
  add column if not exists won_project_number text;

create or replace function public.enforce_project_number_on_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_won boolean;
begin
  if new.pipeline_stage_id is null
     or new.pipeline_stage_id is not distinct from old.pipeline_stage_id then
    return new;
  end if;

  select lower(btrim(ps.name)) = 'won' into v_is_won
  from public.pipeline_stages ps where ps.id = new.pipeline_stage_id;

  if not coalesce(v_is_won, false) then
    return new;
  end if;

  if not exists (
    select 1 from public.organization_settings os
    where os.org_id = new.org_id and os.require_project_number_on_won
  ) then
    return new;
  end if;

  new.won_project_number := upper(btrim(coalesce(new.won_project_number, '')));
  if new.won_project_number = '' then
    raise exception 'Enter the project number (e.g. RMPL-26-123) to move this contact to Won.';
  end if;
  if new.won_project_number !~ '^RMPL-[0-9]{2}-[0-9]+$' then
    raise exception 'Project number must look like RMPL-26-123.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_project_number_on_won on public.contacts;
create trigger trg_enforce_project_number_on_won
  before update of pipeline_stage_id on public.contacts
  for each row
  execute function public.enforce_project_number_on_won();

-- Turn it on for RMPL (Redefine).
insert into public.organization_settings (org_id, require_project_number_on_won)
values ('9b3528ad-8946-4f31-a1ca-1c8d3d782fb9', true)
on conflict (org_id) do update set require_project_number_on_won = true;
