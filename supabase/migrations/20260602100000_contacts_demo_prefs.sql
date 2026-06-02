-- Capture demo preferences on the lead (from the WorkSync "Request a Demo" form):
-- team size + preferred demo day/time. The qualify call then CONFIRMS these
-- instead of eliciting them from scratch.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS team_size           text,
  ADD COLUMN IF NOT EXISTS preferred_demo_date date,
  ADD COLUMN IF NOT EXISTS preferred_demo_time text;
