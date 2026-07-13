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
  "First Name", "Last Name", "Designation", "Department",
  "Designation Level", "City", "State", "Country", "STD Code",
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

interface UploadPreview {
  total: number;
  missingUniqueId: number;
}

// Mirrors the backend's CSV parsing (process-bulk-import/index.ts) closely
// enough to give an accurate pre-upload count — same quoted-comma handling
// and header normalization, so "will be processed" matches what actually
// happens once the file is uploaded.
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { current += '"'; i++; } else { inQuotes = !inQuotes; }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values.map((v) => v.replace(/^"|"$/g, ""));
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function computePreview(text: string): UploadPreview {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  const headers = lines.length > 0 ? parseCSVLine(lines[0]).map(normalizeHeader) : [];
  const uniqueIdIdx = headers.indexOf("unique_id");

  const total = Math.max(0, lines.length - 1);
  let missingUniqueId = 0;
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const uid = uniqueIdIdx >= 0 ? (values[uniqueIdIdx] || "").trim() : "";
    if (!uid) missingUniqueId++;
  }

  return { total, missingUniqueId };
}

export function FerventBulkUploadDialog({ open, onOpenChange, orgId, onUploadStarted }: FerventBulkUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const notification = useNotification();

  const validateFile = (f: File): string | null => {
    if (!f.type.includes("csv") && !f.name.endsWith(".csv")) return "Please select a CSV file";
    if (f.size > MAX_FILE_SIZE) return "File size must be less than 10MB";
    return null;
  };

  const acceptFile = async (f: File) => {
    setFile(f);
    setPreview(null);
    try {
      const text = await f.text();
      setPreview(computePreview(text));
    } catch {
      // Preview is best-effort; the real validation happens on Upload.
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const error = validateFile(dropped);
    if (error) { setValidationError(error); setFile(null); setPreview(null); } else { setValidationError(""); acceptFile(dropped); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const error = validateFile(selected);
    if (error) { setValidationError(error); setFile(null); setPreview(null); } else { setValidationError(""); acceptFile(selected); }
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
      if (!headerLine.includes("first name") && !headerLine.includes("first_name")) {
        setValidationError("CSV must contain a 'First Name' column");
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

      const countMessage = preview
        ? `${preview.total} records will be processed${preview.missingUniqueId > 0 ? ` (${preview.missingUniqueId} without a Unique ID will be matched automatically)` : ""}.`
        : "Your file is being processed in the background.";
      notification.success("Upload started", countMessage);
      onUploadStarted();
      onOpenChange(false);
      setFile(null);
      setPreview(null);
    } catch (error: any) {
      notification.error("Upload failed", error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setFile(null);
      setPreview(null);
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
                {preview && (
                  <p className="text-xs">
                    {preview.missingUniqueId > 0 ? (
                      <span className="text-amber-600">
                        All {preview.total} records will be processed — {preview.missingUniqueId} have no Unique ID and will be matched automatically against existing records
                      </span>
                    ) : (
                      <span className="text-muted-foreground">All {preview.total} records will be processed</span>
                    )}
                  </p>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFile(null); setPreview(null); setValidationError(""); }}>
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
              <li>Required column: <code className="bg-background px-1 rounded">First Name</code></li>
              <li><code className="bg-background px-1 rounded">Mobile Number 1</code> should include the country code, e.g. <code className="bg-background px-1 rounded">+919876543210</code></li>
              <li>Rows are matched on <code className="bg-background px-1 rounded">Unique ID</code> when given — a matching ID updates that existing record with this upload's data; a new ID adds a new record</li>
              <li>Rows with no Unique ID are matched automatically against existing records (by phone, email, or AI name verification) and merged in, or added as new with a system-assigned ID if no match is found</li>
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
