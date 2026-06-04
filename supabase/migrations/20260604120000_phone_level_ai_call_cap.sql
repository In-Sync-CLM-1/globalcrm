-- Phone-level AI-call cap + dedup.
--
-- Incident (2026-06-03, In-Sync Demo / WorkSync "Riya" script, number
-- +91 98192 10379): two Riya AI calls were placed to the SAME line 1.4s apart; the
-- recipient merged the two incoming calls, and from then on each bot's transcriber
-- heard the OTHER bot as its "prospect". They held a full fake conversation with
-- each other and then looped "Goodbye!" back and forth for ~11.5 minutes (call_logs
-- 1cc8aa9a / 2b54d7f4, 652s + 648s). That one line was dialed 9 times in 18 minutes.
--
-- Three compounding root causes, all fixed here in get_ai_call_candidates:
--   (A) Every cap was keyed on contact_id, never on the phone number. The same
--       number on several duplicate contact rows (1.8k such rows in Demo, 4.3k in
--       IEDUP) each carried its own fresh 3-attempt / connected / once-per-day
--       budget. -> attempts now aggregate by the dialed line (last-10-digits).
--   (B) The candidate query only excluded contacts with a RECORDED attempt
--       (started_at set); it ignored rows still sitting 'queued'/'in_progress', so
--       a contact was re-queued every tick until its first call finished. -> exclude
--       any line already queued or mid-call (active_lines CTE).
--   (C) Even a never-touched number on two duplicate contacts was returned twice in
--       one batch, so both got queued and dialed. -> DISTINCT ON the line, so each
--       phone line is offered at most once per batch (best contact kept).
--
-- All aggregation is org-scoped (org_id = p_org) so one tenant's call history can
-- never suppress another tenant's dialing (multi-tenant isolation). For an org with
-- no duplicate phones the result is identical to before; the only behavioural delta
-- is that genuine duplicate lines now share one budget — the intended fix everywhere.

-- ---- Owner-routed variant (used by ai-bulk-call cron) -----------------------
CREATE OR REPLACE FUNCTION public.get_ai_call_candidates(p_org uuid, p_limit integer, p_owner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, phone text, company text, job_title text)
 LANGUAGE sql
 STABLE
AS $function$
  with phone_attempts as (
    -- attempts aggregated by the dialed line (last-10-digits), this org only
    select right(regexp_replace(coalesce(to_number,''),'\D','','g'),10) as d10,
           count(*) as n,
           count(*) filter (where coalesce(conversation_duration,0)>=5) as connected,
           max(started_at) as last_at
    from call_logs
    where caller_type='ai' and started_at is not null and org_id = p_org
      and length(regexp_replace(coalesce(to_number,''),'\D','','g')) >= 10
    group by 1
  ),
  active_lines as (
    -- lines already sitting in the queue or mid-call for this org (root cause B)
    select distinct right(regexp_replace(coalesce(to_number,''),'\D','','g'),10) as d10
    from call_logs
    where caller_type='ai' and org_id = p_org and status in ('queued','in_progress')
      and length(regexp_replace(coalesce(to_number,''),'\D','','g')) >= 10
  ),
  team_phones as (
    select distinct regexp_replace(coalesce(phone,''),'\D','','g') as d
    from profiles where org_id=p_org and phone is not null and phone<>''
  ),
  team_names as (
    select distinct lower(trim(coalesce(first_name,'')))||'|'||lower(trim(coalesce(last_name,''))) as full_name
    from profiles where org_id=p_org and coalesce(first_name,'')<>''
  ),
  eligible as (
    -- one row per contact that passes every gate, tagged with its dialed line + priority
    select distinct on (right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10))
           c.id, c.first_name, c.last_name, c.phone, c.company, c.job_title,
           a.n as _n, a.last_at as _last_at, c.created_at as _created
    from contacts c
    left join phone_attempts a on a.d10 = right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10)
    left join pipeline_stages ps on ps.id=c.pipeline_stage_id
    where c.org_id=p_org
      and c.phone is not null and c.phone<>''
      and coalesce(c.do_not_call,false)=false
      and coalesce(lower(ps.name),'') not in ('won','lost')
      -- never dial a contact whose stage is a non-call action (e.g. a WhatsApp stage)
      and not exists (
        select 1 from public.pipeline_stage_actions psa
        where psa.stage_id = c.pipeline_stage_id
          and psa.is_active = true
          and psa.action_type <> 'call'
      )
      -- today-only: when the org opts in, only contacts uploaded today (IST)
      and (
        not exists (select 1 from public.organization_settings os where os.org_id=p_org and os.act_today_only)
        or c.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      )
      -- hard wallet cap: when the org opts in, no candidates once the wallet is exhausted
      and (
        not exists (select 1 from public.organization_settings os where os.org_id=p_org and os.enforce_wallet_in_trial)
        or exists (
          select 1 from public.organization_subscriptions sub
          where sub.org_id=p_org
            and coalesce(sub.wallet_balance,0) > coalesce(sub.wallet_minimum_balance,0)
        )
      )
      -- phone-level caps (root cause A): stop once the line connected; <3 attempts; one per IST day
      and coalesce(a.connected,0)=0
      and coalesce(a.n,0)<3
      and (a.last_at is null or (a.last_at at time zone 'Asia/Kolkata')::date < (now() at time zone 'Asia/Kolkata')::date)
      -- not already queued or mid-call (root cause B)
      and right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10) not in (select d10 from active_lines)
      and right(regexp_replace(c.phone,'\D','','g'),10) not in (select right(d,10) from team_phones where length(d)>=10)
      and (lower(trim(coalesce(c.first_name,'')))||'|'||lower(trim(coalesce(c.last_name,'')))) not in (select full_name from team_names)
      and (p_owner is null or c.assigned_to = p_owner)
    -- DISTINCT ON keeps the best contact per line (root cause C)
    order by right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10),
             a.n nulls first, a.last_at nulls first, c.created_at desc, c.id
  )
  select id, first_name, last_name, phone, company, job_title
  from eligible
  order by _n nulls first, _last_at nulls first, _created desc, id
  limit p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ai_call_candidates(uuid, integer, uuid) TO service_role;

