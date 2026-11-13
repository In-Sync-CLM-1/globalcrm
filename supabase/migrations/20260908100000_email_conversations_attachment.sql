-- Lets a scheduled send carry one attachment (e.g. BD outreach's case study
-- PDF). Nullable and additive: every existing row and sender is unaffected.
ALTER TABLE email_conversations
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_filename text;
