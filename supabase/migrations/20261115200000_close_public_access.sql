-- Code audit 2026-11-15 (approved): nobody without a sign-in reaches staff data or staff actions,
-- and a signed-in person from one organisation cannot read or change another organisation's data.
-- Public pages keep working: sign-up, invites, public forms, data-rights requests, the SDR test, pricing.

-- 1. A shared check: the caller must belong to the organisation (platform admins may look at any).
--    No signed-in person means the server is calling with the system key (visitors cannot call these any more).
CREATE OR REPLACE FUNCTION public.assert_org_access(p_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.is_platform_admin(auth.uid()) OR p_org = public.get_user_org_id(auth.uid()) THEN RETURN; END IF;
  RAISE EXCEPTION 'Not allowed for this organisation' USING ERRCODE = '42501';
END;
$function$;

-- A brand-new account that has no organisation yet (used by the two sign-up steps that run before the
-- person has a session, because the sign-up email has not been confirmed yet).
CREATE OR REPLACE FUNCTION public.signup_account_is_new(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT (auth.uid() IS NULL OR auth.uid() = p_user)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND p.org_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user)
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user AND u.created_at > now() - interval '1 hour');
$function$;

-- 2. Sign-up: joining an organisation needs a real, unused invite (the invite code travels with the sign-up).
--    Accounts made by an admin on the Users screen get their organisation and role from the server, not from here.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite public.org_invites%ROWTYPE;
  v_code text := NULLIF(btrim(NEW.raw_user_meta_data->>'invite_code'), '');
BEGIN
  IF v_code IS NOT NULL THEN
    SELECT * INTO v_invite FROM public.org_invites
     WHERE invite_code = v_code AND used_at IS NULL AND expires_at > now()
       AND (email IS NULL OR lower(email) = lower(NEW.email))
     LIMIT 1
     FOR UPDATE;
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name, org_id)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name', v_invite.org_id);

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (NEW.id, v_invite.org_id, COALESCE(v_invite.role, 'sales_agent'::app_role));
    UPDATE public.org_invites SET used_at = now(), used_by = NEW.id WHERE id = v_invite.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- The sign-up page reads one invite by its code instead of the whole invite list.
