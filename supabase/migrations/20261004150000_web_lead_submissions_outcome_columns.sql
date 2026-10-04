-- Record WHY each web-lead-intake hit ended the way it did, not just whether it
-- was blocked. Born from WorkSync's Google Ads page: visitors pressed "Request
-- my demo" many times and almost nothing reached the CRM, with no way to tell
-- a bot check, a validation failure, or a browser-side failure apart.
-- Additive and idempotent; no PII is stored (error text names the field, never
-- the value).
alter table public.web_lead_submissions
  add column if not exists honeypot_filled boolean not null default false,
  add column if not exists turnstile_result text,   -- 'pass' | 'fail' | 'missing' | 'unconfigured' | 'error'
  add column if not exists turnstile_codes text,    -- Cloudflare error-codes, comma-joined
  add column if not exists outcome text,            -- 'accepted' | 'deduped' | 'rejected' | 'blocked_honeypot' | 'client_error'
  add column if not exists http_status integer,
  add column if not exists error_message text,
  add column if not exists client_event text;       -- browser-reported failure, e.g. 'phone_invalid'
create index if not exists web_lead_submissions_outcome_idx on public.web_lead_submissions(outcome, created_at desc);
