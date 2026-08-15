-- ============================================================
-- Let a platform admin also work inside an organisation
-- ============================================================
-- is_platform_admin currently means "has no organisation": ProtectedRoute
-- pins such a user to /platform-admin and nothing else. Amit is platform
-- admin AND a working member of every organisation, so arriving from RMPL's
-- launcher dropped him on the platform console instead of the workspace he
-- came for.
--
-- Membership already lives in user_roles (user_id, org_id, role). What was
-- missing is a safe way to say which one is being worked in: profiles.org_id
-- is what get_user_org_id() reads, and users can no longer write it directly
-- — that write was revoked when the cross-tenant hole was closed.
-- ============================================================

CREATE OR REPLACE FUNCTION set_active_org(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  -- Membership is the whole check. A platform admin is not exempt: to work
  -- inside an organisation they join it like anyone else, so "what can this
  -- session touch" stays answerable from one table.
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
     WHERE user_id = v_uid AND org_id = p_org_id AND is_active
  ) THEN
    RAISE EXCEPTION 'You are not a member of that organisation';
  END IF;

  UPDATE profiles SET org_id = p_org_id WHERE id = v_uid;
  RETURN p_org_id;
END;
$$;

REVOKE ALL ON FUNCTION set_active_org(uuid) FROM public;
GRANT EXECUTE ON FUNCTION set_active_org(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Amit belongs to every organisation
-- ------------------------------------------------------------
-- Idempotent. Lands him in RMPL, which is where the launcher button he uses
-- comes from.
DO $$
DECLARE
  v_uid uuid;
  v_org record;
  v_landing uuid;
BEGIN
  SELECT p.id INTO v_uid
    FROM profiles p JOIN auth.users u ON u.id = p.id
   WHERE lower(u.email) = 'a@in-sync.co.in';
  IF v_uid IS NULL THEN
    RAISE NOTICE 'a@in-sync.co.in not present — skipping';
    RETURN;
  END IF;

  FOR v_org IN SELECT id FROM organizations LOOP
    INSERT INTO user_roles (user_id, org_id, role, is_active)
    SELECT v_uid, v_org.id, 'admin', true
     WHERE NOT EXISTS (
       SELECT 1 FROM user_roles WHERE user_id = v_uid AND org_id = v_org.id
     );
  END LOOP;

  SELECT id INTO v_landing FROM organizations WHERE name = 'RMPL';
  IF v_landing IS NULL THEN
    SELECT id INTO v_landing FROM organizations ORDER BY created_at LIMIT 1;
  END IF;
  UPDATE profiles SET org_id = COALESCE(org_id, v_landing) WHERE id = v_uid;
END $$;
