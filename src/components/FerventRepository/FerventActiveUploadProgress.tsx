import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import { useFerventActiveImportJob } from "@/hooks/useFerventActiveImportJob";

interface FerventActiveUploadProgressProps {
  orgId: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  downloading: "Downloading file",
  validating: "Validating",
  parsing: "Parsing CSV",
  inserting: "Importing records",
  finalizing: "Finalizing",
};

export function FerventActiveUploadProgress({ orgId }: FerventActiveUploadProgressProps) {
  const { data: activeJob } = useFerventActiveImportJob(orgId);

  if (!activeJob) return null;

  const progress = activeJob.total_rows > 0
    ? Math.round(((activeJob.processed_rows || 0) / activeJob.total_rows) * 100)
    : 0;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <CardTitle className="text-base">Upload in progress</CardTitle>
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
