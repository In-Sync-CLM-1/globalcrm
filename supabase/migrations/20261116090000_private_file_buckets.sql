-- Code audit 2026-11-15, GlobalCRM item (b): customer files private, opened through expiring links.
--
-- Private now (opened by signed-in staff through a link that expires after an hour):
--   client-documents, attendance-photos, chat-attachments (already private), ticket-attachments,
--   ticket-escalation-attachments (ticketing retired, no screen uses them).
-- Each organisation can reach only its own files.
--
-- Stay public on purpose, but writes limited to the uploader's own organisation:
--   org-logos (shown on public pages and emails), whatsapp-templates (media the WhatsApp provider
--   fetches by link when a template is sent). email-attachments also stays public because the link
--   goes out inside customer emails; its rules were already per organisation.

-- 1. Buckets ---------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
  ('client-documents', 'client-documents', false),
  ('attendance-photos', 'attendance-photos', false),
  ('chat-attachments', 'chat-attachments', false),
  ('ticket-attachments', 'ticket-attachments', false),
  ('ticket-escalation-attachments', 'ticket-escalation-attachments', false),
  ('org-logos', 'org-logos', true),
  ('whatsapp-templates', 'whatsapp-templates', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- 2. Client documents and invoices: first folder is the organisation id ----
DROP POLICY IF EXISTS "Users can upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view client documents in their org" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their uploaded documents" ON storage.objects;
DROP POLICY IF EXISTS client_documents_select_org ON storage.objects;
DROP POLICY IF EXISTS client_documents_insert_org ON storage.objects;
DROP POLICY IF EXISTS client_documents_delete_org ON storage.objects;

CREATE POLICY client_documents_select_org ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-documents'
         AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY client_documents_insert_org ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-documents'
              AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY client_documents_delete_org ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-documents'
         AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);

-- 3. Attendance photos: own photos, or an admin of the same organisation ----
DROP POLICY IF EXISTS attendance_photos_select_own_or_admin ON storage.objects;
DROP POLICY IF EXISTS attendance_photos_delete_own_or_admin ON storage.objects;

CREATE POLICY attendance_photos_select_own_or_admin ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-photos' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id::text = (storage.foldername(name))[1]
                      AND p.org_id = public.get_user_org_id(auth.uid())))));
CREATE POLICY attendance_photos_delete_own_or_admin ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'attendance-photos' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id::text = (storage.foldername(name))[1]
                      AND p.org_id = public.get_user_org_id(auth.uid())))));

-- 4. Chat attachments: the uploader and the people in that conversation -----
--    Path is <uploader id>/<conversation id>/<file>.
DROP POLICY IF EXISTS "Users can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_select_participants ON storage.objects;

CREATE POLICY chat_attachments_select_participants ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-attachments' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR CASE WHEN (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_participant_in_conversation(((storage.foldername(name))[2])::uuid, auth.uid())
            ELSE false END));

-- 5. Ticket buckets: no open upload or viewing (ticketing retired) ---------
DROP POLICY IF EXISTS "Anyone can upload ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view escalation attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload escalation attachments" ON storage.objects;

-- 6. Organisation logos: public to view, changed only inside your own organisation's folder
DROP POLICY IF EXISTS "Users can upload org logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update org logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete org logos" ON storage.objects;
DROP POLICY IF EXISTS org_logos_insert_org ON storage.objects;
DROP POLICY IF EXISTS org_logos_update_org ON storage.objects;
DROP POLICY IF EXISTS org_logos_delete_org ON storage.objects;

CREATE POLICY org_logos_insert_org ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-logos'
              AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY org_logos_update_org ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'org-logos'
         AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text)
  WITH CHECK (bucket_id = 'org-logos'
              AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY org_logos_delete_org ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'org-logos'
         AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);

-- 7. WhatsApp template media: public link stays (the provider fetches it), but the
--    file list is no longer open and changes stay inside template-media/<your org>/.
DROP POLICY IF EXISTS "Anyone can view whatsapp templates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload whatsapp templates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update whatsapp templates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete whatsapp templates" ON storage.objects;
DROP POLICY IF EXISTS whatsapp_templates_select_org ON storage.objects;
DROP POLICY IF EXISTS whatsapp_templates_insert_org ON storage.objects;
DROP POLICY IF EXISTS whatsapp_templates_update_org ON storage.objects;
DROP POLICY IF EXISTS whatsapp_templates_delete_org ON storage.objects;

CREATE POLICY whatsapp_templates_select_org ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'whatsapp-templates' AND (storage.foldername(name))[1] = 'template-media'
         AND (storage.foldername(name))[2] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY whatsapp_templates_insert_org ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-templates' AND (storage.foldername(name))[1] = 'template-media'
              AND (storage.foldername(name))[2] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY whatsapp_templates_update_org ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'whatsapp-templates' AND (storage.foldername(name))[1] = 'template-media'
         AND (storage.foldername(name))[2] = public.get_user_org_id(auth.uid())::text);
CREATE POLICY whatsapp_templates_delete_org ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'whatsapp-templates' AND (storage.foldername(name))[1] = 'template-media'
         AND (storage.foldername(name))[2] = public.get_user_org_id(auth.uid())::text);
