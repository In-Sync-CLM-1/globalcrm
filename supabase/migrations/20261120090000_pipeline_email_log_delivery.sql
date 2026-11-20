-- Delivery stages for pipeline emails (IEDUP / UP RAMP sends), filled by Resend's webhook (email-inbound-webhook).
-- `status` stays as it is (sent / failed, used for billing counts); the stages go in their own columns.
alter table public.pipeline_email_log add column if not exists last_event text;
alter table public.pipeline_email_log add column if not exists delivered_at timestamptz;
alter table public.pipeline_email_log add column if not exists opened_at timestamptz;
alter table public.pipeline_email_log add column if not exists bounced_at timestamptz;
create index if not exists idx_pipeline_email_log_resend_id on public.pipeline_email_log (resend_message_id) where resend_message_id is not null;
