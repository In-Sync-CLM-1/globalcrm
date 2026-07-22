-- Removes DB-side leftovers of edge functions deleted in the same PR:
-- the abandoned hybrid-import flow (superseded by
-- bulk-import-trigger -> process-bulk-import -> rollback-bulk-import,
-- which uses import_jobs, not import_staging/bulk_import_records),
-- the never-wired Google Calendar OAuth trio, the client-merge RPC
-- superseded by a client-side merge in MergeClientsDialog.tsx, and the
-- orphaned Revenue "monthly actuals / carry forward" feature (backend
-- and frontend both unused - RevenueDashboard never imports them).
-- All three dropped tables were verified at 0 rows before writing this.

DROP FUNCTION IF EXISTS public.process_bulk_import_batch(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.revert_bulk_import(uuid, uuid);
DROP FUNCTION IF EXISTS public.merge_clients_atomic(uuid, uuid[], uuid);
DROP FUNCTION IF EXISTS public.get_monthly_actuals_optimized(uuid, integer);
DROP FUNCTION IF EXISTS public.capture_carry_forward_optimized(uuid, integer);

DROP TABLE IF EXISTS public.import_staging;
DROP TABLE IF EXISTS public.bulk_import_records;
DROP TABLE IF EXISTS public.google_oauth_tokens;
