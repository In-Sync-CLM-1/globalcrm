-- Full removal of the unused Redefine data repository and Inventory
-- features. Verified before writing this migration: both tables were
-- completely empty (0 rows) across every org, zero import attempts were
-- ever recorded for either, and no org had the redefine feature flag
-- enabled — dead, unshipped scaffolding.

-- Strip the two dead branches out of the legacy DB-side bulk import path
-- (process_bulk_import_batch / revert_bulk_import back process-import-hybrid,
-- revert-import, cancel-import — none of which are called from the app).
CREATE OR REPLACE FUNCTION public.process_bulk_import_batch(p_import_id uuid, p_table_name text, p_org_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_record RECORD;
  v_new_record_id UUID;
  v_processed INTEGER := 0;
  v_inserted INTEGER := 0;
  v_failed INTEGER := 0;
  v_skipped INTEGER := 0;
  v_errors JSONB := '[]'::JSONB;
BEGIN
  FOR v_record IN
    SELECT * FROM import_staging
    WHERE import_id = p_import_id AND NOT processed
    ORDER BY row_number
  LOOP
    BEGIN
      CASE p_table_name
        WHEN 'contacts' THEN
          INSERT INTO contacts (
            org_id, created_by, first_name, last_name, email, phone,
            company, job_title, source, status, address, city, state, country, postal_code, notes
          )
          VALUES (
            p_org_id,
            p_user_id,
            COALESCE(v_record.raw_data->>'first_name', ''),
            v_record.raw_data->>'last_name',
            v_record.raw_data->>'email',
            v_record.raw_data->>'phone',
            v_record.raw_data->>'company',
            v_record.raw_data->>'job_title',
            COALESCE(v_record.raw_data->>'source', 'bulk_import'),
            COALESCE(v_record.raw_data->>'status', 'new'),
            v_record.raw_data->>'address',
            v_record.raw_data->>'city',
            v_record.raw_data->>'state',
            v_record.raw_data->>'country',
            v_record.raw_data->>'postal_code',
            v_record.raw_data->>'notes'
          )
          ON CONFLICT DO NOTHING
          RETURNING id INTO v_new_record_id;

        ELSE
          -- Unsupported table
          v_failed := v_failed + 1;
          v_errors := v_errors || jsonb_build_object(
            'row', v_record.row_number,
            'error', 'Unsupported table: ' || p_table_name
          );
          CONTINUE;
      END CASE;

      -- Track the inserted record for revert capability
      IF v_new_record_id IS NOT NULL THEN
        INSERT INTO bulk_import_records (import_id, record_id, table_name, row_number)
        VALUES (p_import_id, v_new_record_id, p_table_name, v_record.row_number);
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;

      -- Mark as processed
      UPDATE import_staging SET processed = true WHERE id = v_record.id;
      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', v_record.row_number,
        'error', SQLERRM
      );
      -- Mark as processed even on error
      UPDATE import_staging SET processed = true WHERE id = v_record.id;
      v_processed := v_processed + 1;
    END;
  END LOOP;

  -- Clean up staging records for this import
  DELETE FROM import_staging WHERE import_id = p_import_id;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'inserted', v_inserted,
    'skipped', v_skipped,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revert_bulk_import(p_import_id uuid, p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_record RECORD;
  v_deleted INTEGER := 0;
  v_table_name TEXT;
BEGIN
  SELECT table_name INTO v_table_name
  FROM bulk_import_history
  WHERE id = p_import_id AND org_id = p_org_id;

  IF v_table_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Import not found');
  END IF;

  FOR v_record IN
    SELECT record_id FROM bulk_import_records
    WHERE import_id = p_import_id
  LOOP
    CASE v_table_name
      WHEN 'contacts' THEN
        DELETE FROM contacts WHERE id = v_record.record_id AND org_id = p_org_id;
    END CASE;
    v_deleted := v_deleted + 1;
  END LOOP;

  UPDATE bulk_import_history
  SET status = 'reverted', reverted_at = now(), can_revert = false, updated_at = now()
  WHERE id = p_import_id;

  DELETE FROM bulk_import_records WHERE import_id = p_import_id;

  RETURN jsonb_build_object('success', true, 'deleted', v_deleted);
END;
$function$;

-- Drop inventory_items and redefine_data_repository (+ its audit trail)
-- entirely. No FKs reference inventory_items. redefine_repository_audit FKs
-- into redefine_data_repository (drop first), and the audit trigger lives on
-- redefine_data_repository itself (drops with that table, before the
-- function it calls can be dropped).
DROP TABLE IF EXISTS public.redefine_repository_audit;
DROP TABLE IF EXISTS public.redefine_data_repository;
DROP FUNCTION IF EXISTS public.log_redefine_repository_changes();
DROP TABLE IF EXISTS public.inventory_items;

-- Remove their feature flags and any designation-level permission rows.
DELETE FROM public.designation_feature_access WHERE feature_key IN ('redefine_data_repository', 'inventory');
DELETE FROM public.org_feature_access WHERE feature_key IN ('redefine_data_repository', 'inventory');
DELETE FROM public.feature_permissions WHERE feature_key IN ('redefine_data_repository', 'inventory');

-- Drop both from the bulk-delete whitelist (Fervent's repository stays).
CREATE OR REPLACE FUNCTION public.bulk_delete_verified(_table_name text, _record_ids uuid[], _org_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INT;
  valid_tables TEXT[] := ARRAY[
    'contacts', 'clients', 'tasks', 'client_invoices',
    'client_documents', 'contact_activities', 'email_templates',
    'forms', 'teams', 'fervent_data_repository'
  ];
  records_in_org INT;
BEGIN
  IF NOT (_table_name = ANY(valid_tables)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid table name: ' || _table_name
    );
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM %I WHERE id = ANY($1) AND org_id = $2',
    _table_name
  ) INTO records_in_org USING _record_ids, _org_id;

  IF records_in_org != array_length(_record_ids, 1) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Some records do not belong to the organization',
      'found', records_in_org,
      'requested', array_length(_record_ids, 1)
    );
  END IF;

  EXECUTE format(
    'DELETE FROM %I WHERE id = ANY($1) AND org_id = $2',
    _table_name
  ) USING _record_ids, _org_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', deleted_count,
    'table', _table_name
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$function$;
