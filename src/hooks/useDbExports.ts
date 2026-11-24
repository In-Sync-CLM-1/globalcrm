import { useQuery } from "@tanstack/react-query";
import { dbExportsEnabled } from "@/lib/exportJobs";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useAuth } from "@/contexts/AuthProvider";

/** Are database exports switched on for this organisation? `ready` is false until that is known. */
export function useDbExports() {
  const { effectiveOrgId, isLoading } = useOrgContext();
  const { user } = useAuth();
  const { data, isFetched } = useQuery({
    queryKey: ["db-exports-enabled", effectiveOrgId, user?.id],
    queryFn: dbExportsEnabled,
    enabled: !!user && !isLoading,
    staleTime: 5 * 60 * 1000,
  });
  return { enabled: !!data, ready: isFetched };
}