DROP POLICY IF EXISTS "Anyone can view valid unused invites" ON public.org_invites;
CREATE OR REPLACE FUNCTION public.get_invite_by_code(p_code text)
 RETURNS TABLE(id uuid, org_id uuid, role app_role, email text, expires_at timestamptz, org_name text, org_slug text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT i.id, i.org_id, i.role, i.email, i.expires_at, o.name, o.slug
    FROM public.org_invites i JOIN public.organizations o ON o.id = i.org_id
   WHERE i.invite_code = p_code AND i.used_at IS NULL AND i.expires_at > now()
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.create_organization_for_user(p_user_id uuid, p_org_name text, p_org_slug text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_unique_slug text;
  v_per_user_cost NUMERIC;
  v_min_wallet_balance NUMERIC;
BEGIN
  IF NOT public.signup_account_is_new(p_user_id) THEN
    RAISE EXCEPTION 'This account already has an organisation or is not a new sign-up' USING ERRCODE = '42501';
  END IF;
  v_unique_slug := generate_unique_slug(p_org_slug);

  INSERT INTO public.organizations (name, slug)
  VALUES (p_org_name, v_unique_slug)
  RETURNING id INTO v_org_id;

  UPDATE public.profiles
  SET org_id = v_org_id
  WHERE id = p_user_id;

  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (p_user_id, v_org_id, 'admin');

  SELECT per_user_monthly_cost, min_wallet_balance
  INTO v_per_user_cost, v_min_wallet_balance
  FROM subscription_pricing
  WHERE is_active = true
  LIMIT 1;

  -- Create initial subscription with 5000 wallet balance (trial credit) for new orgs
  INSERT INTO public.organization_subscriptions (
    org_id,
    subscription_status,
    billing_cycle_start,
    next_billing_date,
    user_count,
    monthly_subscription_amount,
    wallet_balance,
    wallet_minimum_balance,
    wallet_auto_topup_enabled
  ) VALUES (
    v_org_id,
    'active',
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '1 month',
    1,
    COALESCE(v_per_user_cost, 500),
    5000,
    COALESCE(v_min_wallet_balance, 500),
    true
  );

  PERFORM create_default_pipeline_stages(v_org_id);
  PERFORM create_default_call_dispositions(v_org_id);

  RETURN v_org_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Organization name or URL is already taken';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create organization: %', SQLERRM;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_profile(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- Only a failed sign-up from the last hour (no organisation, no roles) can be removed this way.
  IF NOT public.signup_account_is_new(cleanup_orphaned_profile.user_id) THEN
    RAISE EXCEPTION 'Only an unfinished new sign-up can be removed' USING ERRCODE = '42501';
  END IF;
  -- Delete from user_roles first (if any exist) - fully qualify to avoid ambiguity
  DELETE FROM public.user_roles WHERE user_roles.user_id = cleanup_orphaned_profile.user_id;
  
  -- Delete profile
  DELETE FROM public.profiles WHERE profiles.id = cleanup_orphaned_profile.user_id;
  
  -- Delete from auth.users (cascades will handle remaining references)
  DELETE FROM auth.users WHERE users.id = cleanup_orphaned_profile.user_id;
END;
$function$

;

-- 3. Reports and inbox that take an organisation: only for members of that organisation (or platform admins).
CREATE OR REPLACE FUNCTION public.get_activity_trends(p_org_id uuid, p_days integer DEFAULT 7)
 RETURNS TABLE(activity_date date, activity_type text, activity_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  RAISE LOG '=== get_activity_trends START ===';
  RAISE LOG 'Parameter p_org_id: %, p_days: %', p_org_id, p_days;
  RAISE LOG 'Current auth.uid(): %', auth.uid();
  
  RETURN QUERY
  SELECT 
    DATE(created_at) as activity_date,
    activity_type,
    COUNT(*) as activity_count
  FROM contact_activities
  WHERE org_id = p_org_id
    AND created_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  GROUP BY DATE(created_at), activity_type
  ORDER BY activity_date DESC, activity_type;
  
  RAISE LOG '=== get_activity_trends END ===';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_org_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_total_contacts INTEGER;
  v_active_deals INTEGER;
  v_calls_today INTEGER;
  v_prev_month_contacts INTEGER;
  v_conversion_rate NUMERIC;
  v_auth_uid UUID;
  v_user_org_id UUID;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  -- Get current user context for debugging
  v_auth_uid := auth.uid();
  v_user_org_id := get_user_org_id(v_auth_uid);
  
  RAISE LOG '=== get_dashboard_stats START ===';
  RAISE LOG 'Parameter p_org_id: %', p_org_id;
  RAISE LOG 'Current auth.uid(): %', v_auth_uid;
  RAISE LOG 'get_user_org_id(auth.uid()): %', v_user_org_id;
  
  -- Total contacts
  SELECT COUNT(*) INTO v_total_contacts
  FROM contacts
  WHERE org_id = p_org_id;
  
  RAISE LOG 'Total contacts found: %', v_total_contacts;
  RAISE LOG 'Query was: SELECT COUNT(*) FROM contacts WHERE org_id = %', p_org_id;

  -- Active deals (contacts in pipeline stages)
  SELECT COUNT(*) INTO v_active_deals
  FROM contacts
  WHERE org_id = p_org_id AND pipeline_stage_id IS NOT NULL;
  
  RAISE LOG 'Active deals found: %', v_active_deals;

  -- Calls today
  SELECT COUNT(*) INTO v_calls_today
  FROM contact_activities
  WHERE org_id = p_org_id 
    AND activity_type = 'call'
    AND DATE(created_at) = CURRENT_DATE;
  
  RAISE LOG 'Calls today found: %', v_calls_today;

  -- Previous month contacts for growth calculation
  SELECT COUNT(*) INTO v_prev_month_contacts
  FROM contacts
  WHERE org_id = p_org_id
    AND created_at < DATE_TRUNC('month', CURRENT_DATE);
  
  RAISE LOG 'Previous month contacts: %', v_prev_month_contacts;

  -- Conversion rate
  SELECT CASE 
    WHEN v_total_contacts > 0 THEN
      ROUND((COUNT(*)::NUMERIC / v_total_contacts::NUMERIC) * 100, 2)
    ELSE 0
  END INTO v_conversion_rate
  FROM contacts c
  INNER JOIN pipeline_stages ps ON c.pipeline_stage_id = ps.id
  WHERE c.org_id = p_org_id AND ps.probability = 100;
  
  RAISE LOG 'Conversion rate calculated: %', v_conversion_rate;

  v_result := json_build_object(
    'total_contacts', v_total_contacts,
    'active_deals', v_active_deals,
    'calls_today', v_calls_today,
    'prev_month_contacts', v_prev_month_contacts,
    'conversion_rate', v_conversion_rate
  );
  
  RAISE LOG 'Final result: %', v_result;
  RAISE LOG '=== get_dashboard_stats END ===';

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_org_statistics(p_org_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_user_count INTEGER;
  v_contact_count INTEGER;
  v_active_1d INTEGER;
  v_active_7d INTEGER;
  v_active_30d INTEGER;
  v_call_volume INTEGER;
  v_email_volume INTEGER;
  v_whatsapp_volume INTEGER;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  SELECT COUNT(*) INTO v_user_count
  FROM profiles WHERE org_id = p_org_id;

  SELECT
    (SELECT COUNT(*) FROM contacts WHERE org_id = p_org_id)
    + (SELECT COUNT(*) FROM fervent_data_repository WHERE org_id = p_org_id)
  INTO v_contact_count;

  SELECT COUNT(DISTINCT created_by) INTO v_active_1d
  FROM contact_activities
  WHERE org_id = p_org_id
    AND created_at > NOW() - INTERVAL '1 day'
    AND created_by IS NOT NULL;

  SELECT COUNT(DISTINCT created_by) INTO v_active_7d
  FROM contact_activities
  WHERE org_id = p_org_id
    AND created_at > NOW() - INTERVAL '7 days'
    AND created_by IS NOT NULL;

  SELECT COUNT(DISTINCT created_by) INTO v_active_30d
  FROM contact_activities
  WHERE org_id = p_org_id
    AND created_at > NOW() - INTERVAL '30 days'
    AND created_by IS NOT NULL;

  SELECT COUNT(*) INTO v_call_volume
  FROM call_logs WHERE org_id = p_org_id;

  SELECT
    (SELECT COUNT(*) FROM email_conversations WHERE org_id = p_org_id AND direction = 'outbound')
    + (SELECT COUNT(*) FROM pipeline_email_log WHERE org_id = p_org_id)
  INTO v_email_volume;

  SELECT COUNT(*) INTO v_whatsapp_volume
  FROM whatsapp_logs WHERE org_id = p_org_id;

  v_result := json_build_object(
    'user_count', v_user_count,
    'contact_count', v_contact_count,
    'active_users_1d', v_active_1d,
    'active_users_7d', v_active_7d,
    'active_users_30d', v_active_30d,
    'call_volume', v_call_volume,
    'email_volume', v_email_volume,
    'whatsapp_volume', v_whatsapp_volume
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pipeline_performance_report(p_org_id uuid)
 RETURNS TABLE(stage_id uuid, stage_name text, stage_order integer, stage_color text, contact_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  RETURN QUERY
  SELECT
    ps.id as stage_id,
    ps.name as stage_name,
    ps.stage_order,
    ps.color as stage_color,
    COUNT(c.id) as contact_count
  FROM pipeline_stages ps
  LEFT JOIN contacts c ON c.pipeline_stage_id = ps.id AND c.org_id = p_org_id
  WHERE ps.org_id = p_org_id
  GROUP BY ps.id, ps.name, ps.stage_order, ps.color
  ORDER BY ps.stage_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_performance_report(p_org_id uuid, p_start_date timestamp with time zone)
 RETURNS TABLE(user_id uuid, user_name text, total_contacts bigint, total_calls bigint, total_emails bigint, total_meetings bigint, deals_won bigint, conversion_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  RETURN QUERY
  WITH user_contacts AS (
    SELECT 
      c.created_by,
      COUNT(*) as contact_count
    FROM contacts c
    WHERE c.org_id = p_org_id
      AND c.created_at >= p_start_date
      AND c.created_by IS NOT NULL
    GROUP BY c.created_by
  ),
  user_activities AS (
    SELECT
      ca.created_by,
      COUNT(*) FILTER (WHERE ca.activity_type = 'call') as call_count,
      COUNT(*) FILTER (WHERE ca.activity_type = 'email') as email_count,
      COUNT(*) FILTER (WHERE ca.activity_type = 'meeting') as meeting_count
    FROM contact_activities ca
    WHERE ca.org_id = p_org_id
      AND ca.created_at >= p_start_date
      AND ca.created_by IS NOT NULL
    GROUP BY ca.created_by
  ),
  won_stage AS (
    SELECT id as stage_id
    FROM pipeline_stages
    WHERE org_id = p_org_id
      AND LOWER(name) = 'won'
    LIMIT 1
  ),
  user_deals AS (
    SELECT
      c.created_by,
      COUNT(*) as won_count
    FROM contacts c
    CROSS JOIN won_stage ws
    WHERE c.org_id = p_org_id
      AND c.pipeline_stage_id = ws.stage_id
      AND c.created_by IS NOT NULL
    GROUP BY c.created_by
  )
  SELECT
    p.id as user_id,
    COALESCE(p.first_name || ' ' || COALESCE(p.last_name, ''), 'Unknown') as user_name,
    COALESCE(uc.contact_count, 0) as total_contacts,
    COALESCE(ua.call_count, 0) as total_calls,
    COALESCE(ua.email_count, 0) as total_emails,
    COALESCE(ua.meeting_count, 0) as total_meetings,
    COALESCE(ud.won_count, 0) as deals_won,
    CASE 
      WHEN COALESCE(uc.contact_count, 0) > 0 
      THEN ROUND((COALESCE(ud.won_count, 0)::numeric / uc.contact_count::numeric) * 100, 2)
      ELSE 0
    END as conversion_rate
  FROM profiles p
  LEFT JOIN user_contacts uc ON p.id = uc.created_by
  LEFT JOIN user_activities ua ON p.id = ua.created_by
  LEFT JOIN user_deals ud ON p.id = ud.created_by
  WHERE p.org_id = p_org_id
    AND (uc.contact_count > 0 OR ua.call_count > 0 OR ua.email_count > 0 OR ua.meeting_count > 0 OR ud.won_count > 0)
  ORDER BY p.first_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unified_inbox(p_org_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, conversation_id text, contact_id uuid, channel text, direction text, sender_name text, preview text, is_read boolean, sent_at timestamp with time zone, contact_name text, phone_number text, email_address text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  RETURN QUERY
  SELECT 
    wm.id,
    wm.conversation_id::TEXT,
    wm.contact_id,
    'whatsapp'::TEXT as channel,
    wm.direction,
    wm.sender_name,
    LEFT(wm.message_content, 100) as preview,
    COALESCE(wm.read_at IS NOT NULL, FALSE) as is_read,
    wm.sent_at,
    COALESCE(c.first_name || ' ' || COALESCE(c.last_name, ''), wm.sender_name) as contact_name,
    wm.phone_number,
    NULL::TEXT as email_address
  FROM whatsapp_messages wm
  LEFT JOIN contacts c ON c.id = wm.contact_id
  WHERE wm.org_id = p_org_id
  
  UNION ALL
  
  SELECT 
    ec.id,
    ec.conversation_id::TEXT,
    ec.contact_id,
    'email'::TEXT as channel,
    ec.direction,
    ec.from_name as sender_name,
    LEFT(ec.subject || ': ' || ec.email_content, 100) as preview,
    ec.is_read,
    ec.sent_at,
    COALESCE(c.first_name || ' ' || COALESCE(c.last_name, ''), ec.from_name) as contact_name,
    NULL::TEXT as phone_number,
    ec.from_email as email_address
  FROM email_conversations ec
  LEFT JOIN contacts c ON c.id = ec.contact_id
  WHERE ec.org_id = p_org_id
  
  ORDER BY sent_at DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_platform_admin_stats()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_total_orgs INTEGER;
  v_total_users INTEGER;
  v_active_users_1d INTEGER;
  v_active_users_7d INTEGER;
  v_active_users_30d INTEGER;
  v_total_contacts INTEGER;
  v_call_volume INTEGER;
  v_email_volume INTEGER;
  v_whatsapp_volume INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only platform admins can view platform statistics' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(DISTINCT id) INTO v_total_orgs FROM organizations;
  SELECT COUNT(*) INTO v_total_users FROM profiles;

  SELECT
    (SELECT COUNT(*) FROM contacts)
    + (SELECT COUNT(*) FROM fervent_data_repository)
  INTO v_total_contacts;

  SELECT COUNT(DISTINCT created_by) INTO v_active_users_1d
  FROM contact_activities
  WHERE created_at > NOW() - INTERVAL '1 day' AND created_by IS NOT NULL;

  SELECT COUNT(DISTINCT created_by) INTO v_active_users_7d
  FROM contact_activities
  WHERE created_at > NOW() - INTERVAL '7 days' AND created_by IS NOT NULL;

  SELECT COUNT(DISTINCT created_by) INTO v_active_users_30d
  FROM contact_activities
  WHERE created_at > NOW() - INTERVAL '30 days' AND created_by IS NOT NULL;

  SELECT COUNT(*) INTO v_call_volume FROM call_logs;

  SELECT
    (SELECT COUNT(*) FROM email_conversations WHERE direction = 'outbound')
    + (SELECT COUNT(*) FROM pipeline_email_log)
  INTO v_email_volume;

  SELECT COUNT(*) INTO v_whatsapp_volume FROM whatsapp_logs;

  v_result := json_build_object(
    'total_organizations', v_total_orgs,
    'total_users', v_total_users,
    'active_users_1d', v_active_users_1d,
    'active_users_7d', v_active_users_7d,
    'active_users_30d', v_active_users_30d,
    'total_contacts', v_total_contacts,
    'call_volume', v_call_volume,
    'email_volume', v_email_volume,
    'whatsapp_volume', v_whatsapp_volume
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contacts_by_category(p_org_id uuid)
 RETURNS TABLE(category text, contact_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  RETURN QUERY
  SELECT c.category, COUNT(*) AS contact_count
  FROM contacts c
  WHERE c.org_id = p_org_id
    AND c.category IS NOT NULL
  GROUP BY c.category
  ORDER BY contact_count DESC;
END;
$function$;

-- Outbound webhooks: only an organisation admin (or platform admin) can add or remove the database hook,
-- and only for an insert/update/delete on an existing table that belongs to organisations.
CREATE OR REPLACE FUNCTION public.manage_webhook_trigger(p_table_name text, p_operation text, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  trigger_name TEXT;
  v_op TEXT := upper(btrim(p_operation));
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.is_platform_admin(auth.uid())
       OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can manage webhooks' USING ERRCODE = '42501';
  END IF;
  IF v_op NOT IN ('INSERT', 'UPDATE', 'DELETE') OR p_action NOT IN ('create', 'drop') THEN
    RAISE EXCEPTION 'Unsupported webhook event';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = p_table_name AND column_name = 'org_id') THEN
    RAISE EXCEPTION 'Unsupported webhook table';
  END IF;

  trigger_name := 'webhook_' || p_table_name || '_' || lower(v_op);
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, p_table_name);
  IF p_action = 'create' THEN
    EXECUTE format('CREATE TRIGGER %I AFTER %s ON public.%I FOR EACH ROW EXECUTE FUNCTION trigger_outbound_webhook_generic()',
                   trigger_name, v_op, p_table_name);
  END IF;
END;
$function$;

-- 4. The latest-disposition list shows only the viewer's own organisation.
--    The ready-made contacts summary is not used by any screen and is closed.
CREATE OR REPLACE VIEW public.contact_latest_disposition AS
 WITH contact_action AS (
         SELECT c.id AS contact_id,
            COALESCE(c.action_channel, psa.action_type) AS action_type
           FROM (contacts c
             LEFT JOIN pipeline_stage_actions psa ON (((psa.stage_id = c.pipeline_stage_id) AND (psa.is_active = true))))
        ), events AS (
         SELECT cl.org_id,
            cl.contact_id,
            cl.id AS call_log_id,
            cl.disposition_id,
            d.name AS disposition_name,
            d.category AS disposition_category,
            cl.created_at AS dispositioned_at,
            'call'::text AS event_channel
           FROM (call_logs cl
             JOIN call_dispositions d ON ((d.id = cl.disposition_id)))
          WHERE ((cl.contact_id IS NOT NULL) AND (cl.disposition_id IS NOT NULL))
        UNION ALL
         SELECT wl.org_id,
            wl.contact_id,
            NULL::uuid AS call_log_id,
            d.id AS disposition_id,
            d.name AS disposition_name,
            d.category AS disposition_category,
            COALESCE(wl.read_at, wl.delivered_at, wl.sent_at, wl.failed_at, wl.created_at) AS dispositioned_at,
            'whatsapp'::text AS event_channel
           FROM (whatsapp_logs wl
             JOIN call_dispositions d ON (((d.org_id = wl.org_id) AND (d.name =
                CASE wl.status
                    WHEN 'read'::text THEN 'Message Opened'::text
                    WHEN 'delivered'::text THEN 'Message Delivered'::text
                    WHEN 'sent'::text THEN 'Message Sent'::text
                    WHEN 'failed'::text THEN 'Message Failed'::text
                    ELSE NULL::text
                END))))
          WHERE ((wl.contact_id IS NOT NULL) AND (wl.status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])))
        UNION ALL
         SELECT pel.org_id,
            pel.contact_id,
            NULL::uuid AS call_log_id,
            d.id AS disposition_id,
            d.name AS disposition_name,
            d.category AS disposition_category,
            COALESCE(pel.sent_at, pel.failed_at, pel.created_at) AS dispositioned_at,
            'email'::text AS event_channel
           FROM (pipeline_email_log pel
             JOIN call_dispositions d ON (((d.org_id = pel.org_id) AND (d.name =
                CASE pel.status
                    WHEN 'sent'::text THEN 'Email Sent'::text
                    WHEN 'failed'::text THEN 'Email Failed'::text
                    ELSE NULL::text
                END))))
          WHERE ((pel.contact_id IS NOT NULL) AND (pel.status = ANY (ARRAY['sent'::text, 'failed'::text])))
        )
 SELECT DISTINCT ON (e.contact_id) e.org_id,
    e.contact_id,
    e.call_log_id,
    e.disposition_id,
    e.disposition_name,
    e.disposition_category,
    e.dispositioned_at
   FROM (events e
     LEFT JOIN contact_action ca ON ((ca.contact_id = e.contact_id)))
  WHERE (((ca.action_type IS NULL) OR ((ca.action_type = 'call'::text) AND (e.event_channel = 'call'::text)) OR ((ca.action_type = 'whatsapp'::text) AND (e.event_channel = 'whatsapp'::text)) OR ((ca.action_type = 'email'::text) AND (e.event_channel = 'email'::text))))
    AND e.org_id = (SELECT public.get_user_org_id(auth.uid()))
  ORDER BY e.contact_id, e.dispositioned_at DESC;
REVOKE ALL ON public.contact_latest_disposition FROM anon;
REVOKE ALL ON public.contacts_with_stages FROM anon, authenticated;

-- 5. Table rules that let anyone in (named "service role" but open to everyone). The server's system key
--    does not need them, so they go. Kept: public consent/data-rights intake, pricing, feature list, SDR test.
DROP POLICY IF EXISTS "Service role can manage all call sessions" ON public."agent_call_sessions";
DROP POLICY IF EXISTS "Service role manages coaching plans" ON public."agent_coaching_plans";
DROP POLICY IF EXISTS "Service role manages ai_call_scripts" ON public."ai_call_scripts";
DROP POLICY IF EXISTS "Service role can manage all usage logs" ON public."api_key_usage_logs";
DROP POLICY IF EXISTS "Service role can manage all API keys" ON public."api_keys";
DROP POLICY IF EXISTS "Service role has full access to blog posts" ON public."blog_posts";
DROP POLICY IF EXISTS "Service role full access to bulk_import_history" ON public."bulk_import_history";
DROP POLICY IF EXISTS "Service role can manage all call logs" ON public."call_logs";
DROP POLICY IF EXISTS "Service role can manage all analytics" ON public."campaign_analytics";
DROP POLICY IF EXISTS "Service role can manage all insights" ON public."campaign_insights";
DROP POLICY IF EXISTS "Service role can manage all enrichment logs" ON public."contact_enrichment_logs";
DROP POLICY IF EXISTS "Service role can manage all email recipients" ON public."email_campaign_recipients";
DROP POLICY IF EXISTS "Service role can manage all email conversations" ON public."email_conversations";
DROP POLICY IF EXISTS "Service role can manage suppression list" ON public."email_suppression_list";
DROP POLICY IF EXISTS "Service role can manage all notifications" ON public."notifications";
DROP POLICY IF EXISTS "Service role manages settings" ON public."organization_settings";
DROP POLICY IF EXISTS "Service role can manage all subscriptions" ON public."organization_subscriptions";
DROP POLICY IF EXISTS "Service role full access on otp_whatsapp_config" ON public."otp_whatsapp_config";
DROP POLICY IF EXISTS "Service role can manage webhook logs" ON public."outbound_webhook_logs";
DROP POLICY IF EXISTS "Service role can manage transactions" ON public."payment_transactions";
DROP POLICY IF EXISTS "System can manage benchmarks" ON public."pipeline_benchmarks";
DROP POLICY IF EXISTS "Service role has full access to platform email list" ON public."platform_email_sending_list";
DROP POLICY IF EXISTS "Service role full access on public_otp_verifications" ON public."public_otp_verifications";
DROP POLICY IF EXISTS "Service role can manage rate limits" ON public."rate_limit_log";
DROP POLICY IF EXISTS "Service role can insert usage" ON public."service_usage_logs";
DROP POLICY IF EXISTS "Service role can insert audit log" ON public."subscription_audit_log";
DROP POLICY IF EXISTS "Service role can manage invoices" ON public."subscription_invoices";
DROP POLICY IF EXISTS "Service role manages notifications" ON public."subscription_notifications";
DROP POLICY IF EXISTS "Service role can create wallet transactions" ON public."wallet_transactions";
DROP POLICY IF EXISTS "Service role can manage all recipients" ON public."whatsapp_campaign_recipients";
DROP POLICY IF EXISTS "Service role manages wa logs" ON public."whatsapp_logs";

-- Screens that relied on those open rules get rules limited to the person's own organisation.
CREATE POLICY "Org members add AI call scripts" ON public.ai_call_scripts FOR INSERT TO authenticated
  WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Org members update AI call scripts" ON public.ai_call_scripts FOR UPDATE TO authenticated
  USING (org_id = get_user_org_id(auth.uid())) WITH CHECK (org_id = get_user_org_id(auth.uid()));
CREATE POLICY "Org members add email campaign recipients" ON public.email_campaign_recipients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.email_bulk_campaigns c
                       WHERE c.id = email_campaign_recipients.campaign_id AND c.org_id = get_user_org_id(auth.uid())));
CREATE POLICY "Org members add WhatsApp campaign recipients" ON public.whatsapp_campaign_recipients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.whatsapp_bulk_campaigns c
                       WHERE c.id = whatsapp_campaign_recipients.campaign_id AND c.org_id = get_user_org_id(auth.uid())));
CREATE POLICY "Org members update WhatsApp campaign recipients" ON public.whatsapp_campaign_recipients FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.whatsapp_bulk_campaigns c
                  WHERE c.id = whatsapp_campaign_recipients.campaign_id AND c.org_id = get_user_org_id(auth.uid())));
CREATE POLICY "Users can delete their own notifications" ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 6. Functions: closed to visitors without a sign-in, except the access-check helpers the table rules use
--    and the sign-up steps. Server-only functions (wallet charges, bulk deletes, imports, personal-data keys,
--    campaign counters, the security ledger) are closed to signed-in people too; the server uses the system key.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname = ANY (ARRAY['can_create_import_job','get_user_org_id','get_user_org_id_unlocked','has_role','is_admin_of_conversation','is_participant_in_conversation','is_platform_admin','ledger_can_view','ledger_is_admin','is_org_locked','create_organization_for_user','cleanup_orphaned_profile','get_invite_by_code']) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', f.sig);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname = ANY (ARRAY['deduct_from_wallet','credit_wallet_funds','reserve_wallet_funds','bulk_delete_verified','bulk_delete_demandcom_batch','delete_demandcom_by_activity_batch','claim_fervent_new_rows','merge_fervent_repository_batch','upsert_fervent_repository_batch','find_fervent_duplicate_candidates','refresh_fervent_dashboard_cache','rotate_pii_key','pii_key_configured','pii_contact_email','pii_contact_phone','pii_existing_emails','pii_existing_phones','delete_user_data','increment_automation_rule_stats','increment_campaign_stats','increment_email_campaign_stats','increment_sms_campaign_stats','increment_automation_cooldown','mark_automation_conversion','aggregate_automation_performance_daily','check_and_update_subscription_status','sync_platform_email_list','get_contacts_needing_translit','apply_name_hi','get_ai_call_candidates','calculate_next_slot','get_queue_position','check_connector_rate_limit','check_and_increment_daily_limit','update_lead_score','ledger_capture_logins','ledger_seal_block','ledger_verify_chain','ledger_blocks_export','ledger_blocks_for_copy','signup_account_is_new']) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.sig);
  END LOOP;
END $$;
