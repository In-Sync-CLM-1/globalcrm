-- Replace the old product name in stored values. The code in this release
-- reads 'vendorsync', so this has to ship together with it. WhatsApp template
-- names registered with Meta are not touched. Idempotent.
DO $$
DECLARE r record;
BEGIN
  -- Every product column: contacts, ai_call_scripts, ai_daily_insights,
  -- lead_assignment_rules and any other table carrying the value.
  FOR r IN SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t USING (table_schema, table_name)
           WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
             AND c.column_name IN ('product', 'product_name')
             AND c.data_type IN ('text', 'character varying')
  LOOP
    EXECUTE format(
      $f$UPDATE public.%I SET %I = 'Vendorsync' WHERE lower(regexp_replace(%I, '\s', '', 'g')) = 'vendorverification'$f$,
      r.table_name, r.column_name, r.column_name);
  END LOOP;

  -- Wording inside call scripts and email templates, including template names.
  FOR r IN SELECT c.table_name, c.column_name, c.data_type
           FROM information_schema.columns c
           WHERE c.table_schema = 'public'
             AND c.table_name IN ('ai_call_scripts', 'email_templates')
             AND c.data_type IN ('text', 'character varying', 'jsonb')
  LOOP
    IF r.data_type = 'jsonb' THEN
      EXECUTE format(
        $f$UPDATE public.%I SET %I = replace(%I::text, 'Vendor Verification', 'Vendorsync')::jsonb WHERE %I::text LIKE '%%Vendor Verification%%'$f$,
        r.table_name, r.column_name, r.column_name, r.column_name);
    ELSE
      EXECUTE format(
        $f$UPDATE public.%I SET %I = replace(%I, 'Vendor Verification', 'Vendorsync') WHERE %I LIKE '%%Vendor Verification%%'$f$,
        r.table_name, r.column_name, r.column_name, r.column_name);
    END IF;
  END LOOP;
END $$;
