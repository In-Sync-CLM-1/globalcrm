-- Replace the old product name in stored values. The code in this release
-- reads 'vendorsync', so this has to ship together with it. WhatsApp templates
-- (communication_templates) and past records of sent messages are not touched.
-- The contact rows are relabelled with their triggers off: changing product
-- would otherwise reassign owners and fire webhooks, automations and enrichment
-- for every row. Idempotent.
ALTER TABLE public.contacts DISABLE TRIGGER USER;

UPDATE public.contacts
   SET product = 'Vendorsync'
 WHERE lower(regexp_replace(product, '\s', '', 'g')) = 'vendorverification';

UPDATE public.contacts
   SET source = regexp_replace(source, '^vendorverification', 'vendorsync')
 WHERE source LIKE 'vendorverification%';

ALTER TABLE public.contacts ENABLE TRIGGER USER;

UPDATE public.lead_assignment_rules
   SET product = 'Vendorsync'
 WHERE lower(regexp_replace(product, '\s', '', 'g')) = 'vendorverification';

UPDATE public.ai_daily_insights
   SET product = 'Vendorsync'
 WHERE lower(regexp_replace(product, '\s', '', 'g')) = 'vendorverification';

-- Wording inside call scripts and email templates, including template names.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.table_name, c.column_name, c.data_type
           FROM information_schema.columns c
           WHERE c.table_schema = 'public'
             AND c.table_name IN ('ai_call_scripts', 'email_templates')
             AND c.data_type IN ('text', 'character varying', 'jsonb')
  LOOP
    IF r.data_type = 'jsonb' THEN
      EXECUTE format(
        $f$UPDATE public.%I SET %I = regexp_replace(%I::text, 'Vendor Verification|Vendor-Sync|Vendorverification', 'Vendorsync', 'g')::jsonb WHERE %I::text ~ 'Vendor Verification|Vendor-Sync|Vendorverification'$f$,
        r.table_name, r.column_name, r.column_name, r.column_name);
    ELSE
      EXECUTE format(
        $f$UPDATE public.%I SET %I = regexp_replace(%I, 'Vendor Verification|Vendor-Sync|Vendorverification', 'Vendorsync', 'g') WHERE %I ~ 'Vendor Verification|Vendor-Sync|Vendorverification'$f$,
        r.table_name, r.column_name, r.column_name, r.column_name);
    END IF;
  END LOOP;
END $$;

-- The demo-booked notification matches on the product value. Edit it where it
-- stands, keeping the rest of the function as it is in the database.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_demo_booked';
  IF d IS NOT NULL AND d LIKE '%vendorverification%' THEN
    d := replace(d, $s$= 'vendorverification' then 'Vendor Verification'$s$, $s$= 'vendorsync' then 'Vendorsync'$s$);
    IF d LIKE '%vendorverification%' OR d LIKE '%Vendor Verification%' THEN
      RAISE EXCEPTION 'fn_demo_booked still contains the old name';
    END IF;
    EXECUTE d;
  END IF;
END $$;
