-- IEDUP-only: allow small wallet recharges (₹500 / ₹1,000) below the
-- platform-wide ₹5,000 minimum.
--
-- Same org-scoped, opt-in pattern as act_today_only / enforce_wallet_in_trial:
-- a boolean switch that DEFAULTS FALSE, so every other org keeps the ₹5,000
-- floor enforced in create-razorpay-order. Only IEDUP is switched on.
--
-- When ON, the minimum wallet top-up for that org drops from ₹5,000 to ₹500.

alter table public.organization_settings
  add column if not exists allow_low_recharge boolean not null default false;

update public.organization_settings
  set allow_low_recharge = true,
      updated_at = now()
  where org_id = '6dcf4229-6902-4cd4-9c7f-2d6ed4a6045d';
