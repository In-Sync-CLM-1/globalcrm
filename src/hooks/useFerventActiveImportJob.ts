import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Returns the most recent Fervent import job of any status. In-progress jobs
// drive the live progress bar; a just-finished job (completed or rejected)
// lets the UI show the outcome — including a rejection reason or a
// "some rows were emailed back to you" note — until the user dismisses it.
export function useFerventActiveImportJob(orgId: string | null) {
  return useQuery({
    queryKey: ["fervent-active-import-job", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("org_id", orgId as string)
        .eq("import_type", "fervent_repository")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    refetchInterval: (query) => {
      // Poll fast while a job is running; stop polling once it's finished.
      const status = (query.state.data as { status?: string } | undefined)?.status;
      return status === "pending" || status === "processing" ? 2000 : false;
    },
  });
}
