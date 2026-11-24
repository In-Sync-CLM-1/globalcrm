-- Exports made by the database instead of the browser.
-- request_export() records the job, a background worker writes the file in one pass under the requester's own
-- access rules, and get_export_chunk() hands the file back in pieces. Files are removed after 7 days.
--
-- Fervent's own database always uses this. Every other export uses it once organizations.settings.db_exports.enabled
-- is true for the organisation.

-- ------------------------------------------------------------------ tables
CREATE TABLE public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,   -- empty only for a platform admin's whole-table export
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('fervent_repository','contacts','contact_search','whatsapp_messages','whatsapp_recipients','table')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_name text NOT NULL,
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','ready','failed','expired')),
  row_count integer,
  byte_count bigint,
  chunk_count integer,
  error text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz,
  CHECK (org_id IS NOT NULL OR kind = 'table')
);
CREATE INDEX idx_export_jobs_org ON public.export_jobs (org_id, created_at DESC);
CREATE INDEX idx_export_jobs_preparing ON public.export_jobs (created_at) WHERE status = 'preparing';

CREATE TABLE public.export_job_chunks (
  job_id uuid NOT NULL REFERENCES public.export_jobs(id) ON DELETE CASCADE,
  chunk_no integer NOT NULL,
  content text,
  content_locked bytea,            -- used instead of content for organisations with personal-data protection
  PRIMARY KEY (job_id, chunk_no)
);

CREATE TABLE public.export_downloads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.export_jobs(id) ON DELETE CASCADE,
  user_id uuid,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_job_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_downloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.export_jobs, public.export_job_chunks, public.export_downloads FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, org_id, requested_by, kind, params, file_name, status, row_count, byte_count, chunk_count, error,
              created_at, finished_at, expires_at) ON public.export_jobs TO authenticated;

INSERT INTO public.ledger_excluded_tables (table_name, reason) VALUES
  ('export_job_chunks', 'Pieces of an export file, removed after 7 days; the export itself is recorded in export_jobs')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------ access
CREATE FUNCTION public.export_user_is_org_admin(_user uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user AND org_id = _org AND role IN ('admin','super_admin') AND COALESCE(is_active, true))
$$;

CREATE FUNCTION public.export_org_protected(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT settings->'pii_protection'->>'enabled' = 'true' FROM public.organizations WHERE id = _org), false)
$$;

-- Is the switch on for the signed-in user? A platform admin who sits in no organisation follows any organisation's switch.
CREATE FUNCTION public.db_exports_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o
                  WHERE o.settings->'db_exports'->>'enabled' = 'true'
                    AND (o.id = public.get_user_org_id(auth.uid())
                         OR (public.get_user_org_id(auth.uid()) IS NULL AND public.is_platform_admin(auth.uid()))))
$$;

-- Own exports, plus the whole organisation's for its admins. Fervent's history was always shared with the whole team,
-- so its list (not the files) stays visible to them.
CREATE POLICY "See own exports, admins see the organisation's" ON public.export_jobs FOR SELECT TO authenticated
USING (
  (requested_by = (SELECT auth.uid()) AND (kind = 'table' OR org_id = public.get_user_org_id((SELECT auth.uid()))))
  OR (kind <> 'table' AND org_id = public.get_user_org_id((SELECT auth.uid()))
      AND (kind = 'fervent_repository' OR public.export_user_is_org_admin((SELECT auth.uid()), org_id)))
);

