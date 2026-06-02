-- Atomic wallet reserve/refund for the "charge-before-send" billing model.
--
-- reserve_wallet_funds: debit the wallet by p_amount, but ONLY if the resulting
--   balance stays at/above p_floor. The conditional UPDATE row-locks the
--   subscription, so concurrent senders (dispatcher ticks + send-* functions all
--   draw one wallet) can never race the balance below the floor. Returns the new
--   balance, or NULL when the debit is refused (insufficient funds).
-- credit_wallet_funds: atomically add p_amount back (refund a failed send).
--
-- Pass a very low p_floor (e.g. -1e15) to treat the wallet as unlimited for
-- internal/demo orgs that are never blocked.

create or replace function public.reserve_wallet_funds(
  p_org uuid,
  p_amount numeric,
  p_floor numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  update organization_subscriptions
     set wallet_balance = wallet_balance - p_amount,
         updated_at = now()
   where org_id = p_org
     and wallet_balance - p_amount >= p_floor
  returning wallet_balance into new_balance;

  return new_balance; -- NULL when no row matched (would breach the floor)
end;
$$;

create or replace function public.credit_wallet_funds(
  p_org uuid,
  p_amount numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  update organization_subscriptions
     set wallet_balance = wallet_balance + p_amount,
         updated_at = now()
   where org_id = p_org
  returning wallet_balance into new_balance;

  return new_balance;
end;
$$;

revoke all on function public.reserve_wallet_funds(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.credit_wallet_funds(uuid, numeric) from public, anon, authenticated;
grant execute on function public.reserve_wallet_funds(uuid, numeric, numeric) to service_role;
grant execute on function public.credit_wallet_funds(uuid, numeric) to service_role;
