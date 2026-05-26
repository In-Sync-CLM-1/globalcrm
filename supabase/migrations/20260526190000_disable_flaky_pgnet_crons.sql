-- Stop relying on in-database pg_net for the high-frequency triggers.
-- pg_net intermittently fails DNS ("Couldn't resolve host name", ~98% of calls),
-- so these functions barely fired. They are now triggered every minute by an
-- external Cloudflare cron Worker (cron-worker/, deployed as "globalcrm-cron"),
-- which reaches the function URLs reliably from Cloudflare's edge.
--
-- Drop the pg_net cron jobs so they don't fail-spam net._http_response or
-- double-fire if pg_net later recovers. (ai-bulk-call's pg_net job never worked
-- anyway — that function is verify_jwt=true and the cron sent no auth → 401.)
select cron.unschedule('pipeline-action-dispatcher-5min')
  where exists (select 1 from cron.job where jobname = 'pipeline-action-dispatcher-5min');
select cron.unschedule('ai-bulk-call')
  where exists (select 1 from cron.job where jobname = 'ai-bulk-call');
select cron.unschedule('transliterate-pending-5min')
  where exists (select 1 from cron.job where jobname = 'transliterate-pending-5min');
