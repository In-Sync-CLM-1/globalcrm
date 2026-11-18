import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUserRole } from "@/hooks/useUserRole";
import { AJIMOS_ORG_ID } from "@/components/Gaming/gamingStats";

/**
 * Ajimos only: who may save a call outcome by hand on a contact.
 * Callers: their own assigned contacts. Calling manager and admins: any contact.
 * (The database enforces the same rule; this only decides whether to show the button.)
 */
export function useManualOutcomeAccess() {
  const { effectiveOrgId } = useOrgContext();
  const { isAdmin, isSuperAdmin, isSalesManager } = useUserRole();
  const enabled = effectiveOrgId === AJIMOS_ORG_ID;
  const { data: userId } = useQuery({
    queryKey: ["current-user-id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    enabled,
    staleTime: Infinity,
  });
  const privileged = isAdmin || isSuperAdmin || isSalesManager;
  return {
    enabled,
    canSaveFor: (assignedTo?: string | null) => enabled && (privileged || (!!userId && assignedTo === userId)),
  };
}
