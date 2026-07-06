-- Phase 4 of the Fervent Database backlog: Saved Searches and Advanced
-- (Boolean AND/OR/NOT) Search. The advanced query itself is never stored as
-- raw SQL — `definition` holds a structured {mode, conditions[]} shape that
-- the frontend translates into safe, parameterized filter calls at query time
-- (see FerventAdvancedSearch.tsx / applyBooleanQuery in FerventRepository.tsx).
CREATE TABLE public.fervent_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.fervent_saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fervent org can view its own saved searches"
ON public.fervent_saved_searches FOR SELECT
TO authenticated
USING (
  org_id = get_user_org_id(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = fervent_saved_searches.org_id
    AND slug = 'fervent-communication'
  )
);

CREATE POLICY "Fervent org can create its own saved searches"
ON public.fervent_saved_searches FOR INSERT
TO authenticated
WITH CHECK (
  org_id = get_user_org_id(auth.uid()) AND
  created_by = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = fervent_saved_searches.org_id
    AND slug = 'fervent-communication'
  )
);

CREATE POLICY "Fervent org can delete its own saved searches"
ON public.fervent_saved_searches FOR DELETE
TO authenticated
USING (
  org_id = get_user_org_id(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = fervent_saved_searches.org_id
    AND slug = 'fervent-communication'
  )
);

CREATE POLICY "Service role can manage all fervent saved searches"
ON public.fervent_saved_searches FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_fervent_saved_searches_org ON public.fervent_saved_searches(org_id, created_at DESC);
