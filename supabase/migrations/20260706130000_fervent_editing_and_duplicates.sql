-- Phase 3 of the Fervent Database backlog: editing, bulk edit, and
-- duplicate detection during import.

-- Tracks rows skipped as duplicates during any bulk import (generic column,
-- not Fervent-specific, mirroring success_count/error_count already there).
ALTER TABLE public.import_jobs
  ADD COLUMN duplicate_count INTEGER DEFAULT 0;
