-- Move ALL function-triggering crons off the flaky in-DB pg_net (which fails
-- DNS intermittently) onto dedicated Cloudflare cron Workers (one per cron, see
-- cron-worker/). This drops the remaining 17 pg_net jobs that POST to an edge
-- function. The 3 hot ones were already dropped in 20260526190000.
--
-- KEPT (these run pure SQL in-DB, no net.http_post, so pg_net's DNS issue does
-- not affect them): aggregate-automation-performance, check-inactive-contacts,
-- process-time-based-triggers, retry-failed-whatsapp-messages,
-- sync-platform-email-list-daily.
select cron.unschedule(jobname) from cron.job where jobname in (
  'ai-bolna-daily-insights',
  'ai-bolna-reconcile-daily',
  'ai-callback-dispatcher-5min',
  'ai-script-propose-daily',
  'automation-email-sender',
  'check-next-actions-every-5min',
  'daily-lead-scoring',
  'daily-payment-reminders',
  'daily-subscription-check',
  'demo-reminders-5min',
  'exotel-sync-call-logs-5min',
  'generate-coaching-plans',
  'migrate-recordings-to-r2',
  'monthly-invoice-generation',
  'process-operation-queue',
  'process-scheduled-messages-and-reminders',
  'transcribe-and-analyze-recordings'
);
