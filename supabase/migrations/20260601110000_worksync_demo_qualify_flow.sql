-- Inbound WorkSync demo-request qualify-call flow.
-- A demo-request lead (from the website "Request a Demo" form) lands in a
-- dedicated "Demo Requested" stage, which triggers a prompt call from the
-- dedicated demo-confirm Bolna agent (warm qualify + book), feeding the existing
-- Demo Booked -> calendar/confirmation/reminder chain. Scoped to In-Sync Demo.

-- 1) Let a stage's call-action name a specific Bolna agent (else org default)
--    and a dedicated caller-ID number (else the standard +911169323462).
ALTER TABLE public.pipeline_stage_actions
  ADD COLUMN IF NOT EXISTS agent_id text,
  ADD COLUMN IF NOT EXISTS from_number text;

-- 2) Create the "Demo Requested" stage for In-Sync Demo (just after "New"),
--    shifting later stages down by one. No unique constraint on stage_order.
DO $$
DECLARE
  v_org uuid := '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';
  v_stage uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE org_id = v_org AND lower(name) = 'demo requested'
  ) THEN
    UPDATE public.pipeline_stages
      SET stage_order = stage_order + 1
      WHERE org_id = v_org AND stage_order >= 2;

    INSERT INTO public.pipeline_stages (id, org_id, name, description, stage_order, probability, color, is_active)
    VALUES (gen_random_uuid(), v_org, 'Demo Requested',
            'Inbound demo request from a product website — auto-called to qualify & book.',
            2, 25, '#8b5cf6', true)
    RETURNING id INTO v_stage;
  ELSE
    SELECT id INTO v_stage FROM public.pipeline_stages
      WHERE org_id = v_org AND lower(name) = 'demo requested' LIMIT 1;
  END IF;

  -- 3) Wire the qualify call: this stage fires a call from the dedicated
  --    WorkSync demo-confirm agent.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_stage_actions
    WHERE org_id = v_org AND stage_id = v_stage AND action_type = 'call'
  ) THEN
    INSERT INTO public.pipeline_stage_actions (id, org_id, stage_id, action_type, agent_id, is_active, created_at)
    VALUES (gen_random_uuid(), v_org, v_stage, 'call',
            '2407fa50-b600-46b2-bf96-9d0fd4f61ab9', true, now());
  END IF;
END $$;

-- 4) Keep the COLD dialer off "Demo Requested" leads (the demo-confirm agent
--    handles them via pipeline-action-dispatcher). Exclude the stage by name,
--    exactly like won/lost — IEDUP and others have no such stage, so unaffected.
CREATE OR REPLACE FUNCTION public.get_ai_call_candidates(p_org uuid, p_limit integer, p_owner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, phone text, company text, job_title text)
 LANGUAGE sql
 STABLE
AS $function$
  with attempts as (
    select contact_id, count(*) as n,
           count(*) filter (where coalesce(conversation_duration,0)>=5) as connected,
           max(started_at) as last_at
    from call_logs where caller_type='ai' and started_at is not null group by contact_id
  ),
  team_phones as (
    select distinct regexp_replace(coalesce(phone,''),'\D','','g') as d
    from profiles where org_id=p_org and phone is not null and phone<>''
  ),
  team_names as (
    select distinct lower(trim(coalesce(first_name,'')))||'|'||lower(trim(coalesce(last_name,''))) as full_name
    from profiles where org_id=p_org and coalesce(first_name,'')<>''
  )
  select c.id, c.first_name, c.last_name, c.phone, c.company, c.job_title
  from contacts c
  left join attempts a on a.contact_id=c.id
  left join pipeline_stages ps on ps.id=c.pipeline_stage_id
  where c.org_id=p_org
    and c.phone is not null and c.phone<>''
    and coalesce(c.do_not_call,false)=false
    and coalesce(lower(ps.name),'') not in ('won','lost','demo requested')
    and not exists (
      select 1 from public.pipeline_stage_actions psa
      where psa.stage_id = c.pipeline_stage_id
        and psa.is_active = true
        and psa.action_type <> 'call'
    )
    and (
      not exists (select 1 from public.organization_settings os where os.org_id=p_org and os.act_today_only)
      or c.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    )
    and (
      exists (select 1 from public.organizations o where o.id=p_org and o.is_internal)
      or exists (
        select 1 from public.organization_subscriptions sub
        where sub.org_id=p_org
          and coalesce(sub.wallet_balance,0) > coalesce(sub.wallet_minimum_balance,0)
      )
    )
    and coalesce(a.connected,0)=0
    and coalesce(a.n,0)<3
    and (a.last_at is null or (a.last_at at time zone 'Asia/Kolkata')::date < (now() at time zone 'Asia/Kolkata')::date)
    and right(regexp_replace(c.phone,'\D','','g'),10) not in (select right(d,10) from team_phones where length(d)>=10)
    and (lower(trim(coalesce(c.first_name,'')))||'|'||lower(trim(coalesce(c.last_name,'')))) not in (select full_name from team_names)
    and (p_owner is null or c.assigned_to = p_owner)
  order by a.n nulls first, a.last_at nulls first, c.created_at desc, c.id
  limit p_limit;
$function$;
