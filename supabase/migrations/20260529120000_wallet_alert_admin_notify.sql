-- Platform feature: notify the org admin (WhatsApp + email) when the wallet runs
-- low, and again when it is exhausted and the portal halts. Applies to every org;
-- the scheduled sweep (edge fn wallet-alert-check, on its own cron worker) reads
-- these columns. Failure-only by design: one alert per threshold crossing, never
-- repeated each tick (see [[feedback_failure_only_alerts]] spirit).
--
--   wallet_alert_level        — current alert state: 'none' | 'low' | 'exhausted'.
--                               Re-arms automatically when the balance recovers.
--   wallet_alert_sent_at      — when the current-level alert was last sent.
--   wallet_low_alert_threshold— balance at/below which the LOW warning fires
--                               (default ₹5000). Exhausted fires at <= wallet_minimum_balance.

alter table public.organization_subscriptions
  add column if not exists wallet_alert_level text not null default 'none',
  add column if not exists wallet_alert_sent_at timestamptz,
  add column if not exists wallet_low_alert_threshold numeric not null default 5000;

-- Seed existing orgs to their CURRENT level so the first sweep does not
-- retroactively blast admins for balances that were already low/empty before this
-- feature existed. IEDUP is deliberately left at 'none' so its exhausted alert
-- (the originating request) fires on the next sweep. Only orgs that actually use
-- the wallet are seeded; pristine 0/0 orgs stay 'none' (the sweep ignores them).
update public.organization_subscriptions s
set wallet_alert_level = case
      when coalesce(s.wallet_balance,0) <= coalesce(s.wallet_minimum_balance,0) then 'exhausted'
      when coalesce(s.wallet_balance,0) <= coalesce(s.wallet_low_alert_threshold,5000) then 'low'
      else 'none'
    end,
    wallet_alert_sent_at = now()
where s.org_id <> '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d'
  and (
    coalesce(s.wallet_minimum_balance,0) > 0
    or coalesce(s.wallet_balance,0) <> 0
    or exists (select 1 from public.wallet_transactions wt where wt.org_id = s.org_id)
  );