-- ------------------------------------------------------------------ text helpers
CREATE FUNCTION public.export_csv(_v text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN $1 IS NULL THEN ''
              WHEN $1 ~ E'[",\r\n]' THEN '"' || replace($1, '"', '""') || '"'
              ELSE $1 END
$$;

-- "03/24/2026, 05:11:47 PM", the way the exports have always shown dates, in the reader's time zone.
CREATE FUNCTION public.export_date(_v timestamptz, _tz text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT to_char(_v AT TIME ZONE _tz, 'MM/DD/YYYY, HH12:MI:SS AM') $$;

CREATE FUNCTION public.export_turnover(_usd_million numeric, _raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN $1 IS NULL THEN COALESCE($2, '')
    WHEN $1 >= 1000 THEN '$' || CASE WHEN $1 / 1000 = trunc($1 / 1000) THEN trunc($1 / 1000)::text ELSE round($1 / 1000, 1)::text END || 'B'
    ELSE '$' || CASE WHEN $1 = trunc($1) THEN trunc($1)::text ELSE round($1, 2)::text END || 'M' END
$$;

-- An ilike pattern the way the screens' own searches read it (* counts as %).
CREATE FUNCTION public.export_like(_v text, _before boolean, _after boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _before THEN '%' ELSE '' END || replace(_v, '*', '%') || CASE WHEN _after THEN '%' ELSE '' END
$$;

CREATE FUNCTION public.export_text_list(_v jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(_v) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(_v)) ELSE '{}'::text[] END
$$;

CREATE FUNCTION public.export_tables() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['profiles','user_roles','auth_users','organizations','org_invites','org_feature_access','org_business_hours',
    'contacts','contact_activities','contact_emails','contact_phones','contact_custom_fields','pipeline_stages',
    'clients','client_invoices','client_documents','client_alternate_contacts',
    'communication_templates','email_templates','email_conversations','whatsapp_messages','sms_messages',
    'email_bulk_campaigns','email_campaign_recipients','whatsapp_bulk_campaigns','whatsapp_campaign_recipients',
    'sms_bulk_campaigns','sms_campaign_recipients','campaign_analytics','campaign_insights',
    'tasks','calendar_shares','activity_participants',
    'call_logs','call_dispositions','call_sub_dispositions','agent_call_sessions',
    'support_tickets','support_ticket_comments','support_ticket_history',
    'email_automation_rules','email_automation_executions','automation_ab_tests','automation_approvals','automation_performance_daily',
    'forms','connector_logs','outbound_webhooks','outbound_webhook_logs',
    'teams','team_members','designations','reporting_hierarchy','custom_fields','blog_posts',
    'api_keys','api_key_usage_logs',
    'organization_subscriptions','subscription_invoices','wallet_transactions','service_usage_logs','subscription_pricing',
    'bulk_import_history','notifications','external_entities','approval_types','approval_rules',
    'fervent_data_repository','chat_conversations','chat_messages','chat_participants',
    'monthly_actuals_snapshot','revenue_goals','carry_forward_snapshot','contact_lead_scores',
    'email_suppression_list','email_unsubscribes']
$$;

-- ------------------------------------------------------------------ the query behind each export
-- Returns the header line and a query giving (rn, line). Every value that comes from the screen is quoted with %L and
-- every column name comes from a list in here. With _protected, the query takes a uuid[] ($1) of contact ids and reads
-- the full phone and email through reveal_contacts_pii(), which records each reveal.
CREATE FUNCTION public.export_build(_kind text, _params jsonb, _org uuid, _protected boolean,
                                    OUT header text, OUT body text, OUT ids_query text)
LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  f jsonb := COALESCE(_params->'filters', '{}'::jsonb);
  ids uuid[];
  w text := '';
  ord text;
  tz text := COALESCE(_params->>'tz', 'Asia/Kolkata');
  exact boolean;
  cols text[][];
  labels text[];
  wanted text[];
  exprs text[];
  heads text[];
  i int;
  x text;
  y text;
  c jsonb;
  cf record;
  parts text[];
  src text;
  op text;
  fld text;
  val text;
BEGIN
  IF tz !~ '^[A-Za-z0-9_+/-]{1,60}$' OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN tz := 'Asia/Kolkata'; END IF;
  IF jsonb_typeof(_params->'ids') = 'array' AND jsonb_array_length(_params->'ids') > 0 THEN
    ids := ARRAY(SELECT jsonb_array_elements_text(_params->'ids')::uuid);
  END IF;

  -- ---------------------------------------------------------- Fervent database
  IF _kind = 'fervent_repository' THEN
    cols := ARRAY[
      ['Unique ID','t.unique_id'],['Status',$q$CASE WHEN t.upload_status = 'existing' THEN 'Updated' ELSE 'Fresh' END$q$],
      ['Source',$q$CASE t.source_type WHEN 'international' THEN 'International' WHEN 'domestic' THEN 'Domestic' ELSE '' END$q$],
      ['DB Sourced Year','t.db_sourced_year::text'],['UCDB Status','t.ucdb_status'],['Company Name','t.company_name'],
      ['First Name','t.first_name'],['Last Name','t.last_name'],['Designation','t.designation'],['Department','t.department'],
      ['Designation Level','t.designation_level'],['City','t.city'],['State','t.state'],['Country','t.country'],['STD Code','t.std_code'],
      ['Phone 1','t.mobile_number_1'],['Phone 2','t.mobile_number_2'],['Phone 3','t.direct_number'],['Phone 4','t.phone_number'],
      ['Official Email ID','t.official_email'],['Personal Email ID 1','t.personal_email_1'],['Personal Email ID 2','t.personal_email_2'],
      ['Contact LinkedIn ID','t.linkedin_url'],['Domain Name','t.domain_name'],['Website','t.website'],['Industry','t.industry'],
      ['SubIndustry','t.sub_industry'],['Employee Size','t.employee_size'],
      ['Turnover','public.export_turnover(t.turnover_usd_million, t.turnover)'],['Company LinkedIn ID','t.company_linkedin_url']];
    wanted := public.export_text_list(_params->'fields');
    FOR i IN 1 .. array_length(cols, 1) LOOP
      IF cardinality(wanted) = 0 OR cols[i][1] = ANY (wanted) THEN
        heads := heads || cols[i][1];
        exprs := exprs || cols[i][2];
      END IF;
    END LOOP;
    IF exprs IS NULL THEN RAISE EXCEPTION 'Pick at least one field to export'; END IF;
    src := 'public.fervent_data_repository t';
    w := format('t.org_id = %L', _org);

    IF ids IS NOT NULL THEN
      w := w || format(' AND t.id = ANY (%L::uuid[])', ids);
    ELSIF jsonb_typeof(_params->'advanced') = 'object' THEN
      parts := '{}';
      FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(_params->'advanced'->'conditions', '[]'::jsonb)) LOOP
        fld := c->>'field'; val := btrim(COALESCE(c->>'value', ''));
        CONTINUE WHEN val = '' OR fld IS NULL OR NOT (fld = ANY (ARRAY['company_name','first_name','last_name','designation','department',
          'designation_level','city','state','country','std_code','mobile_number_1','mobile_number_2','direct_number','phone_number',
          'official_email','personal_email_1','personal_email_2','linkedin_url','domain_name','website','industry','sub_industry',
          'employee_size','turnover','company_linkedin_url','ucdb_status','unique_id']));
        parts := parts || format(CASE WHEN c->>'op' = 'not_contains' THEN 'NOT t.%I ILIKE %L' ELSE 't.%I ILIKE %L' END,
                                 fld, public.export_like(val, true, true));
      END LOOP;
      IF cardinality(parts) > 0 THEN
        w := w || ' AND (' || array_to_string(parts, CASE WHEN _params->'advanced'->>'mode' = 'any' THEN ' OR ' ELSE ' AND ' END) || ')';
      END IF;
    ELSE
      exact := f->>'matchMode' = 'exact';
      IF COALESCE(f->>'search', '') <> '' THEN
        x := public.export_like(f->>'search', NOT exact, NOT exact);
        w := w || format(' AND (t.first_name ILIKE %1$L OR t.last_name ILIKE %1$L OR t.company_name ILIKE %1$L)', x);
      END IF;
      FOR x, y IN SELECT * FROM (VALUES ('city','city'),('state','state'),('country','country'),('industry','industry'),
          ('subIndustry','sub_industry'),('designation','designation'),('designationLevel','designation_level'),
          ('department','department'),('ucdbStatus','ucdb_status'),('employeeSize','employee_size')) m(a, b) LOOP
        IF cardinality(public.export_text_list(f->x)) > 0 THEN
          w := w || format(' AND t.%I = ANY (%L::text[])', y, public.export_text_list(f->x));
        END IF;
      END LOOP;
      IF COALESCE(f->>'dbSourcedYear', '') <> '' THEN w := w || format(' AND t.db_sourced_year = %L::int', f->>'dbSourcedYear'); END IF;
      IF COALESCE(f->>'website', '') <> '' THEN w := w || format(' AND t.website ILIKE %L', public.export_like(f->>'website', NOT exact, NOT exact)); END IF;
      IF COALESCE(f->>'domainName', '') <> '' THEN w := w || format(' AND t.domain_name ILIKE %L', public.export_like(f->>'domainName', NOT exact, NOT exact)); END IF;
      IF COALESCE(f->>'turnoverMinUsdM', '') <> '' THEN w := w || format(' AND t.turnover_usd_million >= %L::numeric', f->>'turnoverMinUsdM'); END IF;
      IF COALESCE(f->>'turnoverMaxUsdM', '') <> '' THEN w := w || format(' AND t.turnover_usd_million <= %L::numeric', f->>'turnoverMaxUsdM'); END IF;
    END IF;
    fld := COALESCE(_params->'sort'->>'field', 'created_at');
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fervent_data_repository' AND column_name = fld) THEN
      fld := 'created_at';
    END IF;
    ord := format('t.%I %s NULLS LAST, t.id', fld, CASE WHEN _params->'sort'->>'ascending' = 'true' THEN 'ASC' ELSE 'DESC' END);

  -- ---------------------------------------------------------- contacts and contact search
  ELSIF _kind IN ('contacts', 'contact_search') THEN
    src := 'public.contacts t LEFT JOIN public.pipeline_stages s ON s.id = t.pipeline_stage_id';
    w := format('t.org_id = %L', _org);
    IF _protected THEN src := src || ' LEFT JOIN public.reveal_contacts_pii($1) r ON r.id = t.id'; END IF;
    x := CASE WHEN _protected THEN 'r.email' ELSE 't.email' END;
    y := CASE WHEN _protected THEN 'r.phone' ELSE 't.phone' END;

    IF _kind = 'contacts' THEN
      heads := ARRAY['First Name','Last Name','Email','Phone','Company','Job Title','Status','Source','Pipeline Stage','Enrichment Status','Created At'];
      exprs := ARRAY['t.first_name','t.last_name',x,y,'t.company','t.job_title','t.status::text','t.source','s.name',
                     't.enrichment_status::text', format('public.export_date(t.created_at, %L)', tz)];
      IF ids IS NOT NULL THEN
        w := w || format(' AND t.id = ANY (%L::uuid[])', ids);
      ELSE
        IF COALESCE(f->>'name', '') <> '' THEN
          w := w || format(' AND (t.first_name ILIKE %1$L OR t.last_name ILIKE %1$L)', public.export_like(f->>'name', true, true));
        END IF;
        FOR fld, val IN SELECT * FROM (VALUES ('email','email'),('phone','phone'),('company','company'),('city','city'),
            ('source','source'),('jobTitle','job_title')) m(a, b) LOOP
          IF COALESCE(f->>fld, '') <> '' THEN w := w || format(' AND t.%I ILIKE %L', val, public.export_like(f->>fld, true, true)); END IF;
        END LOOP;
        IF COALESCE(f->>'status', '') <> '' THEN w := w || format(' AND t.status::text = %L', f->>'status'); END IF;
        IF COALESCE(f->>'stageId', '') <> '' THEN w := w || format(' AND t.pipeline_stage_id = %L::uuid', f->>'stageId'); END IF;
        IF COALESCE(f->>'industryType', '') <> '' THEN w := w || format(' AND t.industry_type = %L', f->>'industryType'); END IF;
        IF COALESCE(f->>'createdBy', '') <> '' THEN w := w || format(' AND t.created_by = %L::uuid', f->>'createdBy'); END IF;
      END IF;
    ELSE
      heads := ARRAY['First Name','Last Name','Email','Phone','Company','Job Title','Pipeline Stage','Source','Status','City','State','Country','Postal Code','Created Date'];
      exprs := ARRAY['t.first_name','t.last_name',x,y,'t.company','t.job_title',$q$COALESCE(s.name, 'Unassigned')$q$,'t.source','t.status::text',
                     't.city','t.state','t.country','t.postal_code', format('public.export_date(t.created_at, %L)', tz)];
      FOR cf IN SELECT id, field_label FROM public.custom_fields WHERE org_id = _org AND is_active ORDER BY field_order LOOP
        heads := heads || cf.field_label;
        exprs := exprs || format('(SELECT v.field_value FROM public.contact_custom_fields v WHERE v.contact_id = t.id AND v.custom_field_id = %L ORDER BY v.created_at DESC LIMIT 1)', cf.id);
      END LOOP;
      FOR c IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_params->'conditions') = 'array' THEN _params->'conditions' ELSE '[]'::jsonb END) LOOP
        fld := c->>'field'; op := c->>'operator'; val := COALESCE(c->>'value', '');
        CONTINUE WHEN fld IS NULL OR op IS NULL;
        IF fld = 'pipeline_stage_id' THEN
          SELECT format(CASE op WHEN 'equals' THEN ' AND t.pipeline_stage_id = %L' WHEN 'not_equals' THEN ' AND t.pipeline_stage_id <> %L' ELSE '' END, p.id)
            INTO x FROM public.pipeline_stages p WHERE p.org_id = _org AND p.name = val LIMIT 1;
          w := w || COALESCE(x, '');
        ELSIF fld IN ('first_name','last_name','email','phone','company','job_title','source','status','city','state','country','postal_code','created_at') THEN
          y := CASE WHEN fld = 'created_at' THEN 't.created_at' ELSE format('t.%I::text', fld) END;
          w := w || CASE
            WHEN fld = 'created_at' AND op = 'is_empty' THEN ' AND t.created_at IS NULL'
            WHEN fld = 'created_at' AND op = 'is_not_empty' THEN ' AND t.created_at IS NOT NULL'
            WHEN fld = 'created_at' AND op IN ('equals','not_equals','greater_than','less_than') THEN
              format(' AND t.created_at %s %L::timestamptz', CASE op WHEN 'equals' THEN '=' WHEN 'not_equals' THEN '<>' WHEN 'greater_than' THEN '>' ELSE '<' END, val)
            WHEN op = 'equals' THEN format(' AND %s = %L', y, val)
            WHEN op = 'not_equals' THEN format(' AND %s <> %L', y, val)
            WHEN op = 'contains' THEN format(' AND %s ILIKE %L', y, public.export_like(val, true, true))
            WHEN op = 'not_contains' THEN format(' AND NOT %s ILIKE %L', y, public.export_like(val, true, true))
            WHEN op = 'starts_with' THEN format(' AND %s ILIKE %L', y, public.export_like(val, false, true))
            WHEN op = 'ends_with' THEN format(' AND %s ILIKE %L', y, public.export_like(val, true, false))
            WHEN op = 'greater_than' THEN format(' AND %s > %L', y, val)
            WHEN op = 'less_than' THEN format(' AND %s < %L', y, val)
            WHEN op = 'is_empty' THEN format(' AND COALESCE(%s, '''') = ''''', y)
            WHEN op = 'is_not_empty' THEN format(' AND COALESCE(%s, '''') <> ''''', y)
            ELSE '' END;
        ELSE
          -- A custom field: the contact must hold a value for it, exactly as on screen.
          SELECT id, field_label INTO cf FROM public.custom_fields WHERE org_id = _org AND id::text = fld;
          CONTINUE WHEN cf.id IS NULL;
          x := CASE op
            WHEN 'equals' THEN format('v.field_value = %L', val)
            WHEN 'not_equals' THEN format('v.field_value IS DISTINCT FROM %L', val)
            WHEN 'contains' THEN format('position(lower(%L) in lower(v.field_value)) > 0', val)
            WHEN 'not_contains' THEN format('COALESCE(position(lower(%L) in lower(v.field_value)), 0) = 0', val)
            WHEN 'starts_with' THEN format('starts_with(lower(v.field_value), lower(%L))', val)
            WHEN 'ends_with' THEN format('right(lower(v.field_value), length(%1$L)) = lower(%1$L)', val)
            WHEN 'greater_than' THEN CASE WHEN val ~ '^\s*-?\d+(\.\d+)?\s*$' THEN format($q$CASE WHEN v.field_value ~ '^\s*-?\d+(\.\d+)?\s*$' THEN v.field_value::numeric > %L::numeric ELSE false END$q$, val) ELSE 'false' END
            WHEN 'less_than' THEN CASE WHEN val ~ '^\s*-?\d+(\.\d+)?\s*$' THEN format($q$CASE WHEN v.field_value ~ '^\s*-?\d+(\.\d+)?\s*$' THEN v.field_value::numeric < %L::numeric ELSE false END$q$, val) ELSE 'false' END
            WHEN 'is_empty' THEN $q$COALESCE(v.field_value, '') = ''$q$
            WHEN 'is_not_empty' THEN $q$COALESCE(v.field_value, '') <> ''$q$
            ELSE 'true' END;
          w := w || format(' AND EXISTS (SELECT 1 FROM public.contact_custom_fields v WHERE v.contact_id = t.id AND v.custom_field_id = %L AND %s)', cf.id, x);
        END IF;
      END LOOP;
    END IF;
    ord := 't.created_at DESC, t.id';

  -- ---------------------------------------------------------- WhatsApp
  ELSIF _kind = 'whatsapp_messages' THEN
    heads := ARRAY['Contact','Phone','Message','Status','Sent By','Sent At'];
    exprs := ARRAY[$q$btrim(COALESCE(k.first_name, '') || ' ' || COALESCE(k.last_name, ''))$q$,'t.phone_number','t.message_content','t.status::text',
                   $q$CASE WHEN p.id IS NULL THEN 'System' ELSE btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) END$q$,
                   format('public.export_date(t.sent_at, %L)', tz)];
    src := 'public.whatsapp_messages t LEFT JOIN public.contacts k ON k.id = t.contact_id LEFT JOIN public.profiles p ON p.id = t.sent_by';
    w := format('t.org_id = %L', _org);
    ord := 't.sent_at DESC, t.id';

  ELSIF _kind = 'whatsapp_recipients' THEN
    heads := ARRAY['Name','Phone','Status','Error','Retry Count'];
    exprs := ARRAY[$q$btrim(COALESCE(k.first_name, '') || ' ' || COALESCE(k.last_name, ''))$q$,'t.phone_number','t.status::text','t.error_message','t.retry_count::text'];
    src := 'public.whatsapp_campaign_recipients t JOIN public.whatsapp_bulk_campaigns b ON b.id = t.campaign_id LEFT JOIN public.contacts k ON k.id = t.contact_id';
    w := format('b.org_id = %L AND t.campaign_id = %L::uuid', _org, _params->>'campaign_id');
    IF COALESCE(_params->>'status', 'all') <> 'all' THEN w := w || format(' AND t.status::text = %L', _params->>'status'); END IF;
    ord := 't.created_at DESC, t.id';

  -- ---------------------------------------------------------- whole tables (platform admin)
  ELSIF _kind = 'table' THEN
    x := _params->>'table';
    IF x IS NULL OR NOT (x = ANY (public.export_tables())) THEN RAISE EXCEPTION 'This table cannot be exported'; END IF;
    IF x = 'auth_users' THEN
      heads := ARRAY['id','email','phone','email_confirmed_at','created_at','updated_at','last_sign_in_at','full_name','first_name','last_name'];
      exprs := ARRAY['t.id::text','t.email::text','t.phone::text','t.email_confirmed_at::text','t.created_at::text','t.updated_at::text','t.last_sign_in_at::text',
                     $q$t.raw_user_meta_data->>'full_name'$q$,$q$t.raw_user_meta_data->>'first_name'$q$,$q$t.raw_user_meta_data->>'last_name'$q$];
      src := 'auth.users t';
      ord := 't.created_at, t.id';
    ELSE
      FOR cf IN SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = x ORDER BY ordinal_position LOOP
        heads := heads || cf.column_name::text;
        exprs := exprs || format('j.j->>%L', cf.column_name);
      END LOOP;
      IF heads IS NULL THEN RAISE EXCEPTION 'This table does not exist'; END IF;
      src := format('public.%I t CROSS JOIN LATERAL (SELECT to_jsonb(t) AS j) j', x);
      ord := 't.ctid';
    END IF;
    w := 'true';
  ELSE
    RAISE EXCEPTION 'Unknown export';
  END IF;

  header := (SELECT string_agg(public.export_csv(h), ',' ORDER BY n) FROM unnest(heads) WITH ORDINALITY u(h, n));
  ids_query := format('SELECT COALESCE(array_agg(t.id ORDER BY %s), ''{}'') FROM public.contacts t WHERE %s', ord, w);
  IF _protected THEN w := w || ' AND t.id = ANY ($1)'; END IF;
  body := format('SELECT row_number() OVER (ORDER BY %s) AS rn, %s AS line FROM %s WHERE %s', ord,
                 (SELECT string_agg(format('public.export_csv(%s)', e), ' || '','' || ' ORDER BY n) FROM unnest(exprs) WITH ORDINALITY u(e, n)), src, w);