-- ---- 2-arg variant (kept in sync) -------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ai_call_candidates(p_org uuid, p_limit integer)
 RETURNS TABLE(id uuid, first_name text, last_name text, phone text, company text, job_title text)
 LANGUAGE sql
 STABLE
AS $function$
  with phone_attempts as (
    select right(regexp_replace(coalesce(to_number,''),'\D','','g'),10) as d10,
           count(*) as n,
           count(*) filter (where coalesce(conversation_duration,0)>=5) as connected,
           max(started_at) as last_at
    from call_logs
    where caller_type='ai' and started_at is not null and org_id = p_org
      and length(regexp_replace(coalesce(to_number,''),'\D','','g')) >= 10
    group by 1
  ),
  active_lines as (
    select distinct right(regexp_replace(coalesce(to_number,''),'\D','','g'),10) as d10
    from call_logs
    where caller_type='ai' and org_id = p_org and status in ('queued','in_progress')
      and length(regexp_replace(coalesce(to_number,''),'\D','','g')) >= 10
  ),
  team_phones as (
    select distinct regexp_replace(coalesce(phone,''),'\D','','g') as d
    from profiles where org_id=p_org and phone is not null and phone<>''
  ),
  team_names as (
    select distinct lower(trim(coalesce(first_name,'')))||'|'||lower(trim(coalesce(last_name,''))) as full_name
    from profiles where org_id=p_org and coalesce(first_name,'')<>''
  ),
  eligible as (
    select distinct on (right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10))
           c.id, c.first_name, c.last_name, c.phone, c.company, c.job_title,
           a.n as _n, a.last_at as _last_at, c.created_at as _created
    from contacts c
    left join phone_attempts a on a.d10 = right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10)
    left join pipeline_stages ps on ps.id=c.pipeline_stage_id
    where c.org_id=p_org
      and c.phone is not null and c.phone<>''
      and coalesce(c.do_not_call,false)=false
      and coalesce(lower(ps.name),'') not in ('won','lost')
      and not exists (
        select 1 from public.pipeline_stage_actions psa
        where psa.stage_id = c.pipeline_stage_id and psa.is_active = true and psa.action_type <> 'call'
      )
      and (
        not exists (select 1 from public.organization_settings os where os.org_id=p_org and os.act_today_only)
        or c.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      )
      and (
        not exists (select 1 from public.organization_settings os where os.org_id=p_org and os.enforce_wallet_in_trial)
        or exists (
          select 1 from public.organization_subscriptions sub
          where sub.org_id=p_org and coalesce(sub.wallet_balance,0) > coalesce(sub.wallet_minimum_balance,0)
        )
      )
      and coalesce(a.connected,0)=0
      and coalesce(a.n,0)<3
      and (a.last_at is null or (a.last_at at time zone 'Asia/Kolkata')::date < (now() at time zone 'Asia/Kolkata')::date)
      and right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10) not in (select d10 from active_lines)
      and right(regexp_replace(c.phone,'\D','','g'),10) not in (select right(d,10) from team_phones where length(d)>=10)
      and (lower(trim(coalesce(c.first_name,'')))||'|'||lower(trim(coalesce(c.last_name,'')))) not in (select full_name from team_names)
    order by right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10),
             a.n nulls first, a.last_at nulls first, c.created_at desc, c.id
  )
  select id, first_name, last_name, phone, company, job_title
  from eligible
  order by _n nulls first, _last_at nulls first, _created desc, id
  limit p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ai_call_candidates(uuid, integer) TO service_role;

-- ---- Eligibility stats: also phone-level ------------------------------------
-- Used by ai-bulk-call (enqueue + test_call) and the IEDUP pipeline UI. Returns
-- attempts/connected aggregated across every call to the contact's phone line
-- (org-scoped), so the 3-attempt / never-after-connected gates the callers apply
-- now reflect the whole line, not just that one contact row.
CREATE OR REPLACE FUNCTION public.contact_ai_call_stats(p_contact_ids uuid[])
RETURNS TABLE (contact_id uuid, attempts int, connected int)
LANGUAGE sql
STABLE
AS $$
  WITH targets AS (
    SELECT id AS contact_id, org_id,
           right(regexp_replace(coalesce(phone,''),'\D','','g'),10) AS d10
    FROM contacts
    WHERE id = ANY(p_contact_ids)
  )
  SELECT t.contact_id,
         count(cl.id)::int AS attempts,
         count(cl.id) FILTER (WHERE coalesce(cl.conversation_duration,0) >= 5)::int AS connected
  FROM targets t
  LEFT JOIN call_logs cl
    ON cl.caller_type = 'ai'
   AND cl.started_at IS NOT NULL
   AND cl.org_id = t.org_id
   AND length(t.d10) = 10
   AND right(regexp_replace(coalesce(cl.to_number,''),'\D','','g'),10) = t.d10
  GROUP BY t.contact_id;
$$;

GRANT EXECUTE ON FUNCTION public.contact_ai_call_stats(uuid[]) TO service_role, authenticated;
