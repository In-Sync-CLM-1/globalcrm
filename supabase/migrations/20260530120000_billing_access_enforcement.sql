-- =============================================================================
-- BILLING ACCESS ENFORCEMENT (platform-wide policy)
--
-- Two automatic "no money, no service" gates for every EXTERNAL (client) org:
--
--   1. Wallet floor ₹500 — once the wallet drops to its minimum reserve, paid
--      actions (AI calls, WhatsApp, email, SMS) are refused. Enforced in the
--      dialer candidate query here, in the shared edge-function gate, and in
--      deduct_from_wallet (which already blocks below the floor).
--
--   2. Subscription overdue > 2 days → FULL ACCOUNT LOCKOUT. A locked org has
--      NO access to any of its data (reads AND writes) — only the billing/pay
--      screen remains reachable so they can pay and auto-restore.
--
-- Internal/demo orgs (organizations.is_internal = true) are never billed and
-- never gated. Platform admins always bypass the lock.
--
-- The lock is enforced at the DATA layer: get_user_org_id() — which nearly every
-- tenant table's RLS scopes through — returns NULL for a locked org, so every
-- tenant table yields zero rows and rejects every write in one place. The few
-- tables the pay screen needs are repointed to a lock-ignoring helper.
-- =============================================================================

-- 1. Internal-org flag -------------------------------------------------------
alter table public.organizations
  add column if not exists is_internal boolean not null default false;

-- In-Sync Demo is the internal/demo org — exempt from all billing enforcement.
update public.organizations
  set is_internal = true
  where id = '61f7f96d-e80c-4d9b-a765-8eb32bd3c70d';

-- 2. Wallet floor ₹500 for external orgs -------------------------------------
-- New subscriptions default to a ₹500 reserve; backfill existing external orgs
-- whose reserve is below ₹500. Internal orgs are left untouched.
alter table public.organization_subscriptions
  alter column wallet_minimum_balance set default 500;

update public.organization_subscriptions s
  set wallet_minimum_balance = 500,
      updated_at = now()
  from public.organizations o
  where o.id = s.org_id
    and o.is_internal = false
    and coalesce(s.wallet_minimum_balance, 0) < 500;

-- 3. Lock helpers ------------------------------------------------------------

-- Raw org lookup: the user's org_id, IGNORING the lock. Used only by the
-- billing/identity tables that must stay readable so a locked org can pay.
CREATE OR REPLACE FUNCTION public.get_user_org_id_unlocked(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;

-- True when an EXTERNAL org is fully locked for non-payment (>2 days overdue).
-- Internal orgs are never locked.
CREATE OR REPLACE FUNCTION public.is_org_locked(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_subscriptions s
    JOIN public.organizations o ON o.id = s.org_id
    WHERE s.org_id = _org_id
      AND coalesce(o.is_internal, false) = false
      AND s.subscription_status IN ('suspended_locked', 'cancelled')
  )
$$;

-- Lock-aware org lookup. Returns NULL when the caller's org is locked (and the
-- caller is not a platform admin), which cascades the lock to every tenant
-- table whose RLS scopes by get_user_org_id(auth.uid()).
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.org_id
  FROM public.profiles p
  WHERE p.id = _user_id
    AND (
      public.is_platform_admin(_user_id)
      OR NOT public.is_org_locked(p.org_id)
    )
  LIMIT 1
$$;

-- 4. Keep the billing/identity path reachable while locked -------------------

-- A user can always read their OWN profile (needed to bootstrap the app and
-- learn it is locked), independent of org lock state.
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

-- Organization row (name/branding shown on the pay screen).
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization"
  ON public.organizations FOR SELECT
  USING (id = public.get_user_org_id_unlocked(auth.uid()));

-- Subscription, invoices and payment history — the pay screen reads these.
DROP POLICY IF EXISTS "Users can view their org subscription" ON public.organization_subscriptions;
CREATE POLICY "Users can view their org subscription"
  ON public.organization_subscriptions FOR SELECT
  USING (org_id = public.get_user_org_id_unlocked(auth.uid()));

DROP POLICY IF EXISTS "Users can view their org invoices" ON public.subscription_invoices;
CREATE POLICY "Users can view their org invoices"
  ON public.subscription_invoices FOR SELECT
  USING (org_id = public.get_user_org_id_unlocked(auth.uid()));

DROP POLICY IF EXISTS "Users can view their org transactions" ON public.payment_transactions;
CREATE POLICY "Users can view their org transactions"
  ON public.payment_transactions FOR SELECT
  USING (org_id = public.get_user_org_id_unlocked(auth.uid()));

DROP POLICY IF EXISTS "Users can create transactions for their org" ON public.payment_transactions;
CREATE POLICY "Users can create transactions for their org"
  ON public.payment_transactions FOR INSERT
  WITH CHECK (org_id = public.get_user_org_id_unlocked(auth.uid()) AND initiated_by = auth.uid());

