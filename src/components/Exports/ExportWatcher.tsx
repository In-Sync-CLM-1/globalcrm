import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthProvider";
import { useNotification } from "@/hooks/useNotification";
import { EXPORTS_CHANGED, downloadExport, fetchExportJobs, pendingExports, removePending } from "@/lib/exportJobs";

/** Follows the exports asked for in this tab and downloads each one as soon as it is ready. */
export function ExportWatcher() {
  const { user } = useAuth();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [count, setCount] = useState(() => pendingExports().length);
  const busy = useRef(false);

  useEffect(() => {
    const update = () => setCount(pendingExports().length);
    window.addEventListener(EXPORTS_CHANGED, update);
    return () => window.removeEventListener(EXPORTS_CHANGED, update);
  }, []);

  useEffect(() => {
    if (!user || count === 0) return;
    const check = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const ids = pendingExports();
        if (ids.length === 0) return;
        const jobs = await fetchExportJobs(ids);
        for (const id of ids) {
          const job = jobs.find((j) => j.id === id);
          if (job?.status === "preparing") continue;
          // Taken off the list first, so a file is never downloaded twice.
          removePending(id);
          queryClient.invalidateQueries({ queryKey: ["export-jobs"] });
          if (!job || job.status === "expired") continue;
          if (job.status === "failed") {
            notify.error("Export failed", job.error || "Please try again.");
            continue;
          }
          try {
            await downloadExport(job);
            notify.success("Export ready", `${(job.row_count || 0).toLocaleString()} record(s) saved to your Downloads folder as ${job.file_name}.`);
          } catch (err) {
            notify.error("Download failed", `${(err as Error).message} The file is in Export History.`);
          }
        }
      } catch {
        // A dropped connection: the next check tries again.
      } finally {
        busy.current = false;
      }
    };
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [user, count, notify, queryClient]);

  return null;
}
