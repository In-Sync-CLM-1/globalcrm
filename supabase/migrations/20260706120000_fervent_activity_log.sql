-- Phase 2 of the Fervent Database backlog: data source display, per-record
-- notes/timeline, and an export history log.

-- Link each repository record back to the import batch that created it, so
-- "Imported By / Import Date / Import File" can be shown without duplicating
-- that data — import_jobs already tracks user_id, created_at, file_name.
ALTER TABLE public.fervent_data_repository
  ADD COLUMN import_job_id UUID REFERENCES public.import_jobs(id) ON DELETE SET NULL;

CREATE INDEX idx_fervent_repo_import_job ON public.fervent_data_repository(import_job_id);

-- Single log for both per-record activity (notes, future edits/calls) and
-- org-level events (exports). record_id is null for org-level events.
CREATE TABLE public.fervent_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_id UUID REFERENCES public.fervent_data_repository(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('note', 'edited', 'exported', 'called', 'whatsapp_sent', 'added_to_pipeline')),
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.fervent_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fervent org can view its own activity log"
ON public.fervent_activity_log FOR SELECT
TO authenticated
USING (
  org_id = get_user_org_id(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = fervent_activity_log.org_id
    AND slug = 'fervent-communication'
  )
);

CREATE POLICY "Fervent org can log its own activity"
ON public.fervent_activity_log FOR INSERT
TO authenticated
WITH CHECK (
  org_id = get_user_org_id(auth.uid()) AND
  actor_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = fervent_activity_log.org_id
    AND slug = 'fervent-communication'
  )
);

CREATE POLICY "Service role can manage all fervent activity log"
ON public.fervent_activity_log FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_fervent_activity_org ON public.fervent_activity_log(org_id, created_at DESC);
CREATE INDEX idx_fervent_activity_record ON public.fervent_activity_log(record_id, created_at DESC);