-- 5. Subscription status: 2-day grace, then full lockout ---------------------
CREATE OR REPLACE FUNCTION public.check_and_update_subscription_status(_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub RECORD;
  latest_invoice RECORD;
  days_overdue INT;
  new_status TEXT;
  is_internal BOOLEAN;
BEGIN
  -- Internal/demo orgs are never billed or locked.
  SELECT coalesce(o.is_internal, false) INTO is_internal
  FROM organizations o WHERE o.id = _org_id;
  IF is_internal THEN
    UPDATE organization_subscriptions
      SET subscription_status = 'active', suspension_date = NULL, suspension_reason = NULL, updated_at = NOW()
      WHERE org_id = _org_id AND subscription_status <> 'active';
    UPDATE organizations SET services_enabled = true WHERE id = _org_id AND services_enabled = false;
    RETURN;
  END IF;

  SELECT * INTO sub FROM organization_subscriptions WHERE org_id = _org_id;
  IF sub IS NULL THEN RETURN; END IF;

  -- Admin override extends grace.
  IF sub.suspension_override_until IS NOT NULL AND sub.suspension_override_until >= CURRENT_DATE THEN
    RETURN;
  END IF;

  -- Most overdue unpaid invoice.
  SELECT * INTO latest_invoice
  FROM subscription_invoices
  WHERE org_id = _org_id
    AND payment_status IN ('pending', 'overdue')
    AND due_date <= CURRENT_DATE
  ORDER BY due_date DESC
  LIMIT 1;

  -- No overdue invoice → ensure active.
  IF latest_invoice IS NULL THEN
    IF sub.subscription_status <> 'active' THEN
      UPDATE organization_subscriptions
        SET subscription_status = 'active', suspension_date = NULL, suspension_reason = NULL, updated_at = NOW()
        WHERE org_id = _org_id;
      UPDATE organizations SET services_enabled = true WHERE id = _org_id;
    END IF;
    RETURN;
  END IF;

  days_overdue := CURRENT_DATE - latest_invoice.due_date;

  -- Business rule: 2-day grace after the due date, then full lockout.
  --   0–2 days overdue → 'suspended_grace' (access retained, warning shown)
  --   3+ days overdue  → 'suspended_locked' (no access at all)
  IF days_overdue <= 2 THEN
    new_status := 'suspended_grace';
  ELSE
    new_status := 'suspended_locked';
  END IF;

  IF sub.subscription_status <> new_status THEN
    UPDATE organization_subscriptions
      SET subscription_status = new_status,
          suspension_date = CASE WHEN new_status <> 'active' THEN NOW() ELSE NULL END,
          suspension_reason = 'Payment overdue for invoice ' || latest_invoice.invoice_number,
          grace_period_end = latest_invoice.due_date + INTERVAL '2 days',
          lockout_date = latest_invoice.due_date + INTERVAL '3 days',
          updated_at = NOW()
      WHERE org_id = _org_id;

    -- services_enabled stays true during grace (full access), false once locked.
    UPDATE organizations
      SET services_enabled = (new_status = 'suspended_grace')
      WHERE id = _org_id;

    UPDATE subscription_invoices SET payment_status = 'overdue' WHERE id = latest_invoice.id;
  END IF;
END;
$$;

-- 6. Dialer candidate query: wallet floor for ALL external orgs --------------
-- (Previously gated only for orgs with enforce_wallet_in_trial=true.)

-- Owner-routed variant (used by ai-bulk-call cron).
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
    and coalesce(lower(ps.name),'') not in ('won','lost')
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
    -- wallet floor: external orgs need balance above their reserve; internal orgs are exempt
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

GRANT EXECUTE ON FUNCTION public.get_ai_call_candidates(uuid, integer, uuid) TO service_role;

-- 2-arg variant (kept in sync).
CREATE OR REPLACE FUNCTION public.get_ai_call_candidates(p_org uuid, p_limit integer)
 RETURNS TABLE(id uuid, first_name text, last_name text, phone text, company text, job_title text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH attempts AS (
    SELECT contact_id, count(*) AS n, max(started_at) AS last_at
    FROM call_logs WHERE caller_type = 'ai' AND started_at IS NOT NULL GROUP BY contact_id
  ),
  team_phones AS (
    SELECT DISTINCT regexp_replace(coalesce(phone, ''), '\D', '', 'g') AS d
    FROM profiles WHERE org_id = p_org AND phone IS NOT NULL AND phone <> ''
  ),
  team_names AS (
    SELECT DISTINCT lower(trim(coalesce(first_name, ''))) || '|' || lower(trim(coalesce(last_name, ''))) AS full_name
    FROM profiles WHERE org_id = p_org AND coalesce(first_name, '') <> ''
  )
  SELECT c.id, c.first_name, c.last_name, c.phone, c.company, c.job_title
  FROM contacts c
  LEFT JOIN attempts a ON a.contact_id = c.id
  LEFT JOIN pipeline_stages ps ON ps.id = c.pipeline_stage_id
  WHERE c.org_id = p_org
    AND c.phone IS NOT NULL AND c.phone <> ''
    AND coalesce(c.do_not_call, false) = false
    AND coalesce(lower(ps.name), '') NOT IN ('won', 'lost')
    AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_stage_actions psa
      WHERE psa.stage_id = c.pipeline_stage_id AND psa.is_active = true AND psa.action_type <> 'call'
    )
    AND (
      NOT EXISTS (SELECT 1 FROM public.organization_settings os WHERE os.org_id = p_org AND os.act_today_only)
      OR c.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    )
    AND (
      EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.is_internal)
      OR EXISTS (
        SELECT 1 FROM public.organization_subscriptions sub
        WHERE sub.org_id = p_org AND coalesce(sub.wallet_balance,0) > coalesce(sub.wallet_minimum_balance,0)
      )
    )
    AND coalesce(a.n, 0) < 3
    AND (a.last_at IS NULL OR (a.last_at AT TIME ZONE 'Asia/Kolkata')::date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) NOT IN (SELECT right(d, 10) FROM team_phones WHERE length(d) >= 10)
    AND (lower(trim(coalesce(c.first_name, ''))) || '|' || lower(trim(coalesce(c.last_name, '')))) NOT IN (SELECT full_name FROM team_names)
  ORDER BY a.n NULLS FIRST, a.last_at NULLS FIRST, c.created_at DESC, c.id
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ai_call_candidates(uuid, integer) TO service_role;
