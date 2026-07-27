-- =============================================================================
-- FERVENT DEDUPE: CLOSE THE CROSS-JOB RACE ON "GENUINELY NEW" INSERTS
--
-- The reported Prateek Kumar duplicates arrived as "five copies across two
-- import jobs" (20260726140000). That column-blind-spot cause is fixed, but
-- the underlying race that let two jobs both decide a record was new was
-- never closed: find_fervent_duplicate_candidates is a plain read, called
-- from the edge function in its own round trip, separate from the later
-- insert. Two import jobs for the same org running close together (the
-- ordinary shape of "someone re-uploaded the same file") can both read "no
-- match" before either has committed its insert, and both create a row for
-- the same person.
--
-- Matches already found in an earlier read (phone/email/AI-confirmed name)
-- merge into an existing row either way, so a stale read there just means a
-- slightly stale merge target, not a duplicate. The only step where a stale
-- read creates a duplicate is "insert as genuinely new" — so that's the only
-- step that needs to be atomic with a fresh, lock-protected re-check.
--
-- claim_fervent_new_rows takes an org-scoped advisory lock for its entire
-- transaction, re-runs the same candidate search on the (already
-- intra-file-folded, already AI-cleared) rows the caller believes are new,
-- and only inserts the ones still unmatched under the lock. A fresh
-- phone/email hit found only at this point (i.e. another job just inserted
-- the same person moments ago) is auto-merged — that tier needs no AI, it's
-- definitive. A fresh name-only hit at this last-mile stage is left as new
-- rather than re-entering the AI round trip a second time; that residual
-- sliver (two jobs, same instant, name-only evidence) is accepted and
-- documented rather than chased with another network round trip inside a
-- held lock.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_fervent_new_rows(
  p_org_id uuid,
  p_import_job_id uuid,
  p_created_by uuid,
  p_records jsonb
)
RETURNS TABLE(incoming_idx integer, outcome text, target_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rec record;
  v_new_ids text[];
  v_id_idx integer;
  v_insert_records jsonb;
BEGIN
  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RETURN;
  END IF;

  -- Held for the rest of this transaction: no other batch, from this job or
  -- any other concurrent one, can run this same claim for this org until it
  -- commits or rolls back.
  PERFORM pg_advisory_xact_lock(hashtext('fervent_repo_claim:' || p_org_id::text));

  -- ON COMMIT DROP ties these to the transaction, which is normally one per
  -- RPC call — but guard explicitly in case a pooled session ever reuses a
  -- connection across calls without a clean commit in between.
  DROP TABLE IF EXISTS _in, _cands, _outcomes, _still_new;

  CREATE TEMP TABLE _in ON COMMIT DROP AS
  SELECT (r->>'idx')::integer AS idx, r AS rec
  FROM jsonb_array_elements(p_records) AS r;

  CREATE TEMP TABLE _cands ON COMMIT DROP AS
  SELECT DISTINCT ON (c.incoming_idx)
    c.incoming_idx, c.match_type, c.existing_record
  FROM public.find_fervent_duplicate_candidates(p_org_id, p_records) c
  ORDER BY c.incoming_idx, CASE c.match_type WHEN 'phone' THEN 1 WHEN 'email' THEN 2 ELSE 3 END;

  CREATE TEMP TABLE _outcomes (incoming_idx integer, outcome text, target_id uuid) ON COMMIT DROP;

  -- Strong hits found only now (i.e. inserted by a concurrent job since the
  -- caller's own read): merge, one row at a time in idx order so multiple
  -- incoming rows landing on the same target accumulate the same way
  -- merge_fervent_repository_batch's caller already does elsewhere.
  FOR v_rec IN
    SELECT i.idx, i.rec, (c.existing_record->>'id')::uuid AS tid
    FROM _in i JOIN _cands c ON c.incoming_idx = i.idx AND c.match_type IN ('phone', 'email')
    ORDER BY i.idx
  LOOP
    PERFORM public.merge_fervent_repository_batch(
      p_org_id, p_import_job_id,
      jsonb_build_array(jsonb_build_object('target_id', v_rec.tid, 'record', v_rec.rec))
    );
    INSERT INTO _outcomes VALUES (v_rec.idx, 'merged', v_rec.tid);
  END LOOP;

  -- Still genuinely unmatched: these are the only rows that actually insert.
  -- (A name-only hit surfacing only now is left in this set on purpose —
  -- see header note.)
  CREATE TEMP TABLE _still_new ON COMMIT DROP AS
  SELECT i.idx, i.rec
  FROM _in i
  WHERE NOT EXISTS (SELECT 1 FROM _cands c WHERE c.incoming_idx = i.idx AND c.match_type IN ('phone', 'email'))
    AND i.idx NOT IN (SELECT o.incoming_idx FROM _outcomes o);

  SELECT count(*) INTO v_id_idx FROM _still_new WHERE NULLIF(rec->>'unique_id', '') IS NULL;
  IF v_id_idx > 0 THEN
    v_new_ids := public.generate_fervent_unique_ids(p_org_id, v_id_idx);
  END IF;

  v_id_idx := 1;
  v_insert_records := '[]'::jsonb;
  FOR v_rec IN SELECT idx, rec FROM _still_new ORDER BY idx LOOP
    IF NULLIF(v_rec.rec->>'unique_id', '') IS NULL THEN
      v_insert_records := v_insert_records || jsonb_build_array(v_rec.rec || jsonb_build_object('unique_id', v_new_ids[v_id_idx]));
      v_id_idx := v_id_idx + 1;
    ELSE
      v_insert_records := v_insert_records || jsonb_build_array(v_rec.rec);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_insert_records) > 0 THEN
    PERFORM public.upsert_fervent_repository_batch(p_org_id, p_created_by, p_import_job_id, v_insert_records);
  END IF;

  INSERT INTO _outcomes
  SELECT idx, 'inserted', NULL FROM _still_new;

  RETURN QUERY SELECT o.incoming_idx, o.outcome, o.target_id FROM _outcomes o;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_fervent_new_rows(uuid, uuid, uuid, jsonb) TO service_role;
