-- =============================================================================
-- RESTORE FERVENT'S WALLET-LOCK EXEMPTION
--
-- 20260709100000_wallet_lock_exempt_fervent.sql set wallet_lock_exempt = true
-- for Fervent Communication. By 2026-07-26 the flag was back to false. Nothing
-- in this repo ever writes that column (the only writes are in that migration),
-- so it was flipped outside the codebase — most likely a direct edit. Restoring
-- it here rather than out-of-band so the intent is on the record.
--
-- WHY THE EXEMPTION IS CORRECT FOR THIS ORG
-- Fervent is billed ₹2,500/month for AI credits. That credit is BOUGHT TO BE
-- SPENT: the wallet is topped up at the start of the cycle and drawn down to
-- zero over the month, with the next month's dues invoiced in the following
-- cycle. The wallet-floor lock treats "balance at/below the floor" as
-- non-payment and locks the org out of the whole app — which for this
-- arrangement fires precisely when the client has used exactly what they paid
-- for. An exhausted monthly credit is normal consumption, not a default.
--
-- The SUBSCRIPTION-overdue half of the lock still applies in full: if Fervent
-- stops paying, an unpaid invoice past its due date locks the account as usual.
-- This exemption only stops an empty wallet, on its own, from doing so.
-- =============================================================================

update public.organization_subscriptions
  set wallet_lock_exempt = true,
      updated_at = now()
  where org_id = '6235726a-56f9-4851-9413-bc5cca39e90d'  -- Fervent Communication
    and wallet_lock_exempt = false;
