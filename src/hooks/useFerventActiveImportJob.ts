import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Returns the most recent Fervent import job of any status — including old,
// already-finished ones. In-progress jobs drive the live progress bar; a
// just-finished job (completed or rejected) lets the UI show the outcome
// until the user dismisses it.
//
// `data` is truthy as soon as an org has EVER run one import, forever after —
// it is NOT "there is an active import". Always gate on the `isRunning` field
// returned alongside it (never on `!!data`) when deciding whether to disable
// an upload button or treat an import as in-flight.
export function useFerventActiveImportJob(orgId: string | null) {
  const query = useQuery({
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

  const status = (query.data as { status?: string } | undefined)?.status;
  const isRunning = status === "pending" || status === "processing";

  return { ...query, isRunning };
}
