-- Add WhatsApp as a first-class channel in the Platform Command Center stats,
-- alongside calls and emails. WhatsApp send volume lives in whatsapp_logs
-- (the delivery log), counted the same way calls are counted from call_logs.

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
  SELECT COUNT(*) INTO v_user_count
  FROM profiles WHERE org_id = p_org_id;

  SELECT COUNT(*) INTO v_contact_count
  FROM contacts WHERE org_id = p_org_id;

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

  SELECT COUNT(*) INTO v_email_volume
  FROM email_conversations
  WHERE org_id = p_org_id AND direction = 'outbound';

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
  SELECT COUNT(DISTINCT id) INTO v_total_orgs FROM organizations;
  SELECT COUNT(*) INTO v_total_users FROM profiles;
  SELECT COUNT(*) INTO v_total_contacts FROM contacts;

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

  SELECT COUNT(*) INTO v_email_volume
  FROM email_conversations WHERE direction = 'outbound';

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
