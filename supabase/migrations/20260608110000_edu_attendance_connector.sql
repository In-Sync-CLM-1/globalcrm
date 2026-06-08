-- Connector support for the UPSMF attendance push.
-- Adds a 'processing' claim state + an atomic claim RPC so the cron pusher can
-- grab a batch exactly once (FOR UPDATE SKIP LOCKED), with crash recovery for
-- rows left 'processing' by a dead run.

ALTER TABLE public.edu_attendance_punches
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE public.edu_attendance_punches
  DROP CONSTRAINT IF EXISTS edu_attendance_punches_sync_status_check;
ALTER TABLE public.edu_attendance_punches
  ADD CONSTRAINT edu_attendance_punches_sync_status_check
  CHECK (sync_status IN ('pending','processing','synced','failed'));

-- Atomically claim a batch of un-pushed punches (across all orgs).
-- Claims pending/failed rows (attempts < 5) and re-claims rows stuck in
-- 'processing' for >15 min (a crashed prior run). Service role only.
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
    WHERE attempts < 5 AND (
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
