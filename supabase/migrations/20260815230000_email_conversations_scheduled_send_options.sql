-- Scheduled emails lose the send options the caller would have passed inline.
-- scheduled-messages-processor re-invokes send-email from the stored row, so
-- anything not held as a column silently reverts to platform defaults: a
-- personal one-on-one send comes back out with the branded unsubscribe footer,
-- and a follow-up meant to land inside an existing thread starts a new one.
-- Persist the three options that matter alongside the queued row.

ALTER TABLE public.email_conversations
  ADD COLUMN IF NOT EXISTS bare_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_reply_to text;

COMMENT ON COLUMN public.email_conversations.bare_email IS
  'Send without the platform unsubscribe footer and without the List-Unsubscribe header (personal one-to-one mail, not bulk).';
COMMENT ON COLUMN public.email_conversations.in_reply_to IS
  'RFC 5322 Message-ID of the parent message, angle brackets included. Set to thread this send onto an existing conversation.';
