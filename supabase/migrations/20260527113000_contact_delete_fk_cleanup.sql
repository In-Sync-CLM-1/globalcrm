-- Make contact deletion work end-to-end.
--
-- Deleting a contact previously failed with a 23503 foreign_key_violation
-- (surfaced in the app as a 409) because several child tables referenced
-- contacts(id) / contact_activities(id) with ON DELETE NO ACTION.
--
-- Policy (confirmed with the business owner):
--   * email conversations are DELETED along with the contact (CASCADE)
--   * all other records are KEPT but unlinked (SET NULL) so call/billing/
--     campaign/invoice history survives the contact's removal.
--
-- Idempotent: drops then re-adds each constraint. Already applied to the live
-- project (ejzjrvazegaxrhqizgaa) via the Management API on 2026-05-27.

-- 1) Email conversations: delete with the contact.
ALTER TABLE public.email_conversations DROP CONSTRAINT IF EXISTS email_conversations_contact_id_fkey;
ALTER TABLE public.email_conversations
  ADD CONSTRAINT email_conversations_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;

-- 2) Keep-but-unlink (SET NULL) for records worth retaining.
ALTER TABLE public.agent_call_sessions DROP CONSTRAINT IF EXISTS agent_call_sessions_contact_id_fkey;
ALTER TABLE public.agent_call_sessions
  ADD CONSTRAINT agent_call_sessions_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_campaign_recipients DROP CONSTRAINT IF EXISTS whatsapp_campaign_recipients_contact_id_fkey;
ALTER TABLE public.whatsapp_campaign_recipients
  ADD CONSTRAINT whatsapp_campaign_recipients_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_import_items DROP CONSTRAINT IF EXISTS invoice_import_items_matched_contact_id_fkey;
ALTER TABLE public.invoice_import_items
  ADD CONSTRAINT invoice_import_items_matched_contact_id_fkey
  FOREIGN KEY (matched_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_import_items DROP CONSTRAINT IF EXISTS invoice_import_items_created_contact_id_fkey;
ALTER TABLE public.invoice_import_items
  ADD CONSTRAINT invoice_import_items_created_contact_id_fkey
  FOREIGN KEY (created_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

-- 3) Transitive blocker: contact_activities cascade-deletes with the contact,
-- but call_logs.activity_id (NO ACTION) blocked that. Unlink instead of deleting
-- the call log.
ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_activity_id_fkey;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_activity_id_fkey
  FOREIGN KEY (activity_id) REFERENCES public.contact_activities(id) ON DELETE SET NULL;
