import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useFerventActiveImportJob(orgId: string | null) {
  return useQuery({
    queryKey: ["fervent-active-import-job", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("org_id", orgId as string)
        .eq("import_type", "fervent_repository")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    refetchInterval: 2000,
  });
}
