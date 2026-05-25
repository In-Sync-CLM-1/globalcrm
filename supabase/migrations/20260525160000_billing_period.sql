-- Per-user subscription can be billed Quarterly or Annual (customer choice).
-- Track the chosen cadence so renewals/next-billing-date are computed correctly.
alter table public.organization_subscriptions
  add column if not exists billing_period text not null default 'quarterly';

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'organization_subscriptions' and constraint_name = 'organization_subscriptions_billing_period_chk'
  ) then
    alter table public.organization_subscriptions
      add constraint organization_subscriptions_billing_period_chk
      check (billing_period in ('monthly','quarterly','annual'));
  end if;
end $$;

-- Seat amount = users × per-user monthly rate. IEDUP's stored amount was stale (500);
-- recompute from the active per-user rate (₹799).
update public.organization_subscriptions s
set monthly_subscription_amount = greatest(s.user_count, 1)
  * coalesce((select per_user_monthly_cost from public.subscription_pricing where is_active = true limit 1), 799),
    updated_at = now()
where s.org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d';
