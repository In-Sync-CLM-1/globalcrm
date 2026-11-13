-- Replace the old product name in live stored text. Past records of what was
-- sent, audit logs and WhatsApp templates are not touched, and neither are link
-- or file-path columns. Triggers are off so that no notification, webhook or
-- automation fires for these edits. Idempotent.
CREATE OR REPLACE FUNCTION pg_temp.vs(t text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  t := replace(t, 'vendorverification.in-sync.co.in', 'vendor.in-sync.co.in');
  t := replace(t, '/products/vendor-verification', '/products/vendorsync');
  t := regexp_replace(t, 'Vendor Verification|VENDOR VERIFICATION|Vendor-Sync|VendorVerification|Vendorverification', 'Vendorsync', 'g');
  t := regexp_replace(t, '\mvendor verifications\M', 'vendor checks', 'g');
  t := regexp_replace(t, '\mVendor verifications\M', 'Vendor checks', 'g');
  t := regexp_replace(t, '\mvendor verification\M', 'vendor onboarding', 'g');
  t := regexp_replace(t, '\mVendor verification\M', 'Vendor onboarding', 'g');
  t := regexp_replace(t, '\mvendorverification\M', 'vendorsync', 'g');
  RETURN t;
END $fn$;

DO $$
DECLARE r record; tb text;
BEGIN
  FOREACH tb IN ARRAY ARRAY['email_templates', 'ai_call_scripts', 'ai_daily_insights', 'ai_script_proposals'] LOOP
    IF to_regclass('public.' || quote_ident(tb)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', tb);
    FOR r IN SELECT c.column_name, format_type(a.atttypid, a.atttypmod) AS ty
             FROM information_schema.columns c
             JOIN pg_attribute a ON a.attrelid = ('public.' || quote_ident(tb))::regclass AND a.attname = c.column_name
             WHERE c.table_schema = 'public' AND c.table_name = tb
               AND c.data_type IN ('text', 'character varying', 'jsonb', 'ARRAY')
               AND c.column_name !~ '(url|urn|_key|key_|hash|token|status|email|phone)'
               AND c.column_name <> 'emailed_to'
    LOOP
      EXECUTE format(
        'UPDATE public.%I SET %I = pg_temp.vs(%I::text)::%s WHERE %I::text ~* %L AND pg_temp.vs(%I::text) <> %I::text',
        tb, r.column_name, r.column_name, r.ty, r.column_name, 'vendor[ _-]*verif|vendor-sync', r.column_name, r.column_name);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', tb);
  END LOOP;
END $$;
