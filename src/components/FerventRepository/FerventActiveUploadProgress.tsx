import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Mail, X } from "lucide-react";
import { useFerventActiveImportJob } from "@/hooks/useFerventActiveImportJob";

interface FerventActiveUploadProgressProps {
  orgId: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  uploaded: "File received",
  downloading: "Downloading file",
  validating: "Understanding your file",
  parsing: "Formatting rows",
  inserting: "Importing records",
  finalizing: "Finalizing",
};

// Only keep showing a finished job's outcome for a short window after it ends.
const RESULT_VISIBLE_MS = 30 * 60 * 1000;

interface StageDetails {
  rejected?: boolean;
  rejection_reason?: string;
  error?: string;
  skipped_count?: number;
  skipped_email_sent?: boolean;
  skipped_email_to?: string | null;
}

export function FerventActiveUploadProgress({ orgId }: FerventActiveUploadProgressProps) {
  const { data: activeJob, isRunning } = useFerventActiveImportJob(orgId);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (!activeJob) return null;

  const status = activeJob.status as string;
  const details = (activeJob.stage_details || {}) as StageDetails;

  // Running job -> live progress bar.
  if (isRunning) {
    const progress = activeJob.total_rows > 0
      ? Math.round(((activeJob.processed_rows || 0) / activeJob.total_rows) * 100)
      : 0;

    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <CardTitle className="text-base">Import in progress</CardTitle>
          </div>
          <CardDescription className="truncate">{activeJob.file_name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{STAGE_LABELS[activeJob.current_stage || ""] || "Processing"}</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="grid grid-cols-5 gap-3 pt-1 text-sm">
            <div>
              <p className="text-muted-foreground">Total</p>
              <p className="font-medium">{activeJob.total_rows || 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Inserted</p>
              <p className="font-medium text-green-600">{activeJob.success_count || 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Updated</p>
              <p className="font-medium text-blue-600">{activeJob.updated_count || 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Duplicates</p>
              <p className="font-medium text-amber-600">{activeJob.duplicate_count || 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Errors</p>
              <p className="font-medium text-destructive">{activeJob.error_count || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Finished job -> show the outcome briefly, then let the user dismiss it.
  const finishedAt = activeJob.completed_at ? new Date(activeJob.completed_at).getTime() : 0;
  const recent = finishedAt > 0 && Date.now() - finishedAt < RESULT_VISIBLE_MS;
  if (!recent || dismissedId === activeJob.id) return null;

  // Rejected / failed file: show the reason so it can be fixed and re-uploaded.
  if (status === "failed") {
    const reason = details.rejection_reason || details.error || "The file could not be imported.";
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <CardTitle className="text-base">File not imported</CardTitle>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDismissedId(activeJob.id)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription className="truncate">{activeJob.file_name}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">{reason}</p>
        </CardContent>
      </Card>
    );
  }

  // Completed: quick summary, plus the skipped/emailed note when relevant.
  const skipped = details.skipped_count || 0;
  return (
    <Card className="border-green-500/30 bg-green-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <CardTitle className="text-base">Import complete</CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDismissedId(activeJob.id)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription className="truncate">{activeJob.file_name}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Inserted</p>
            <p className="font-medium text-green-600">{activeJob.success_count || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Updated</p>
            <p className="font-medium text-blue-600">{activeJob.updated_count || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Duplicates</p>
            <p className="font-medium text-amber-600">{activeJob.duplicate_count || 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Skipped</p>
            <p className="font-medium text-muted-foreground">{skipped}</p>
          </div>
        </div>
        {skipped > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {skipped.toLocaleString()} row{skipped === 1 ? "" : "s"} couldn't be identified and {details.skipped_email_sent
                ? <>were emailed{details.skipped_email_to ? <> to <strong>{details.skipped_email_to}</strong></> : ""} to fix and import again.</>
                : <>could not be imported.</>}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
