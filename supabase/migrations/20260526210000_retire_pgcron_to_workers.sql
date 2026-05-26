-- Retire pg_cron entirely. The 5 remaining pure-SQL crons are moved to per-function
-- Cloudflare Workers (invoked via PostgREST RPC; see cron-worker/), and the 3 dead
-- cross-project pg_net triggers are disabled (they were flooding net._http_response
-- with NULL/timeout responses to migrated-away project URLs). One cron process: Workers.

-- No-arg wrapper so the Worker can invoke the daily aggregate via RPC (it takes a date arg).
create or replace function public.cron_aggregate_automation_performance() returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform aggregate_automation_performance_daily(current_date - 1);
end $$;

grant execute on function public.cron_aggregate_automation_performance() to service_role;
grant execute on function public.trigger_retry_failed_whatsapp() to service_role;
grant execute on function public.check_inactive_contacts() to service_role;
grant execute on function public.process_time_based_triggers() to service_role;
grant execute on function public.sync_platform_email_list() to service_role;

-- Unschedule the 5 remaining pg_cron jobs (now handled by Workers). Guarded so a
-- fresh clone where the job never existed still applies cleanly.
do $$
declare j text;
begin
  foreach j in array array[
    'retry-failed-whatsapp-messages','check-inactive-contacts',
    'process-time-based-triggers','aggregate-automation-performance','sync-platform-email-list-daily'
  ] loop
    begin perform cron.unschedule(j); exception when others then null; end;
  end loop;
end $$;

-- Disable the dead cross-project pg_net triggers (endpoints retired post-migration).
do $$
begin
  begin alter table public.contact_activities disable trigger automation_disposition_set; exception when others then null; end;
  begin alter table public.contacts disable trigger automation_assignment_changed; exception when others then null; end;
  begin alter table public.contacts disable trigger webhook_contacts_update; exception when others then null; end;
end $$;
