-- Bug: process-bulk-import's duplicate detection only checks the DB state
-- at query time (SELECT-then-INSERT). bulk-import-trigger fires it as a
-- fire-and-forget background call, so nothing stops a user from uploading
-- the same file twice before the first import finishes — the second job's
-- dedup check runs against a database that doesn't yet contain the first
-- job's rows, and both jobs insert the same records.
--
-- Fix at the source: only one pending/processing import per org+type can
-- exist at a time. The second INSERT into import_jobs fails atomically
-- (23505) instead of racing another job's writes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_one_active_per_org_type
  ON public.import_jobs (org_id, import_type)
  WHERE status IN ('pending', 'processing');
