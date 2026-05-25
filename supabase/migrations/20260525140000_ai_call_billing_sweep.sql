-- Call billing was never deducting from the wallet: Bolna's terminal webhook
-- usually arrives WITHOUT a duration (finalized later by reconcile / exotel-sync),
-- so ai-bolna-webhook's billing branch was skipped and reconcile/sync don't bill.
-- ai-bolna-reconcile now runs a billing safety-net sweep (idempotent) scoped to
-- BILLABLE_CALL_ORG_IDS (IEDUP only for now). Run it every 30 min instead of
-- daily so wallet deductions are timely.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'ai-bolna-reconcile-daily'),
  schedule := '*/30 * * * *'
)
where exists (select 1 from cron.job where jobname = 'ai-bolna-reconcile-daily');
