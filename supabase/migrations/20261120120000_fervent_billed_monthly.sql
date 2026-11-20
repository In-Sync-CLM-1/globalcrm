-- =============================================================================
-- "Billed monthly" organisations (organizations.settings.billing.mode =
-- 'monthly_postpaid'). Their AI usage is invoiced monthly and paid by bank
-- transfer, so there is no prepaid wallet: sends are not checked against or
-- deducted from the wallet, and an empty wallet never locks the account.
-- A locked/cancelled subscription (non-payment) still blocks as before.
-- Switched on for Fervent Communication only; every other org is unchanged.
-- =============================================================================

create or replace function public.org_billed_monthly(_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select o.settings -> 'billing' ->> 'mode' = 'monthly_postpaid'
       from public.organizations o where o.id = _org_id),
    false)
$$;
grant execute on function public.org_billed_monthly(uuid) to authenticated, service_role;

-- Lock rule: same as before, but the wallet-floor half is skipped for billed-monthly orgs.
create or replace function public.is_org_locked(_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_subscriptions s
    join public.organizations o on o.id = s.org_id
    where s.org_id = _org_id
      and coalesce(o.is_internal, false) = false
      and (
        s.subscription_status in ('suspended_locked', 'cancelled')
        or (
          coalesce(s.wallet_lock_exempt, false) = false
          and not public.org_billed_monthly(s.org_id)
          and coalesce(s.wallet_balance, 0) <= coalesce(s.wallet_minimum_balance, 0)
        )
      )
  )
$$;

-- Wallet deduction: a billed-monthly org is never charged to the wallet.
create or replace function public.deduct_from_wallet(
  _org_id uuid,
  _amount numeric,
  _service_type text,
  _reference_id uuid,
  _quantity numeric,
  _unit_cost numeric,
  _user_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  current_balance numeric;
  min_balance numeric;
  new_balance numeric;
  wallet_txn_id uuid;
begin
  if public.org_billed_monthly(_org_id) then
    insert into service_usage_logs (
      org_id, service_type, reference_id, user_id,
      quantity, cost, wallet_deducted, wallet_transaction_id
    ) values (
      _org_id, _service_type, _reference_id, _user_id,
      _quantity, _amount, false, null
    );
    return jsonb_build_object('success', true, 'billed_monthly', true);
  end if;

  select wallet_balance, wallet_minimum_balance into current_balance, min_balance
  from organization_subscriptions
  where org_id = _org_id
  for update;

  if current_balance - _amount < min_balance then
    return jsonb_build_object(
      'success', false,
      'error', 'insufficient_wallet_balance',
      'current_balance', current_balance,
      'min_balance', min_balance
    );
  end if;

  new_balance := current_balance - _amount;

  update organization_subscriptions
  set wallet_balance = new_balance,
      updated_at = now()
  where org_id = _org_id;

  insert into wallet_transactions (
    org_id, transaction_type, amount, balance_before, balance_after,
    reference_id, reference_type, quantity, unit_cost
  ) values (
    _org_id,
    case
      when _service_type = 'email' then 'deduction_email'
      when _service_type = 'whatsapp' then 'deduction_whatsapp'
      when _service_type = 'call' then 'deduction_call'
    end,
    -_amount, current_balance, new_balance,
    _reference_id, _service_type, _quantity, _unit_cost
  )
  returning id into wallet_txn_id;

  insert into service_usage_logs (
    org_id, service_type, reference_id, user_id,
    quantity, cost, wallet_deducted, wallet_transaction_id
  ) values (
    _org_id, _service_type, _reference_id, _user_id,
    _quantity, _amount, true, wallet_txn_id
  );

  return jsonb_build_object(
    'success', true,
    'new_balance', new_balance,
    'wallet_transaction_id', wallet_txn_id
  );
end;
$$;

-- Fervent Communication: switch on, correct the wallet. No-op if the org does not exist.
do $$
declare
  fervent constant uuid := '6235726a-56f9-4851-9413-bc5cca39e90d';
  bal numeric;
begin
  if not exists (select 1 from public.organizations where id = fervent) then
    return;
  end if;

  update public.organizations
     set settings = coalesce(settings, '{}'::jsonb)
       || jsonb_build_object('billing',
            coalesce(settings -> 'billing', '{}'::jsonb) || '{"mode": "monthly_postpaid"}'::jsonb)
   where id = fervent;

  select wallet_balance into bal
    from public.organization_subscriptions
   where org_id = fervent
   for update;

  -- Only correct once: skip if the wallet is already zero / already adjusted.
  if bal is not null and bal <> 0
     and not exists (
       select 1 from public.wallet_transactions
        where org_id = fervent and transaction_type = 'admin_adjustment'
          and description like 'Monthly AI bills for Jul 2026%'
     ) then
    insert into public.wallet_transactions
      (org_id, transaction_type, amount, balance_before, balance_after, description)
    values
      (fervent, 'admin_adjustment', -6598, bal, 0,
       'Monthly AI bills for Jul 2026 (Rs 2,500) and Oct 2026 (Rs 4,098) were recorded as wallet top-ups; consumed in those months. Fervent is billed monthly.');
    update public.organization_subscriptions
       set wallet_balance = 0, updated_at = now()
     where org_id = fervent;
  end if;
end $$;
