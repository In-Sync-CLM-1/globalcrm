-- Platform admin Command Center needs channel-wise wallet consumption per org
-- (calls vs WhatsApp vs email) without pulling potentially thousands of raw
-- service_usage_logs rows to the client. Aggregate server-side instead.
CREATE OR REPLACE FUNCTION public.get_org_wallet_channel_usage(p_org_id uuid)
RETURNS TABLE(service_type text, usage_count bigint, total_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only platform admins can view org wallet consumption';
  END IF;

  RETURN QUERY
  SELECT sul.service_type, COUNT(*)::bigint, COALESCE(SUM(sul.cost), 0)
  FROM service_usage_logs sul
  WHERE sul.org_id = p_org_id
  GROUP BY sul.service_type
  ORDER BY SUM(sul.cost) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_wallet_channel_usage(uuid) TO authenticated;
