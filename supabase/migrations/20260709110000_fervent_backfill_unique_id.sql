-- =============================================================================
-- BACKFILL UNIQUE ID FOR EXISTING FERVENT REPOSITORY RECORDS
--
-- Every existing record was uploaded before Unique ID was used as the
-- insert-vs-update match key (20260709103000_fervent_upload_insert_or_update.sql),
-- and none of the source files carried a Unique ID column, so all 1,231
-- existing rows have unique_id = NULL. That means none of them can be matched
-- and updated by a future re-upload — only newly uploaded rows can.
--
-- Assigns each existing row a generated ID (FERVENT-000001, ...), sequential
-- per org in created_at order, so every record has a stable key going forward.
-- Idempotent: only touches rows where unique_id IS NULL, so once backfilled
-- this is a no-op on re-run (e.g. when CI re-applies this file).
-- =============================================================================

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY org_id ORDER BY created_at, id) AS rn
  FROM public.fervent_data_repository
  WHERE unique_id IS NULL
)
UPDATE public.fervent_data_repository f
SET unique_id = 'FERVENT-' || lpad(numbered.rn::text, 6, '0'),
    updated_at = now()
FROM numbered
WHERE f.id = numbered.id;
