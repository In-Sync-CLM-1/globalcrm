-- IEDUP moves from stage-driven automatic actions to raw, manually-fired
-- Channel + Template selections on each beneficiary. Stage changes no longer
-- trigger anything for IEDUP; every other org's stage automation (e.g.
-- In-Sync Demo's WorkSync qualify-call) is untouched.

-- 1. Raw channel/template values live directly on the contact -----------------
alter table public.contacts
  add column if not exists action_channel text,
  add column if not exists action_template text,
  add column if not exists action_fired_at timestamptz;

-- 2. pipeline_action_queue rows fired this way have no pipeline stage ---------
alter table public.pipeline_action_queue
  alter column stage_id drop not null;

-- 3. Stage-change trigger skips IEDUP; every other org unaffected -------------
create or replace function public.fn_enqueue_pipeline_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare act record;
begin
  if NEW.org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d' then
    return NEW;
  end if;

  if NEW.pipeline_stage_id is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.pipeline_stage_id is not distinct from OLD.pipeline_stage_id then
    return NEW;
  end if;

  select * into act
  from public.pipeline_stage_actions
  where stage_id = NEW.pipeline_stage_id and is_active = true
  limit 1;

  if not found then
    return NEW;
  end if;

  insert into public.pipeline_action_queue
    (org_id, contact_id, stage_id, action_type, template_name, language_code, email_template_id)
  values
    (NEW.org_id, NEW.id, NEW.pipeline_stage_id, act.action_type, act.template_name, act.language_code, act.email_template_id)
  on conflict (contact_id, stage_id) where status = 'pending' do nothing;

  return NEW;
end;
$$;
