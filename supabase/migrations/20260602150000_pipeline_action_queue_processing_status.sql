-- Allow a 'processing' status on the pipeline action queue so the dispatcher can
-- atomically CLAIM a row (pending -> processing) before sending. This is what makes
-- concurrent dispatcher runs (the 5-min cron racing a manual drain, or two
-- overlapping cron ticks) safe: only one runner can flip a given row to
-- 'processing', so a message is never sent — or charged — twice. A row left in
-- 'processing' by a crashed tick is self-healed back to 'pending' by the dispatcher
-- (stale > 10 min).
alter table public.pipeline_action_queue
  drop constraint if exists pipeline_action_queue_status_check;

alter table public.pipeline_action_queue
  add constraint pipeline_action_queue_status_check
  check (status = any (array['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'skipped'::text]));
