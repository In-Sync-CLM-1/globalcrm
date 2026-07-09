import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RECORDS = 5000;

const TEMPLATE_HEADERS = [
  "Sr. No.", "Unique ID", "DB Sourced Year", "UCDB Status", "Company Name",
  "First Name", "Last Name", "Full Name", "Designation", "Department",
  "Designation Level", "City", "State", "Country", "ISD Code", "STD Code",
  "Mobile Number 1", "Mobile Number 2", "Direct Number", "Phone Number",
  "Official Email ID", "Personal Email ID 1", "Personal Email ID 2",
  "Contact LinkedIn ID", "Domain Name", "Website", "Industry", "SubIndustry",
  "Employee Size", "Turnover", "Company LinkedIn ID",
];

interface FerventBulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onUploadStarted: () => void;
}

export function FerventBulkUploadDialog({ open, onOpenChange, orgId, onUploadStarted }: FerventBulkUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const notification = useNotification();

  const validateFile = (f: File): string | null => {
    if (!f.type.includes("csv") && !f.name.endsWith(".csv")) return "Please select a CSV file";
    if (f.size > MAX_FILE_SIZE) return "File size must be less than 10MB";
    return null;
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const error = validateFile(dropped);
    if (error) { setValidationError(error); setFile(null); } else { setValidationError(""); setFile(dropped); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const error = validateFile(selected);
    if (error) { setValidationError(error); setFile(null); } else { setValidationError(""); setFile(selected); }
  };

  const downloadTemplate = () => {
    const csvContent = TEMPLATE_HEADERS.join(",") + "\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fervent_database_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    notification.info("Template downloaded", "Use this template to format your data file.");
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      const recordCount = lines.length - 1;
      if (recordCount > MAX_RECORDS) {
        setValidationError(`File contains ${recordCount} records. Maximum allowed is ${MAX_RECORDS}`);
        setIsUploading(false);
        return;
      }

      const headerLine = lines[0].toLowerCase();
      if (!headerLine.includes("full name") && !headerLine.includes("full_name")) {
        setValidationError("CSV must contain a 'Full Name' column");
        setIsUploading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const fileName = `${Date.now()}-${file.name}`;
      const filePath = `${orgId}/bulk-imports/${fileName}`;

      const { error: uploadError } = await supabase.storage.from("import-files").upload(filePath, file);
      if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);

      const { data: job, error: jobError } = await supabase
        .from("import_jobs")
        .insert({
          org_id: orgId,
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          import_type: "fervent_repository",
          status: "pending",
          total_rows: recordCount,
          current_stage: "uploaded",
        })
        .select()
        .single();

      if (jobError) {
        await supabase.storage.from("import-files").remove([filePath]);
        if (jobError.code === "23505") {
          throw new Error("An import is already in progress for this database. Please wait for it to finish before uploading again.");
        }
        throw new Error(`Failed to create import job: ${jobError.message}`);
      }

      const { error: triggerError } = await supabase.functions.invoke("bulk-import-trigger", {
        body: { importJobId: job.id },
      });
      if (triggerError) throw triggerError;

      notification.success("Upload started", "Your file is being processed in the background");
      onUploadStarted();
      onOpenChange(false);
      setFile(null);
    } catch (error: any) {
      notification.error("Upload failed", error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setFile(null);
      setValidationError("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Bulk Upload Fervent Database</DialogTitle>
          <DialogDescription>
            Upload a CSV file with your database. Maximum 5,000 records and 10MB file size.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} className="w-full">
            <Download className="w-4 h-4 mr-2" />
            Download CSV Template
          </Button>
        </div>

        <div className="space-y-4">
          {validationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="space-y-2">
                <FileText className="h-12 w-12 mx-auto text-primary" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(2)} KB</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFile(null); setValidationError(""); }}>
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drag and drop your CSV file here, or click to browse</p>
                <input type="file" accept=".csv" onChange={handleFileSelect} className="hidden" id="fervent-file-upload" />
                <label htmlFor="fervent-file-upload">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
              </div>
            )}
          </div>

          <div className="bg-muted p-3 rounded-lg text-xs space-y-1">
            <p className="font-medium">Requirements:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>UTF-8 encoded CSV file</li>
              <li>Required column: <code className="bg-background px-1 rounded">Full Name</code></li>
              <li>Rows are matched on <code className="bg-background px-1 rounded">Unique ID</code> — a matching ID updates that existing record with this upload's data; a new ID adds a new record</li>
              <li>Rows with no Unique ID are skipped if their Mobile Number or Email already exists</li>
              <li>Maximum 5,000 records per upload</li>
              <li>Maximum file size: 10MB</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isUploading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleUpload} disabled={!file || isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
