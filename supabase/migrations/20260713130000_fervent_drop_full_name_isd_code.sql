-- Backfill first_name/last_name by splitting full_name (only where first_name
-- is still empty, so any already-set value is left untouched), merge
-- isd_code into mobile_number_1, rebuild the search index without
-- full_name, then drop both removed columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fervent_data_repository' AND column_name = 'full_name'
  ) THEN
    UPDATE fervent_data_repository t
    SET
      first_name = split_part(n.name, ' ', 1),
      last_name = NULLIF(substring(n.name from length(split_part(n.name, ' ', 1)) + 2), '')
    FROM (
      SELECT id, regexp_replace(btrim(full_name), '\s+', ' ', 'g') AS name
      FROM fervent_data_repository
      WHERE full_name IS NOT NULL AND btrim(full_name) <> '' AND first_name IS NULL
    ) n
    WHERE t.id = n.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fervent_data_repository' AND column_name = 'isd_code'
  ) THEN
    UPDATE fervent_data_repository
    SET mobile_number_1 = isd_code || regexp_replace(mobile_number_1, '[^0-9]', '', 'g')
    WHERE isd_code IS NOT NULL
      AND mobile_number_1 IS NOT NULL
      AND mobile_number_1 NOT LIKE (isd_code || '%');
  END IF;
END $$;

DROP INDEX IF EXISTS idx_fervent_repo_search;
CREATE INDEX IF NOT EXISTS idx_fervent_repo_search ON public.fervent_data_repository
  USING gin (to_tsvector('english'::regconfig,
    COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') || ' ' ||
    COALESCE(company_name, '') || ' ' || COALESCE(designation, '') || ' ' ||
    COALESCE(city, '') || ' ' || COALESCE(industry, '')
  ));

ALTER TABLE fervent_data_repository DROP COLUMN IF EXISTS full_name;
ALTER TABLE fervent_data_repository DROP COLUMN IF EXISTS isd_code;
