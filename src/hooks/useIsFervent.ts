import { useOrgContext } from "@/hooks/useOrgContext";

export const FERVENT_ORG_ID = "6235726a-56f9-4851-9413-bc5cca39e90d";

export function useIsFervent(): { isFervent: boolean; isLoading: boolean; orgId: string | null } {
  const { effectiveOrgId, isLoading } = useOrgContext();
  return {
    isFervent: effectiveOrgId === FERVENT_ORG_ID,
    isLoading,
    orgId: effectiveOrgId,
  };
}
