-- Fix: manually-added contacts vanish for their own creator
-- ============================================================
-- 20260518094000_contacts_assigned_only_for_sdrs.sql restricted non-manager
-- roles (e.g. sales_agent) to only view/update contacts where
-- assigned_to = auth.uid(). Several contact-creation paths
-- (QuickDial "save as contact", ClientHub "convert external entity to
-- contact") never set assigned_to on insert, so a plain sales_agent who
-- creates one of these gets a row that is immediately invisible and
-- unassignable to them -- not even the creator can go back and assign it
-- to themselves, since the SELECT/UPDATE policy has no created_by fallback.
--
-- Proven live on RMPL: sales_agent Tannu Kumari (600341e2-...) created
-- several contacts via QuickDial that landed with assigned_to = NULL and
-- were stuck outside her access.
--
-- Fix: creator always retains access to a record they created, regardless
-- of assignment state, same as it always should have.
-- ============================================================

DROP POLICY IF EXISTS "Users can view contacts in their org" ON public.contacts;
CREATE POLICY "Users can view contacts in their org" ON public.contacts
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND org_id = public.get_user_org_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'sales_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'support_manager'::public.app_role)
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update contacts in their org" ON public.contacts;
CREATE POLICY "Users can update contacts in their org" ON public.contacts
  FOR UPDATE TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND org_id = public.get_user_org_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'sales_manager'::public.app_role)
      OR public.has_role(auth.uid(), 'support_manager'::public.app_role)
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
    )
  )
  WITH CHECK (
    org_id = public.get_user_org_id(auth.uid())
  );

-- No data backfill here on purpose: an unassigned contact with created_by
-- set could be a deliberate unclaimed-pool row from a bulk import (creator
-- = the importing admin/manager, who already has full org-wide access).
-- Forcing assigned_to = created_by on all such rows would silently pull
-- those out of the pool. The policy fix above is what restores the
-- creator's own access; reassignment for genuinely orphaned records (like
-- the RMPL ones this bug produced) is a normal in-app "Assign To" action
-- now that the creator can see them again.
