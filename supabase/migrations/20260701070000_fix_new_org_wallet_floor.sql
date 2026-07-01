-- Bug: create_organization_for_user() set wallet_minimum_balance equal to the
-- initial wallet_balance (5000 = 5000), which is_org_locked() treats as an
-- instant lockout (balance <= minimum) for every brand-new signup, before the
-- org has done anything. The floor should be the platform's configured
-- reserve (subscription_pricing.min_wallet_balance, currently ₹500), not the
-- trial credit amount itself.
CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid,
  p_org_name text,
  p_org_slug text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_unique_slug text;
  v_per_user_cost NUMERIC;
  v_min_wallet_balance NUMERIC;
BEGIN
  v_unique_slug := generate_unique_slug(p_org_slug);

  INSERT INTO public.organizations (name, slug)
  VALUES (p_org_name, v_unique_slug)
  RETURNING id INTO v_org_id;

  UPDATE public.profiles
  SET org_id = v_org_id
  WHERE id = p_user_id;

  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (p_user_id, v_org_id, 'admin');

  SELECT per_user_monthly_cost, min_wallet_balance
  INTO v_per_user_cost, v_min_wallet_balance
  FROM subscription_pricing
  WHERE is_active = true
  LIMIT 1;

  -- Create initial subscription with 5000 wallet balance (trial credit) for new orgs
  INSERT INTO public.organization_subscriptions (
    org_id,
    subscription_status,
    billing_cycle_start,
    next_billing_date,
    user_count,
    monthly_subscription_amount,
    wallet_balance,
    wallet_minimum_balance,
    wallet_auto_topup_enabled
  ) VALUES (
    v_org_id,
    'active',
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '1 month',
    1,
    COALESCE(v_per_user_cost, 500),
    5000,
    COALESCE(v_min_wallet_balance, 500),
    true
  );

  PERFORM create_default_pipeline_stages(v_org_id);
  PERFORM create_default_call_dispositions(v_org_id);

  RETURN v_org_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Organization name or URL is already taken';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create organization: %', SQLERRM;
END;
$$;

-- Repair existing orgs already caught by the bug: any non-internal org whose
-- wallet_minimum_balance was set equal to its starting 5000 trial balance
-- (i.e. never adjusted from the buggy default) gets the correct ₹500 floor.
UPDATE public.organization_subscriptions s
SET wallet_minimum_balance = COALESCE(
  (SELECT min_wallet_balance FROM public.subscription_pricing WHERE is_active = true LIMIT 1),
  500
)
FROM public.organizations o
WHERE o.id = s.org_id
  AND coalesce(o.is_internal, false) = false
  AND s.wallet_minimum_balance = 5000
  AND s.last_payment_date IS NULL;