END $fn$;

-- ------------------------------------------------------------------ asking for an export
CREATE FUNCTION public.request_export(_kind text, _params jsonb, _file_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  uid uuid := auth.uid();
  org uuid;
  job uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in again'; END IF;
  org := public.get_user_org_id(uid);
  IF _kind = 'table' THEN
    IF NOT public.is_platform_admin(uid) THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  ELSIF org IS NULL THEN
    RAISE EXCEPTION 'Your organisation''s account does not allow exports right now';
  END IF;
  IF _kind = 'fervent_repository' THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org AND slug = 'fervent-communication') THEN
      RAISE EXCEPTION 'This export is not available for your organisation';
    END IF;
  ELSIF NOT public.db_exports_enabled() THEN
    RAISE EXCEPTION 'This export is not switched on for your organisation';
  END IF;
  IF public.export_org_protected(org) AND NOT public.pii_caller_is_admin(org) THEN
    RAISE EXCEPTION 'Only admins can export in your organisation';
  END IF;
  IF length(COALESCE(_params, '{}')::text) > 200000 THEN RAISE EXCEPTION 'Too many selections for one export'; END IF;

  -- Builds the query once so a wrong request is refused here, not in the background.
  PERFORM public.export_build(_kind, COALESCE(_params, '{}'::jsonb), org, false);

  -- Serialises with the worker's "nothing left, stop" step, so a new job is never left without a worker.
  PERFORM pg_advisory_xact_lock(hashtext('export_worker'));

  SELECT id INTO job FROM public.export_jobs
   WHERE requested_by = uid AND org_id IS NOT DISTINCT FROM org AND kind = _kind AND status = 'preparing' AND params = COALESCE(_params, '{}'::jsonb) LIMIT 1;
  IF job IS NULL THEN
    IF (SELECT count(*) FROM public.export_jobs WHERE requested_by = uid AND status = 'preparing') >= (CASE WHEN _kind = 'table' THEN 100 ELSE 5 END) THEN
      RAISE EXCEPTION 'You already have several exports being prepared. Please wait for them to finish';
    END IF;
    INSERT INTO public.export_jobs (org_id, requested_by, kind, params, file_name)
    VALUES (org, uid, _kind, COALESCE(_params, '{}'::jsonb),
            COALESCE(NULLIF(left(regexp_replace(COALESCE(_file_name, ''), '[^A-Za-z0-9._-]+', '-', 'g'), 120), ''), 'export.csv'))
    RETURNING id INTO job;
  END IF;

  PERFORM cron.schedule('export-worker', '5 seconds', $c$set statement_timeout = '15min'; select public.run_export_jobs();$c$);
  RETURN job;
