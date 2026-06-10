-- Sequential upload + upload history (BSR attendance).
--
-- 1. A punch must never be uploaded before its punch time: the generator now
--    plans the whole window up front, and the 5-min pusher trickles punches to
--    UPSMF as their times pass — sequential like a real device, not one bulk
--    batch (UPSMF EntryDate stays close to PunchTime).
CREATE OR REPLACE FUNCTION public.claim_edu_punches(_limit INT DEFAULT 200)
RETURNS SETOF public.edu_attendance_punches
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.edu_attendance_punches p
  SET sync_status = 'processing', attempts = p.attempts + 1, claimed_at = now()
  WHERE p.id IN (
    SELECT id FROM public.edu_attendance_punches
    WHERE attempts < 5 AND punch_time <= now() AND (
      sync_status IN ('pending','failed')
      OR (sync_status = 'processing' AND claimed_at < now() - INTERVAL '15 minutes')
    )
    ORDER BY punch_time
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING p.*;
$$;

REVOKE ALL ON FUNCTION public.claim_edu_punches(INT) FROM anon, authenticated;

-- 2. Upload history: one row per generation/upload run, with present/absent
--    counts and the named absentee list. The UNIQUE constraint doubles as the
--    generator's idempotency gate (a window is only ever generated once).
CREATE TABLE IF NOT EXISTS public.edu_upload_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  upload_date  DATE NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  source       TEXT NOT NULL,
  total_active INT NOT NULL,
  present      INT NOT NULL,
  absent       INT NOT NULL,
  absentees    JSONB,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, upload_date, direction, source)
);
CREATE INDEX IF NOT EXISTS idx_edu_upload_log_org_date ON public.edu_upload_log (org_id, upload_date);

ALTER TABLE public.edu_upload_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "edu_upload_log org access" ON public.edu_upload_log;
CREATE POLICY "edu_upload_log org access" ON public.edu_upload_log FOR ALL
  USING (org_id = public.get_user_org_id(auth.uid()) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (org_id = public.get_user_org_id(auth.uid()) OR public.is_platform_admin(auth.uid()));
