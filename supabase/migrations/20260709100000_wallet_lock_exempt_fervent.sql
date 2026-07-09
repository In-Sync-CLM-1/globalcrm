-- =============================================================================
-- WALLET-LOCK EXEMPTION (per-org opt-out of the wallet-floor app lock)
--
-- The wallet-floor lock (20260530150000_wallet_floor_app_lock.sql) fully locks
-- an external org out of the app once wallet_balance <= wallet_minimum_balance.
-- That rule assumes the org actually draws down its wallet for paid actions
-- (AI calls, WhatsApp, email, SMS).
--
-- Fervent Communication is a data-repository-only tenant (no dialer/WhatsApp
-- surface exposed to its users — see FerventDashboard / minimal nav) and isn't
-- expected to use any wallet-metered feature. Its wallet was seeded with a fake
-- ₹5,000 balance at org creation; correcting that to the real ₹0 on 2026-07-08
-- tripped the wallet floor and locked the account, even with 5 days left in its
-- free trial and subscription_status = 'active' (not overdue).
--
-- Fix: add a per-org exemption flag so an org can be excluded from the WALLET
-- portion of the lock while the SUBSCRIPTION-overdue portion still applies in
-- full — i.e. they can still be locked for non-payment, just never for an idle
-- wallet they don't use.
-- =============================================================================

alter table public.organization_subscriptions
  add column if not exists wallet_lock_exempt boolean not null default false;

update public.organization_subscriptions
  set wallet_lock_exempt = true, updated_at = now()
  where org_id = '6235726a-56f9-4851-9413-bc5cca39e90d'  -- Fervent Communication
    and wallet_lock_exempt = false;

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
      AND (
        -- non-payment of the subscription itself (> 2 days overdue)
        s.subscription_status IN ('suspended_locked', 'cancelled')
        -- OR the wallet has hit/breached its reserve floor, unless exempt
        OR (
          coalesce(s.wallet_lock_exempt, false) = false
          AND coalesce(s.wallet_balance, 0) <= coalesce(s.wallet_minimum_balance, 0)
        )
      )
  )
$$;
