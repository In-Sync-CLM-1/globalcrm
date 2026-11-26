import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { useOrgContext } from "@/hooks/useOrgContext";
import { AJIMOS_ORG_ID } from "@/components/Gaming/gamingStats";

export interface DialixaStatus {
  enabled: boolean;
  /** The signed-in user's Dialixa extension, when they have one. */
  extension?: string | null;
  /** True when the softphone inside the CRM can connect for this user. */
  softphone?: boolean;
  /** Dialixa call reports are on for the organisation. */
  reports?: boolean;
  /** Seconds between calls when calling one after another (set by the admin, default 3). */
  next_call_gap?: number;
}

/** Dialixa calling (Ajimos only). Every other organisation gets { enabled: false } without asking the server. */
export function useDialixaStatus() {
  const { user } = useAuth();
  const { effectiveOrgId } = useOrgContext();
  return useQuery({
    queryKey: ["my-dialixa-status", user?.id],
    queryFn: async (): Promise<DialixaStatus> => {
      const { data, error } = await supabase.rpc("my_dialixa_status" as never);
      if (error) return { enabled: false };
      return (data ?? { enabled: false }) as unknown as DialixaStatus;
    },
    enabled: !!user && effectiveOrgId === AJIMOS_ORG_ID,
    staleTime: 5 * 60 * 1000,
  });
}
