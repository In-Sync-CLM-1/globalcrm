import { useOrgContext } from "@/hooks/useOrgContext";
import { useUserRole } from "@/hooks/useUserRole";
import { GAMING_ORG_ID } from "@/components/Gaming/gamingStats";
import { maskEmail, maskPhone } from "@/lib/pii";

/**
 * Data-handling rules for the Gaming CRM Demo org: only admins may upload or export data,
 * and callers see masked phone numbers and emails. Every other org is unrestricted.
 * Fails closed: while the role is still loading, a Gaming user is treated as a caller.
 */
export function useGamingAccess() {
  const { effectiveOrgId, isPlatformAdmin } = useOrgContext();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const isGaming = effectiveOrgId === GAMING_ORG_ID;
  const privileged = !!(isAdmin || isSuperAdmin || isPlatformAdmin);
  const masked = isGaming && !privileged;
  return {
    isGaming,
    canExport: !isGaming || privileged,
    canUpload: !isGaming || privileged,
    masked,
    phone: (v: string | null | undefined) => (masked ? maskPhone(v) : v ?? ""),
    email: (v: string | null | undefined) => (masked ? maskEmail(v) : v ?? ""),
  };
}
