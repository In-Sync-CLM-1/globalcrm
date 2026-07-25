import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ImportJobRow {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  success_count: number | null;
  error_count: number | null;
  duplicate_count: number | null;
  updated_count: number | null;
  stage_details: {
    duplicate_samples?: Array<{ matched_on: string; value: string }>;
    rejection_reason?: string;
    error?: string;
    skipped_count?: number;
    skipped_email_sent?: boolean;
  } | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  completed: "default",
  processing: "secondary",
  pending: "secondary",
  failed: "destructive",
};

interface FerventImportHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
}

export function FerventImportHistory({ open, onOpenChange, orgId }: FerventImportHistoryProps) {
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["fervent-import-history", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("id, file_name, status, created_at, success_count, error_count, duplicate_count, updated_count, stage_details")
        .eq("org_id", orgId)
        .eq("import_type", "fervent_repository")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as ImportJobRow[];
    },
    enabled: open && !!orgId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[750px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import History</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Inserted</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Duplicates Skipped</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const samples = job.stage_details?.duplicate_samples || [];
                const reason = job.status === "failed"
                  ? (job.stage_details?.rejection_reason || job.stage_details?.error)
                  : undefined;
                const skipped = job.stage_details?.skipped_count || 0;
                return (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-[180px]">
                      <div className="truncate" title={job.file_name}>{job.file_name}</div>
                      {reason && <div className="text-xs text-destructive mt-0.5 whitespace-normal">{reason}</div>}
                      {job.status !== "failed" && skipped > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5 whitespace-normal">
                          {skipped.toLocaleString()} skipped{job.stage_details?.skipped_email_sent ? " · emailed back" : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[job.status] || "secondary"} title={reason}>{job.status}</Badge>
                    </TableCell>
                    <TableCell>{job.success_count ?? 0}</TableCell>
                    <TableCell>{job.updated_count ?? 0}</TableCell>
                    <TableCell>
                      {job.duplicate_count ? (
                        <span title={samples.map((s) => `${s.matched_on}: ${s.value}`).join("\n")}>
                          {job.duplicate_count}
                        </span>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell>{job.error_count ?? 0}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(job.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
