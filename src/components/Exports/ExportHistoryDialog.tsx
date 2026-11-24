import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { useNotification } from "@/hooks/useNotification";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUserRole } from "@/hooks/useUserRole";
import { EXPORT_JOB_COLUMNS, EXPORT_KIND_LABELS, ExportJob, describeExport, downloadExport, formatBytes } from "@/lib/exportJobs";

interface ExportHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const actorName = (p: ExportJob["profiles"]) => [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "—";

export function ExportHistoryDialog({ open, onOpenChange }: ExportHistoryDialogProps) {
  const { user } = useAuth();
  const { effectiveOrgId } = useOrgContext();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const notify = useNotification();
  const [progress, setProgress] = useState<Record<string, number>>({});

  const { data: jobs = [], isLoading, isError } = useQuery({
    queryKey: ["export-jobs", effectiveOrgId, user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("export_jobs")
        .select(EXPORT_JOB_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as ExportJob[];
    },
    enabled: open && !!user,
    refetchInterval: (query) => ((query.state.data as ExportJob[] | undefined)?.some((j) => j.status === "preparing") ? 3000 : false),
  });

  const save = async (job: ExportJob) => {
    setProgress((p) => ({ ...p, [job.id]: 0 }));
    try {
      await downloadExport(job, (percent) => setProgress((p) => ({ ...p, [job.id]: percent })));
      notify.success("Download complete", `Saved to your Downloads folder as ${job.file_name}.`);
    } catch (err) {
      notify.error("Download failed", (err as Error).message);
    } finally {
      setProgress((p) => {
        const { [job.id]: _done, ...rest } = p;
        return rest;
      });
    }
  };

  const status = (job: ExportJob) => {
    const gone = job.status === "expired" || (job.status === "ready" && !!job.expires_at && new Date(job.expires_at) < new Date());
    if (job.status === "preparing") return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Preparing</Badge>;
    if (job.status === "failed") return <Badge variant="destructive">Failed</Badge>;
    if (gone) return <span className="text-xs text-muted-foreground">File removed</span>;
    if (job.requested_by !== user?.id && !isAdmin && !isSuperAdmin) return <Badge>Ready</Badge>;
    const percent = progress[job.id];
    return (
      <Button size="sm" variant="outline" onClick={() => save(job)} disabled={percent !== undefined}>
        {percent !== undefined ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
        {percent !== undefined ? `${percent}%` : "Download"}
      </Button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[900px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export History</DialogTitle>
          <DialogDescription>Files can be downloaded again for 7 days. You can leave the page while one is being prepared.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Export History could not be loaded. Please close this and try again.</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Export</TableHead>
                  <TableHead>Filters Used</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const what = describeExport(job);
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="whitespace-nowrap">{new Date(job.created_at).toLocaleString()}</TableCell>
                      <TableCell className="whitespace-nowrap">{actorName(job.profiles)}</TableCell>
                      <TableCell className="whitespace-nowrap">{EXPORT_KIND_LABELS[job.kind] ?? job.kind}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate" title={what}>{what}</TableCell>
                      <TableCell className="text-right">{job.row_count?.toLocaleString() ?? "—"}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatBytes(job.byte_count)}</TableCell>
                      <TableCell>
                        {status(job)}
                        {job.status === "failed" && job.error && <p className="text-xs text-muted-foreground mt-1">{job.error}</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