END $fn$;

-- ------------------------------------------------------------------ the background worker
-- Called by a query running under the requester's own role, so it stores on their behalf; only the worker's own
-- database session may use it.
CREATE FUNCTION public.export_store_chunk(_job uuid, _no integer, _text text, _lock boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.export_job_chunks (job_id, chunk_no, content, content_locked)
  VALUES (_job, _no, CASE WHEN _lock THEN NULL ELSE _text END, CASE WHEN _lock THEN public.encrypt_pii(_text) END);
  RETURN octet_length(_text);
END $fn$;

CREATE FUNCTION public.run_one_export(_job uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  j record;
  b record;
  prot boolean;
  ids uuid[];
  total bigint := 0;
  bytes bigint := 0;
  chunks int := 0;
  n bigint; k bigint; m bigint;
  size constant int := 5000;
  i int;
BEGIN
  SELECT * INTO j FROM public.export_jobs WHERE id = _job;
  -- Contact search hands admins of a protected organisation the full numbers; every other export shows what is on screen.
  prot := public.export_org_protected(j.org_id);

  IF j.kind = 'table' THEN
    IF NOT public.is_platform_admin(j.requested_by) THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  ELSE
    -- From here the query sees exactly what the requester can see.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', j.requested_by, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', j.requested_by::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF public.get_user_org_id(j.requested_by) IS DISTINCT FROM j.org_id THEN RAISE EXCEPTION 'The requester is no longer in this organisation'; END IF;
    IF prot AND NOT public.pii_caller_is_admin(j.org_id) THEN RAISE EXCEPTION 'Only admins can export in this organisation'; END IF;
  END IF;

  b := public.export_build(j.kind, j.params, j.org_id, prot AND j.kind = 'contact_search');

  IF prot AND j.kind = 'contact_search' THEN
    EXECUTE b.ids_query INTO ids;
    FOR i IN 0 .. (cardinality(ids) - 1) / 200 LOOP
      EXIT WHEN cardinality(ids) = 0;
      EXECUTE format('SELECT count(*), public.export_store_chunk(%L, %s, string_agg(line, E''\n'' ORDER BY rn), true) FROM (%s) q', _job, i + 1, b.body)
        INTO n, k USING ids[i * 200 + 1 : (i + 1) * 200];
      total := total + n; bytes := bytes + COALESCE(k, 0); chunks := chunks + 1;
    END LOOP;
  ELSE
    EXECUTE format(
      'SELECT COALESCE(sum(n), 0), COALESCE(sum(sz), 0), count(*) FROM (
         SELECT count(*) AS n, public.export_store_chunk(%L, (((rn - 1) / %s) + 1)::int, string_agg(line, E''\n'' ORDER BY rn), %L) AS sz
           FROM (%s) q GROUP BY (rn - 1) / %s) g', _job, size, prot, b.body, size)
      INTO total, bytes, m;
    chunks := m;
  END IF;

  IF total > 0 THEN
    PERFORM public.export_store_chunk(_job, 0, CASE WHEN j.kind = 'table' THEN U&'\FEFF' ELSE '' END || b.header, prot);
  END IF;

  EXECUTE 'SET LOCAL ROLE NONE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE public.export_jobs SET
    status = CASE WHEN total > 0 THEN 'ready' ELSE 'failed' END,
    error = CASE WHEN total > 0 THEN NULL ELSE 'No records matched, so there was nothing to export' END,
    row_count = total, byte_count = bytes, chunk_count = CASE WHEN total > 0 THEN chunks + 1 ELSE 0 END,
    finished_at = clock_timestamp(), expires_at = clock_timestamp() + interval '7 days'
  WHERE id = _job;
END $fn$;

CREATE FUNCTION public.run_export_jobs() RETURNS void
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  started timestamptz := clock_timestamp();
  job uuid;
  msg text;
BEGIN
  UPDATE public.export_jobs SET status = 'failed', finished_at = now(), error = 'The export took too long and was stopped. Please try again'
   WHERE status = 'preparing' AND created_at < now() - interval '60 minutes';

  LOOP
    SELECT id INTO job FROM public.export_jobs WHERE status = 'preparing' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
    EXIT WHEN job IS NULL;
    BEGIN
      PERFORM public.run_one_export(job);
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      UPDATE public.export_jobs SET status = 'failed', finished_at = clock_timestamp(), error_detail = msg,
             error = 'The export could not be completed. Please try again'
       WHERE id = job;
    END;
    EXIT WHEN clock_timestamp() - started > interval '10 seconds';   -- save progress; the next run carries on
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext('export_worker'));
  IF NOT EXISTS (SELECT 1 FROM public.export_jobs WHERE status = 'preparing') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'export-worker';
  END IF;
END $fn$;

-- Files older than 7 days go, and the oldest go early if one organisation holds more than 2 GB of them.
CREATE FUNCTION public.clean_up_exports() RETURNS void
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  UPDATE public.export_jobs SET status = 'expired' WHERE status = 'ready' AND expires_at < now();
  UPDATE public.export_jobs e SET status = 'expired', expires_at = now()
    FROM (SELECT id, sum(byte_count) OVER (PARTITION BY org_id ORDER BY created_at DESC) AS held FROM public.export_jobs WHERE status = 'ready') h
   WHERE h.id = e.id AND h.held > 2000000000;
  DELETE FROM public.export_job_chunks c USING public.export_jobs e WHERE e.id = c.job_id AND e.status IN ('expired', 'failed');
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
END $fn$;

-- ------------------------------------------------------------------ handing the file back
CREATE FUNCTION public.get_export_chunk(_job uuid, _no integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  uid uuid := auth.uid();
  j record;
  t text;
BEGIN
  SELECT * INTO j FROM public.export_jobs WHERE id = _job;
  IF uid IS NULL OR j.id IS NULL
     OR NOT (CASE WHEN j.kind = 'table' THEN j.requested_by = uid AND public.is_platform_admin(uid)
                 ELSE public.get_user_org_id(uid) IS NOT DISTINCT FROM j.org_id
                      AND (j.requested_by IS NOT DISTINCT FROM uid OR public.export_user_is_org_admin(uid, j.org_id))
                      AND (NOT public.export_org_protected(j.org_id) OR public.pii_caller_is_admin(j.org_id)) END)
  THEN RAISE EXCEPTION 'You cannot download this export' USING ERRCODE = '42501'; END IF;
  IF j.status <> 'ready' OR j.expires_at < now() THEN RAISE EXCEPTION 'This file is no longer available. Please export again'; END IF;
  IF _no = 0 THEN INSERT INTO public.export_downloads (job_id, user_id) VALUES (_job, uid); END IF;
  SELECT COALESCE(content, public.decrypt_pii(content_locked)) INTO t FROM public.export_job_chunks WHERE job_id = _job AND chunk_no = _no;
  IF t IS NULL THEN RAISE EXCEPTION 'This file is no longer available. Please export again'; END IF;
  RETURN t;
END $fn$;

-- ------------------------------------------------------------------ Fervent's filter lists
CREATE FUNCTION public.fervent_filter_values(_field text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  org uuid := public.get_user_org_id(auth.uid());
  v text[];
BEGIN
  IF org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org AND slug = 'fervent-communication') THEN RETURN '{}'; END IF;
  IF NOT (_field = ANY (ARRAY['city','state','country','industry','sub_industry','designation','designation_level','department','ucdb_status'])) THEN
    RAISE EXCEPTION 'Unknown filter';
  END IF;
  EXECUTE format('SELECT COALESCE(array_agg(v), ''{}'') FROM (SELECT DISTINCT btrim(%1$I) AS v FROM public.fervent_data_repository WHERE org_id = $1 AND btrim(%1$I) <> '''') d', _field)
    INTO v USING org;
  RETURN v;
END $fn$;

-- ------------------------------------------------------------------ who may call what
REVOKE ALL ON FUNCTION public.request_export(text, jsonb, text), public.get_export_chunk(uuid, integer), public.fervent_filter_values(text),
  public.db_exports_enabled(), public.export_user_is_org_admin(uuid, uuid), public.export_org_protected(uuid), public.export_csv(text), public.export_date(timestamptz, text),
  public.export_turnover(numeric, text), public.export_like(text, boolean, boolean), public.export_text_list(jsonb), public.export_tables(),
  public.export_build(text, jsonb, uuid, boolean), public.export_store_chunk(uuid, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_export(text, jsonb, text), public.get_export_chunk(uuid, integer), public.fervent_filter_values(text),
  public.db_exports_enabled(), public.export_user_is_org_admin(uuid, uuid), public.export_org_protected(uuid), public.export_csv(text), public.export_date(timestamptz, text),
  public.export_turnover(numeric, text), public.export_like(text, boolean, boolean), public.export_text_list(jsonb), public.export_tables(),
  public.export_build(text, jsonb, uuid, boolean), public.export_store_chunk(uuid, integer, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.run_one_export(uuid), public.run_export_jobs(), public.clean_up_exports() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('export-clean-up', '40 20 * * *', 'select public.clean_up_exports();');

-- ------------------------------------------------------------------ Fervent's earlier exports stay in its history
INSERT INTO public.export_jobs (org_id, requested_by, kind, params, file_name, status, row_count, created_at, finished_at)
SELECT l.org_id, l.actor_id, 'fervent_repository', jsonb_build_object('legacy', COALESCE(l.detail->'filters', '{}'::jsonb)),
       'fervent-database-' || to_char(l.created_at, 'YYYY-MM-DD') || '.csv', 'expired', (l.detail->>'count')::int, l.created_at, l.created_at
  FROM public.fervent_activity_log l
 WHERE l.action = 'exported' AND l.record_id IS NULL;
