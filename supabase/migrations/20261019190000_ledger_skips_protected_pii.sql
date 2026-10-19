-- The activity ledger must not capture contact phone numbers or emails for orgs with PII protection.
-- Same recorder as before; the only change is the block that adds those columns to the per-table
-- exclusion list when pii_protected(org). Idempotent.

CREATE OR REPLACE FUNCTION public.ledger_log_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_module  text    := TG_ARGV[0];
  v_vis     text    := COALESCE(TG_ARGV[1], 'admin');
  v_redact  boolean := COALESCE(TG_ARGV[2], 'false') = 'true';
  v_extra   text[]  := string_to_array(COALESCE(TG_ARGV[3], ''), ',');
  v_secret  text    := '(^|_)(password|passwd|token|secret|otp|credential)(_|$)|api_?key|access_key|private_key';
  v_stamps  text[]  := ARRAY['updated_at', 'updated_by'];
  v_old     jsonb;
  v_new     jsonb;
  v_row     jsonb;
  v_changes jsonb;
  v_event   text;
  v_label   text;
  v_ref     jsonb;
  v_entity  uuid;
  v_actor   uuid;
  v_details jsonb;
  v_excl    text[];
  v_sys     boolean := auth.uid() IS NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD); v_event := 'deleted';
  ELSIF TG_OP = 'INSERT' THEN
    v_row := to_jsonb(NEW); v_event := 'created';
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_row := v_new; v_event := 'updated';
  END IF;

  -- Orgs with PII protection never write phone numbers or emails (in any form) into the ledger.
  IF TG_TABLE_NAME IN ('contacts', 'contact_phones', 'contact_emails', 'call_logs') AND (v_row ->> 'org_id') IS NOT NULL THEN
    BEGIN
      IF public.pii_protected((v_row ->> 'org_id')::uuid) THEN
        v_extra := v_extra || ARRAY['phone', 'email', 'phone_encrypted', 'email_encrypted', 'phone_hash', 'email_hash',
                                    'to_number', 'from_number', 'lead_number_encrypted', 'exotel_raw_data', 'phone_numbers'];
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  SELECT COALESCE(array_agg(k.key), ARRAY[]::text[]) INTO v_excl
    FROM jsonb_object_keys(v_row) AS k(key)
   WHERE k.key ~* v_secret OR k.key = ANY (v_extra);

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k.key, jsonb_build_object('old', v_old -> k.key, 'new', v_new -> k.key))
      INTO v_changes
      FROM jsonb_object_keys(v_new) AS k(key)
     WHERE k.key <> ALL (v_excl)
       AND (v_old -> k.key) IS DISTINCT FROM (v_new -> k.key);
    -- Only the last-updated stamps moved: nothing a person changed.
    IF v_changes IS NULL OR NOT EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_changes) AS c(key) WHERE c.key <> ALL (v_stamps)) THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN v_entity := (v_row ->> 'id')::uuid; EXCEPTION WHEN OTHERS THEN v_entity := NULL; END;

  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    BEGIN v_actor := NULLIF(COALESCE(v_row ->> 'updated_by', v_row ->> 'created_by'), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  END IF;

  SELECT v_row ->> c INTO v_label
    FROM unnest(ARRAY['project_name', 'name', 'title', 'company_name', 'vendor_name', 'legal_name', 'subject',
                      'full_name', 'quotation_number', 'invoice_number', 'order_number', 'po_number',
                      'project_number', 'ticket_number', 'claim_number', 'task_number', 'file_name']) AS c
   WHERE COALESCE(v_row ->> c, '') <> ''
   LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(r.k, v_row -> r.k), '{}'::jsonb) INTO v_ref
    FROM unnest(ARRAY['user_id', 'org_id', 'organization_id', 'tenant_id', 'project_id', 'client_id', 'vendor_id',
                      'ticket_id', 'task_id', 'claim_id', 'contact_id', 'team_id']) AS r(k)
   WHERE v_row ? r.k AND (v_row -> r.k) <> 'null'::jsonb;

  IF v_redact THEN
    v_label := NULL;
    IF TG_OP = 'UPDATE' THEN
      v_details := jsonb_build_object('ref', v_ref, 'changed_fields', (SELECT jsonb_agg(key) FROM jsonb_object_keys(v_changes) AS key));
    ELSE
      v_details := jsonb_build_object('ref', v_ref);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_details := jsonb_build_object('ref', v_ref, 'changes', v_changes);
  ELSE
    v_details := jsonb_build_object('ref', v_ref, 'snapshot', v_row - v_excl);
  END IF;
  v_details := v_details || jsonb_build_object('system', v_sys);

  INSERT INTO activity_ledger (
    occurred_at, module, entity_type, entity_id, event_type, actor_id,
    entity_label, visibility, details, source_table, source_id
  ) VALUES (
    now(), v_module, TG_TABLE_NAME, v_entity, v_event, v_actor,
    v_label, v_vis, v_details, TG_TABLE_NAME, gen_random_uuid()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ledger_log_row_change failed on %: %', TG_TABLE_NAME, SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;
