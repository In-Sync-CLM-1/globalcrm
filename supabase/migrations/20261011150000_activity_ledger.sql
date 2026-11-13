-- Tamper-evident activity ledger for GlobalCRM.
--
-- A permanent, append-only record of every change to the business tables, kept
-- apart from them (no foreign keys), so history survives deletion. Entries are
-- sealed into numbered blocks; each block stores a SHA-256 fingerprint of its
-- entries and of the previous block, so changing or removing any old entry
-- breaks every fingerprint after it. A Cloudflare Worker seals every 5 minutes
-- and, each night, verifies the chain and matches it against a full copy in
-- Cloudflare R2 and a fingerprint copy in Google Drive.
--
-- The row-hash definition below is frozen: never add, remove or reorder fields in
-- ledger_row_hash(), or already-sealed blocks stop verifying.
--
-- Recorded from the day this migration runs; earlier history cannot be rebuilt.
-- Credentials (password / token / secret / API key / OTP / credential columns)
-- are never written to the ledger. A ledger problem never blocks the real write.
-- Idempotent: safe to re-run.

-- 1. Ledger table ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL,
  module        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  entity_label  text,
  event_type    text NOT NULL,
  actor_id      uuid,
  field_name    text,
  old_value     text,
  new_value     text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_table  text NOT NULL,
  source_id     uuid NOT NULL,
  is_backfill   boolean NOT NULL DEFAULT false,
  visibility    text NOT NULL DEFAULT 'admin',
  created_at    timestamptz NOT NULL DEFAULT now(),
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  txid          xid8 NOT NULL DEFAULT pg_current_xact_id(),
  revision      integer NOT NULL DEFAULT 0,
  CONSTRAINT activity_ledger_source_rev_uniq UNIQUE (source_table, source_id, event_type, revision)
);
CREATE INDEX IF NOT EXISTS idx_activity_ledger_txid_seq ON public.activity_ledger (txid, seq);
CREATE INDEX IF NOT EXISTS idx_activity_ledger_type_event_time ON public.activity_ledger (entity_type, event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_ledger_entity ON public.activity_ledger (entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_ledger_actor_time ON public.activity_ledger (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ledger_module_time ON public.activity_ledger (module, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.ledger_blocks (
  block_no     bigint PRIMARY KEY,
  prev_hash    text NOT NULL,
  from_xid     xid8 NOT NULL,
  up_to_xid    xid8 NOT NULL,
  entry_count  bigint NOT NULL,
  first_seq    bigint,
  last_seq     bigint,
  rows_hash    text NOT NULL,
  block_hash   text NOT NULL,
  sealed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ledger_anchors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_no     bigint NOT NULL,
  block_hash   text NOT NULL,
  anchored_at  timestamptz NOT NULL DEFAULT now(),
  destinations jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.ledger_verifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verified_at    timestamptz NOT NULL DEFAULT now(),
  ok             boolean NOT NULL,
  blocks_checked integer NOT NULL DEFAULT 0,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.ledger_excluded_tables (
  table_name text PRIMARY KEY,
  reason     text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ledger_tracking_started (
  kind       text PRIMARY KEY,
  started_at timestamptz NOT NULL,
  note       text
);

ALTER TABLE public.activity_ledger          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_anchors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_verifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_excluded_tables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_tracking_started  ENABLE ROW LEVEL SECURITY;

-- Who may read entries: platform administrators only (the data of every organisation is in it). Nobody can write except the SECURITY DEFINER recorders.
CREATE OR REPLACE FUNCTION public.ledger_can_view(p_visibility text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND CASE p_visibility
    WHEN 'open'  THEN true
    WHEN 'admin' THEN (public.is_platform_admin(auth.uid()))
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT auth.uid() IS NOT NULL AND (public.is_platform_admin(auth.uid())) $$;

DROP POLICY IF EXISTS "Ledger rows visible per tier" ON public.activity_ledger;
CREATE POLICY "Ledger rows visible per tier" ON public.activity_ledger FOR SELECT USING (public.ledger_can_view(visibility));
DROP POLICY IF EXISTS "Admins read ledger blocks" ON public.ledger_blocks;
CREATE POLICY "Admins read ledger blocks" ON public.ledger_blocks FOR SELECT USING (public.ledger_is_admin());
DROP POLICY IF EXISTS "Admins read ledger anchors" ON public.ledger_anchors;
CREATE POLICY "Admins read ledger anchors" ON public.ledger_anchors FOR SELECT USING (public.ledger_is_admin());
DROP POLICY IF EXISTS "Admins read ledger verifications" ON public.ledger_verifications;
CREATE POLICY "Admins read ledger verifications" ON public.ledger_verifications FOR SELECT USING (public.ledger_is_admin());
DROP POLICY IF EXISTS "Admins read ledger exclusions" ON public.ledger_excluded_tables;
CREATE POLICY "Admins read ledger exclusions" ON public.ledger_excluded_tables FOR SELECT USING (public.ledger_is_admin());
DROP POLICY IF EXISTS "Admins read ledger tracking dates" ON public.ledger_tracking_started;
CREATE POLICY "Admins read ledger tracking dates" ON public.ledger_tracking_started FOR SELECT USING (public.ledger_is_admin());

REVOKE ALL ON public.activity_ledger, public.ledger_blocks, public.ledger_anchors, public.ledger_verifications,
              public.ledger_excluded_tables, public.ledger_tracking_started FROM anon, authenticated, service_role;
GRANT SELECT ON public.activity_ledger, public.ledger_blocks, public.ledger_anchors, public.ledger_verifications,
                public.ledger_excluded_tables, public.ledger_tracking_started TO authenticated;
GRANT SELECT ON public.activity_ledger, public.ledger_blocks, public.ledger_anchors, public.ledger_verifications,
                public.ledger_excluded_tables, public.ledger_tracking_started TO service_role;
GRANT INSERT ON public.ledger_verifications, public.ledger_anchors TO service_role;

-- 2. Append-only for everyone ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_block_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DO $lock$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity_ledger', 'ledger_blocks', 'ledger_anchors', 'ledger_verifications'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_ledger_no_change ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_ledger_no_change BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ledger_block_changes()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_ledger_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_block_changes()', t);
  END LOOP;
END
$lock$;

-- 3. Row recorder -----------------------------------------------------------------------------
-- Trigger args: 0 module   1 visibility tier   2 redact ('true' = field names only)
--               3 comma list of extra columns to leave out
CREATE OR REPLACE FUNCTION public.ledger_log_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- 4. Hashing and sealing (FROZEN row-hash definition) --------------------------------------
CREATE OR REPLACE FUNCTION public.ledger_row_hash(l public.activity_ledger)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    l.seq, l.id, l.txid::text, l.revision,
    to_char(l.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    to_char(l.created_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    l.module, l.entity_type, l.entity_id, l.entity_label, l.event_type, l.actor_id,
    l.field_name, l.old_value, l.new_value, l.details,
    l.source_table, l.source_id, l.is_backfill, l.visibility
  )::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.ledger_range_digest(p_from xid8, p_up_to xid8)
RETURNS TABLE (n bigint, first_seq bigint, last_seq bigint, rows_hash text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*), MIN(z.seq), MAX(z.seq),
         encode(sha256(convert_to(COALESCE(string_agg(z.h, '' ORDER BY z.txid, z.seq), ''), 'UTF8')), 'hex')
  FROM (
    SELECT l.seq, l.txid, public.ledger_row_hash(l) AS h
    FROM public.activity_ledger l
    WHERE l.txid >= p_from AND l.txid < p_up_to
  ) z;
$$;

CREATE OR REPLACE FUNCTION public.ledger_block_hash(
  p_prev text, p_no bigint, p_from xid8, p_up_to xid8, p_n bigint, p_rows_hash text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(sha256(convert_to(
    p_prev || '|' || p_no::text || '|' || p_from::text || '|' || p_up_to::text || '|' || p_n::text || '|' || p_rows_hash,
    'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.ledger_seal_block()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '300s'
AS $$
DECLARE
  v_last   public.ledger_blocks%ROWTYPE;
  v_from   xid8;
  v_up     xid8;
  v_prev   text;
  v_no     bigint;
  d        record;
  v_hash   text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ledger_seal', 0)) THEN
    RETURN jsonb_build_object('sealed', false, 'reason', 'another seal is running');
  END IF;

  SELECT * INTO v_last FROM public.ledger_blocks ORDER BY block_no DESC LIMIT 1;
  v_from := COALESCE(v_last.up_to_xid, '0'::xid8);
  v_prev := COALESCE(v_last.block_hash, repeat('0', 64));
  v_no   := COALESCE(v_last.block_no, 0) + 1;
  v_up   := pg_snapshot_xmin(pg_current_snapshot());

  IF v_up <= v_from THEN
    RETURN jsonb_build_object('sealed', false, 'reason', 'nothing settled yet');
  END IF;

  SELECT * INTO d FROM public.ledger_range_digest(v_from, v_up);
  IF d.n = 0 THEN
    RETURN jsonb_build_object('sealed', false, 'reason', 'no new entries');
  END IF;

  v_hash := public.ledger_block_hash(v_prev, v_no, v_from, v_up, d.n, d.rows_hash);
  INSERT INTO public.ledger_blocks (block_no, prev_hash, from_xid, up_to_xid, entry_count, first_seq, last_seq, rows_hash, block_hash)
  VALUES (v_no, v_prev, v_from, v_up, d.n, d.first_seq, d.last_seq, d.rows_hash, v_hash);

  RETURN jsonb_build_object('sealed', true, 'block_no', v_no, 'entries', d.n, 'block_hash', v_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_verify_chain()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '600s'
AS $$
DECLARE
  b      record;
  d      record;
  v_prev text := repeat('0', 64);
  v_n    integer := 0;
  v_calc text;
BEGIN
  FOR b IN SELECT * FROM public.ledger_blocks ORDER BY block_no LOOP
    v_n := v_n + 1;
    IF b.block_no <> v_n THEN
      RETURN jsonb_build_object('ok', false, 'blocks_checked', v_n - 1, 'first_bad_block', v_n, 'reason', 'a block is missing');
    END IF;
    IF b.prev_hash <> v_prev THEN
      RETURN jsonb_build_object('ok', false, 'blocks_checked', v_n - 1, 'first_bad_block', b.block_no, 'reason', 'link to the previous block is broken');
    END IF;
    SELECT * INTO d FROM public.ledger_range_digest(b.from_xid, b.up_to_xid);
    IF d.n <> b.entry_count OR d.rows_hash <> b.rows_hash THEN
      RETURN jsonb_build_object('ok', false, 'blocks_checked', v_n - 1, 'first_bad_block', b.block_no,
        'reason', 'entries in this block were changed, added or removed',
        'expected_entries', b.entry_count, 'found_entries', d.n);
    END IF;
    v_calc := public.ledger_block_hash(b.prev_hash, b.block_no, b.from_xid, b.up_to_xid, b.entry_count, b.rows_hash);
    IF v_calc <> b.block_hash THEN
      RETURN jsonb_build_object('ok', false, 'blocks_checked', v_n - 1, 'first_bad_block', b.block_no, 'reason', 'block fingerprint does not match');
    END IF;
    v_prev := b.block_hash;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'blocks_checked', v_n, 'head_hash', v_prev);
END;
$$;

CREATE OR REPLACE FUNCTION public.ledger_integrity_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last   public.ledger_blocks%ROWTYPE;
  v_ver    public.ledger_verifications%ROWTYPE;
  v_anc    public.ledger_anchors%ROWTYPE;
  v_pend   bigint;
BEGIN
  IF NOT public.ledger_is_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO v_last FROM public.ledger_blocks ORDER BY block_no DESC LIMIT 1;
  SELECT * INTO v_ver  FROM public.ledger_verifications ORDER BY verified_at DESC LIMIT 1;
  SELECT * INTO v_anc  FROM public.ledger_anchors ORDER BY anchored_at DESC LIMIT 1;
  SELECT COUNT(*) INTO v_pend FROM public.activity_ledger WHERE txid >= COALESCE(v_last.up_to_xid, '0'::xid8);
  RETURN jsonb_build_object(
    'blocks', (SELECT COUNT(*) FROM public.ledger_blocks),
    'sealed_entries', (SELECT COALESCE(SUM(entry_count), 0) FROM public.ledger_blocks),
    'pending_entries', v_pend,
    'last_block_no', v_last.block_no, 'last_block_hash', v_last.block_hash, 'last_sealed_at', v_last.sealed_at,
    'last_verified_at', v_ver.verified_at, 'last_verified_ok', v_ver.ok,
    'last_anchored_at', v_anc.anchored_at, 'last_anchored_block', v_anc.block_no
  );
END;
$$;

-- 5. Copy functions for the nightly job (service role only) ---------------------------------
CREATE OR REPLACE FUNCTION public.ledger_blocks_for_copy(p_from_block bigint DEFAULT 1)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'block_no', block_no, 'prev_hash', prev_hash, 'from_xid', from_xid::text, 'up_to_xid', up_to_xid::text,
           'entry_count', entry_count, 'rows_hash', rows_hash, 'block_hash', block_hash, 'sealed_at', sealed_at
         ) ORDER BY block_no), '[]'::jsonb)
    FROM public.ledger_blocks
   WHERE block_no >= p_from_block;
$$;

CREATE OR REPLACE FUNCTION public.ledger_blocks_export(
  p_from_block bigint, p_to_block bigint,
  p_after_block bigint DEFAULT 0, p_after_txid text DEFAULT '0', p_after_seq bigint DEFAULT 0,
  p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '120s'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'block_no', z.block_no, 'txid', z.txid::text, 'seq', z.seq, 'h', z.h, 'e', z.e
         ) ORDER BY z.block_no, z.txid, z.seq), '[]'::jsonb)
    FROM (
      SELECT b.block_no, l.txid, l.seq, public.ledger_row_hash(l) AS h, to_jsonb(l) AS e
        FROM public.ledger_blocks b
        JOIN public.activity_ledger l ON l.txid >= b.from_xid AND l.txid < b.up_to_xid
       WHERE b.block_no BETWEEN p_from_block AND p_to_block
         AND (b.block_no, l.txid, l.seq) > (p_after_block, p_after_txid::xid8, p_after_seq)
       ORDER BY b.block_no, l.txid, l.seq
       LIMIT p_limit
    ) z;
$$;

REVOKE EXECUTE ON FUNCTION public.ledger_seal_block() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_verify_chain() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_blocks_for_copy(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_blocks_export(bigint, bigint, bigint, text, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_seal_block() TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_verify_chain() TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_blocks_for_copy(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.ledger_blocks_export(bigint, bigint, bigint, text, bigint, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.ledger_integrity_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_integrity_status() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_can_view(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ledger_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_can_view(text), public.ledger_is_admin() TO authenticated, service_role;

-- 6. Which tables are recorded -----------------------------------------------------------------
-- Excluded tables are limited to caches, queues, staging tables and raw logs that
-- already have their own record. The reason for each is written down.
INSERT INTO public.ledger_excluded_tables (table_name, reason) VALUES
  ('fervent_dashboard_cache', 'Cache rebuilt from fervent_data_repository'),
  ('fervent_repo_match_keys', 'Derived search/dedup index (about 1.1M rows) rebuilt from fervent_data_repository'),
  ('import_staging', 'Staging rows for an import; the import itself is recorded in import_jobs / bulk_import_history'),
  ('import_skipped_rows', 'Rows an import skipped; the import itself is recorded in import_jobs'),
  ('operation_queue', 'Work queue; the outcome is recorded in the tables the work changes'),
  ('pipeline_action_queue', 'Work queue; the outcome is recorded in pipeline_movement_history and the tables the work changes'),
  ('service_usage_logs', 'Raw usage meter log'),
  ('api_key_usage_logs', 'Raw API request log'),
  ('error_logs', 'Raw application error log'),
  ('rate_limit_log', 'Raw rate-limit counter log'),
  ('wa_status_debug', 'Debug capture'),
  ('whatsapp_logs', 'Raw provider log; each message is recorded in whatsapp_messages'),
  ('outbound_webhook_logs', 'Raw delivery log'),
  ('contact_enrichment_logs', 'Raw enrichment log; the resulting contact changes are recorded in contacts'),
  ('connector_logs', 'Raw connector log'),
  ('platform_email_sending_list', 'Bulk reference list (about 61K rows) loaded in one go; not a user record'),
  ('user_module_usage', 'Page-visit counters'),
  ('public_otp_verifications', 'One-time codes and short-lived credentials; never written to the ledger'),
  ('notifications', 'Derived feed of events that are already recorded in the tables that caused them'),
  ('chat_conversations', 'Private staff chat; not for a management ledger'),
  ('chat_messages', 'Private staff chat; not for a management ledger'),
  ('chat_participants', 'Private staff chat; not for a management ledger'),
  ('chat_message_reactions', 'Private staff chat; not for a management ledger')
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;

-- Per-table overrides: events recorded ('IUD' = insert / update / delete) and columns
-- left out because they are system counters nobody edited.
DO $attach$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname::text AS tbl,
           COALESCE(o.ev, 'IUD')      AS ev,
           COALESCE(o.excl, '')       AS excl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN (VALUES
             ('__none__', 'IUD', ''),
             ('fervent_data_repository', 'UD', ''),
             ('bulk_import_history', 'IUD', 'failed_records,processed_records,current_batch'),
             ('import_jobs', 'IUD', 'duplicate_count,processed_rows,success_count,error_count,updated_count'),
             ('email_bulk_campaigns', 'IUD', 'sent_count,failed_count,pending_count'),
             ('sms_bulk_campaigns', 'IUD', 'sent_count,failed_count,pending_count'),
             ('whatsapp_bulk_campaigns', 'IUD', 'sent_count,failed_count,pending_count'),
             ('email_automation_rules', 'IUD', 'total_sent')
           ) AS o(tbl, ev, excl) ON o.tbl = c.relname
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname NOT IN ('activity_ledger', 'ledger_blocks', 'ledger_anchors', 'ledger_verifications',
                             'ledger_excluded_tables', 'ledger_tracking_started')
       AND NOT EXISTS (SELECT 1 FROM public.ledger_excluded_tables e WHERE e.table_name = c.relname)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_ledger_row ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_ledger_row AFTER %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ledger_log_row_change(%L, %L, %L, %L)',
      (SELECT string_agg(CASE ch WHEN 'I' THEN 'INSERT' WHEN 'U' THEN 'UPDATE' WHEN 'D' THEN 'DELETE' END, ' OR ')
         FROM regexp_split_to_table(r.ev, '') AS ch),
      r.tbl, split_part(r.tbl, '_', 1), 'admin', 'false', r.excl
    );
  END LOOP;
END
$attach$;

-- Coverage check: both must always return no rows.
CREATE OR REPLACE FUNCTION public.ledger_untracked_tables()
RETURNS TABLE (table_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.relname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (
           SELECT 1 FROM pg_trigger t
            WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname = 'trg_ledger_row')
     AND NOT EXISTS (SELECT 1 FROM public.ledger_excluded_tables e WHERE e.table_name = c.relname)
     AND c.relname NOT IN ('activity_ledger', 'ledger_blocks', 'ledger_anchors', 'ledger_verifications',
                           'ledger_excluded_tables', 'ledger_tracking_started')
   ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION public.ledger_untracked_tables() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_untracked_tables() TO authenticated, service_role;

-- A table can be both recorded and listed as excluded only by mistake.
CREATE OR REPLACE FUNCTION public.ledger_excluded_but_tracked()
RETURNS TABLE (table_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.table_name::text
    FROM public.ledger_excluded_tables e
    JOIN pg_class c ON c.relname = e.table_name AND c.relnamespace = 'public'::regnamespace
    JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = 'trg_ledger_row' AND NOT t.tgisinternal
   ORDER BY 1;
$$;
REVOKE EXECUTE ON FUNCTION public.ledger_excluded_but_tracked() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_excluded_but_tracked() TO authenticated, service_role;

-- 7. Access trail ------------------------------------------------------------------------------
INSERT INTO public.ledger_tracking_started (kind, started_at, note) VALUES
  ('row_changes', now(), 'Every create / update / delete on the recorded tables; earlier changes cannot be rebuilt'),
  ('access',      now(), 'Report opens and exports, recorded by the app'),
  ('login',       now() - interval '30 days', 'Sign-ins; starts at the oldest session still held by the auth system')
ON CONFLICT (kind) DO NOTHING;

-- Called by the app for events only the app can see.
CREATE OR REPLACE FUNCTION public.ledger_log_access(p_event text, p_target text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target text := left(COALESCE(p_target, ''), 300);
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF p_event NOT IN ('report_open', 'export', 'file_upload', 'file_download', 'file_delete', 'file_link', 'record_view') THEN
    RAISE EXCEPTION 'unknown access event %', p_event;
  END IF;
  IF p_details IS NULL OR length(p_details::text) > 4000 THEN p_details := '{}'::jsonb; END IF;
  -- Reloading the same thing within a minute is one visit.
  IF p_event IN ('report_open', 'record_view') AND EXISTS (
       SELECT 1 FROM activity_ledger
        WHERE actor_id = v_uid AND event_type = p_event AND entity_label = v_target
          AND occurred_at > now() - interval '60 seconds') THEN
    RETURN;
  END IF;
  INSERT INTO activity_ledger (
    occurred_at, module, entity_type, entity_id, event_type, actor_id,
    entity_label, visibility, details, source_table, source_id
  ) VALUES (
    now(), 'access', 'access', v_uid, p_event, v_uid,
    v_target, 'admin', jsonb_build_object('target', v_target) || p_details, 'access', gen_random_uuid()
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ledger_log_access(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_log_access(text, text, jsonb) TO authenticated;

-- Sign-ins: the auth system's own audit log is off by default on Supabase, so new
-- sessions are copied from auth.sessions every 5 minutes (one session = one sign-in).
-- Failed sign-ins never reach the database and are not recorded.
CREATE OR REPLACE FUNCTION public.ledger_capture_logins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO activity_ledger (
    occurred_at, module, entity_type, entity_id, event_type, actor_id,
    entity_label, visibility, details, source_table, source_id, is_backfill
  )
  SELECT s.created_at, 'access', 'user', s.user_id, 'login', s.user_id,
         (SELECT u.email FROM auth.users u WHERE u.id = s.user_id), 'admin',
         jsonb_build_object('ip', host(s.ip), 'user_agent', left(s.user_agent, 300), 'aal', s.aal),
         'auth.sessions', s.id, s.created_at < now() - interval '10 minutes'
    FROM auth.sessions s
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ledger_capture_logins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_capture_logins() TO service_role;

-- 8. Reports for a closed period (as-at) ----------------------------------------------------
-- Machinery only: a period report runs against temporary copies of the tables it reads,
-- rebuilt as they stood on the period's last day (deleted rows restored, later edits
-- undone). A report opts in by moving its calculation into report_asat.<name>_core and
-- wrapping it with begin() / finish(). Periods ending today or later read the live tables.
CREATE SCHEMA IF NOT EXISTS report_asat;
GRANT USAGE ON SCHEMA report_asat TO authenticated, service_role;

CREATE OR REPLACE FUNCTION report_asat.as_at()
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('ledger.as_at', true), '')::timestamptz $$;

CREATE OR REPLACE FUNCTION report_asat.today()
RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT COALESCE((report_asat.as_at() AT TIME ZONE 'Asia/Kolkata')::date, CURRENT_DATE) $$;

CREATE OR REPLACE FUNCTION report_asat.now_()
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(report_asat.as_at(), now()) $$;

CREATE OR REPLACE FUNCTION report_asat.touched(p_table text, p_at timestamptz)
RETURNS TABLE (entity_id uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT l.entity_id
    FROM public.activity_ledger l
   WHERE l.entity_type = p_table AND l.entity_id IS NOT NULL
     AND l.event_type IN ('created', 'updated', 'deleted')
     AND l.occurred_at > p_at
$$;

CREATE OR REPLACE FUNCTION report_asat.rows_delta(p_table text, p_at timestamptz)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY EXECUTE format($f$
    WITH ev AS (
      SELECT entity_id, event_type, occurred_at, details
        FROM activity_ledger
       WHERE entity_type = %1$L AND entity_id IS NOT NULL
         AND event_type IN ('created', 'updated', 'deleted')
    ),
    made AS (
      SELECT entity_id, min(occurred_at) AS at FROM ev WHERE event_type = 'created' GROUP BY 1
    ),
    patch AS (
      SELECT entity_id, jsonb_object_agg(key, old) AS p
        FROM (
          SELECT DISTINCT ON (e.entity_id, c.key) e.entity_id, c.key, c.value -> 'old' AS old
            FROM ev e, LATERAL jsonb_each(e.details -> 'changes') c
           WHERE e.event_type = 'updated' AND e.occurred_at > %2$L
           ORDER BY e.entity_id, c.key, e.occurred_at ASC
        ) z
       GROUP BY entity_id
    ),
    gone AS (
      SELECT DISTINCT ON (entity_id) entity_id, details -> 'snapshot' AS snap, occurred_at
        FROM ev WHERE event_type = 'deleted'
       ORDER BY entity_id, occurred_at DESC
    ),
    touched AS (
      SELECT DISTINCT entity_id FROM ev WHERE occurred_at > %2$L
    ),
    live AS (
      SELECT to_jsonb(t) AS j, t.id FROM public.%3$I t WHERE t.id IN (SELECT entity_id FROM touched)
    )
    SELECT CASE
             WHEN COALESCE(m.at <= %2$L, (l.j ->> 'created_at')::timestamptz <= %2$L, true)
             THEN l.j || COALESCE(pt.p, '{}'::jsonb)
             ELSE l.j
           END
      FROM live l
      LEFT JOIN made m ON m.entity_id = l.id
      LEFT JOIN patch pt ON pt.entity_id = l.id
    UNION ALL
    SELECT g.snap || COALESCE(pt.p, '{}'::jsonb)
      FROM gone g
      LEFT JOIN made m ON m.entity_id = g.entity_id
      LEFT JOIN patch pt ON pt.entity_id = g.entity_id
     WHERE g.occurred_at > %2$L
       AND g.snap IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM live l WHERE l.id = g.entity_id)
       AND COALESCE(m.at <= %2$L, (g.snap ->> 'created_at')::timestamptz <= %2$L, true)
  $f$, p_table, p_at, p_table);
END;
$$;

CREATE OR REPLACE FUNCTION report_asat.rows(p_table text, p_at timestamptz)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY EXECUTE format($f$
    WITH tc AS MATERIALIZED (SELECT entity_id FROM report_asat.touched(%1$L, %2$L))
    SELECT to_jsonb(t) FROM public.%1$I t WHERE NOT EXISTS (SELECT 1 FROM tc WHERE tc.entity_id = t.id)
    UNION ALL
    SELECT d FROM report_asat.rows_delta(%1$L, %2$L) AS d
  $f$, p_table, p_at);
END;
$$;

CREATE OR REPLACE FUNCTION report_asat.begin(p_end date, p_tables text[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_at  timestamptz;
  t     text;
  c     text;
BEGIN
  PERFORM report_asat.finish();
  IF p_end IS NULL OR p_end >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RETURN;
  END IF;
  v_at := ((p_end + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 microsecond';
  PERFORM set_config('ledger.as_at', v_at::text, true);
  PERFORM set_config('ledger.as_at_tables', array_to_string(p_tables, ','), true);
  FOREACH t IN ARRAY p_tables LOOP
    EXECUTE format(
      'CREATE TEMP TABLE %1$I ON COMMIT DROP AS '
      || 'WITH tc AS MATERIALIZED (SELECT entity_id FROM report_asat.touched(%1$L, %2$L)) '
      || 'SELECT x.* FROM public.%1$I x WHERE NOT EXISTS (SELECT 1 FROM tc WHERE tc.entity_id = x.id) '
      || 'UNION ALL '
      || 'SELECT (jsonb_populate_record(NULL::public.%1$I, r.j)).* FROM report_asat.rows_delta(%1$L, %2$L) AS r(j)',
      t, v_at);
    FOR c IN
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t
         AND column_name IN ('id', 'project_id', 'user_id', 'client_id', 'ticket_id', 'task_id', 'claim_id', 'team_id')
    LOOP
      EXECUTE format('CREATE INDEX ON pg_temp.%I (%I)', t, c);
    END LOOP;
    EXECUTE format('ANALYZE pg_temp.%I', t);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION report_asat.finish()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY string_to_array(COALESCE(current_setting('ledger.as_at_tables', true), ''), ',') LOOP
    IF t <> '' THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', t);
    END IF;
  END LOOP;
  PERFORM set_config('ledger.as_at', '', true);
  PERFORM set_config('ledger.as_at_tables', '', true);
END;
$$;
GRANT EXECUTE ON FUNCTION report_asat.rows_delta(text, timestamptz), report_asat.touched(text, timestamptz),
                          report_asat.rows(text, timestamptz) TO authenticated, service_role;

-- 9. Sign-ins so far, then the genesis block --------------------------------------------------
SELECT public.ledger_capture_logins();
SELECT public.ledger_seal_block();
