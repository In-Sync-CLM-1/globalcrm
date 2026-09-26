-- RMPL (org 9b3528ad-8946-4f31-a1ca-1c8d3d782fb9) needs every client they
-- convert from Won to point at the RMPL OPM project where that client's
-- billing happens. This is only a reference used to identify the client on
-- RMPL's side for incentive tracking (e.g. Pulkit Jain's new-business
-- commission) -- it is not itself the billing record, and a client may end
-- up billed under several RMPL projects over time.
--
-- Mandatory only for RMPL -- other orgs on this platform aren't RMPL
-- clients and have no such project to reference.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS rmpl_project_id text;

CREATE OR REPLACE FUNCTION public.enforce_rmpl_project_id_on_client_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.org_id = '9b3528ad-8946-4f31-a1ca-1c8d3d782fb9'
     AND (NEW.rmpl_project_id IS NULL OR btrim(NEW.rmpl_project_id) = '') THEN
    RAISE EXCEPTION 'rmpl_project_id is required when marking an RMPL client Won';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rmpl_project_id ON public.clients;
CREATE TRIGGER trg_enforce_rmpl_project_id
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rmpl_project_id_on_client_insert();
