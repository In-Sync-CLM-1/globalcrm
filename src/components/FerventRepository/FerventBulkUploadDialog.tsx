import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import { convertExcelToCsv, isExcelFile, isLegacyExcelFile, toCsvFileName } from "./ferventExcelToCsv";

type SourceType = "domestic" | "international";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_RECORDS = 50000;

const TEMPLATE_HEADERS = [
  "Sr. No.", "Unique ID", "DB Sourced Year", "UCDB Status", "Company Name",
  "First Name", "Last Name", "Designation", "Department",
  "Designation Level", "City", "State", "Country", "STD Code",
  "Phone 1", "Phone 2", "Phone 3", "Phone 4",
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
  // Excel files are converted to CSV before upload, so this is what actually
  // gets stored and processed — the same file for a CSV pick.
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string>("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const notification = useNotification();

  const validateFile = (f: File): string | null => {
    const isCsv = f.type.includes("csv") || f.name.toLowerCase().endsWith(".csv");
    if (!isCsv && !isExcelFile(f)) {
      if (isLegacyExcelFile(f)) {
        return "This is an old Excel format (.xls). Please open it in Excel and save it as .xlsx, then import again.";
      }
      return "Please select a CSV or Excel (.xlsx) file";
    }
    if (f.size > MAX_FILE_SIZE) return "File size must be less than 20MB";
    return null;
  };

  const resetSelection = () => {
    setFile(null);
    setUploadFile(null);
    setPreview(null);
    setSheetNotice("");
  };

  const acceptFile = async (f: File) => {
    setFile(f);
    setUploadFile(null);
    setPreview(null);
    setSheetNotice("");

    if (!isExcelFile(f)) {
      setUploadFile(f);
      try {
        setPreview(computePreview(await f.text()));
      } catch {
        // Preview is best-effort; the real validation happens on Upload.
      }
      return;
    }

    setIsReading(true);
    try {
      const { csvText, sheetName, ignoredSheets, rowCount } = await convertExcelToCsv(f);
      const converted = new File([csvText], toCsvFileName(f.name), { type: "text/csv" });
      if (converted.size > MAX_FILE_SIZE) {
        throw new Error("This spreadsheet holds more than 20MB of data. Please split it into smaller files.");
      }
      if (rowCount > MAX_RECORDS) {
        throw new Error(`This spreadsheet has ${rowCount.toLocaleString()} records. Maximum allowed is ${MAX_RECORDS.toLocaleString()}`);
      }
      setUploadFile(converted);
      setPreview(computePreview(csvText));
      if (ignoredSheets.length > 0) {
        const skipped = ignoredSheets.length === 1
          ? `The sheet "${ignoredSheets[0]}" was not included`
          : `${ignoredSheets.length} other sheets were not included`;
        setSheetNotice(`Reading the sheet "${sheetName}". ${skipped} — upload those separately if you need them.`);
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "This Excel file couldn't be read.");
      resetSelection();
    } finally {
      setIsReading(false);
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
    if (error) { setValidationError(error); resetSelection(); } else { setValidationError(""); acceptFile(dropped); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const error = validateFile(selected);
    if (error) { setValidationError(error); resetSelection(); } else { setValidationError(""); acceptFile(selected); }
    e.target.value = "";
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
    if (!uploadFile || !sourceType) return;
    setIsUploading(true);
    try {
      const text = await uploadFile.text();
      const lines = text.trim().split("\n");
      const recordCount = lines.length - 1;
      if (recordCount > MAX_RECORDS) {
        setValidationError(`File contains ${recordCount} records. Maximum allowed is ${MAX_RECORDS}`);
        setIsUploading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const fileName = `${Date.now()}-${uploadFile.name}`;
      const filePath = `${orgId}/bulk-imports/${fileName}`;

      const { error: uploadError } = await supabase.storage.from("import-files").upload(filePath, uploadFile);
      if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);

      const { data: job, error: jobError } = await supabase
        .from("import_jobs")
        .insert({
          org_id: orgId,
          user_id: user.id,
          file_name: uploadFile.name,
          file_path: filePath,
          import_type: "fervent_repository",
          status: "pending",
          total_rows: recordCount,
          current_stage: "uploaded",
          source_type: sourceType,
        })
        .select()
        .single();

      if (jobError) {
        await supabase.storage.from("import-files").remove([filePath]);
        if (jobError.code === "23505") {
          throw new Error("An import is already in progress for this database. Please wait for it to finish before importing again.");
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
      notification.success("Import started", countMessage);
      onUploadStarted();
      onOpenChange(false);
      resetSelection();
      setSourceType("");
    } catch (error) {
      notification.error("Import failed", error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      resetSelection();
      setValidationError("");
      setSourceType("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Data into Fervent Database</DialogTitle>
          <DialogDescription>
            Import your data in whatever column layout you have — we'll recognise the fields,
            fill in what can be inferred (like a name from an email), and format it for the database.
            Any rows we can't use are emailed back to you to fix. Max 50,000 records, 20MB.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} className="w-full">
            <Download className="w-4 h-4 mr-2" />
            Download Template (optional)
          </Button>
          <p className="mt-1 text-xs text-muted-foreground text-center">
            The template is just a convenience — your file doesn't need to match it.
          </p>
        </div>

        <div className="space-y-4">
          {validationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          <div>
            <Label className="text-sm font-medium">Source of this data *</Label>
            <RadioGroup
              value={sourceType}
              onValueChange={(v) => setSourceType(v as SourceType)}
              className="grid-cols-2 mt-1"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="domestic" id="source-domestic" />
                <Label htmlFor="source-domestic" className="font-normal cursor-pointer">Domestic</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="international" id="source-international" />
                <Label htmlFor="source-international" className="font-normal cursor-pointer">International</Label>
              </div>
            </RadioGroup>
          </div>

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
                {isReading && <p className="text-xs text-muted-foreground">Reading spreadsheet…</p>}
                {sheetNotice && <p className="text-xs text-amber-600">{sheetNotice}</p>}
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
                <Button type="button" variant="ghost" size="sm" disabled={isReading} onClick={() => { resetSelection(); setValidationError(""); }}>
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drag and drop your CSV or Excel file here, or click to browse</p>
                <input type="file" accept=".csv,.xlsx,.xlsm" onChange={handleFileSelect} className="hidden" id="fervent-file-upload" />
                <label htmlFor="fervent-file-upload">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
              </div>
            )}
          </div>

          <div className="bg-muted p-3 rounded-lg text-xs space-y-1">
            <p className="font-medium">How it works:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Choose whether this file is Domestic or International data — required for every upload, applied to every record it adds or updates</li>
              <li>Excel (.xlsx) or UTF-8 encoded CSV file — for Excel, the first sheet containing data is used</li>
              <li>Columns can be in any order and named however your source names them — we auto-detect them</li>
              <li>Each row needs at least a name, an email, or a phone number so it can be identified; rows with none of these are skipped and emailed back to you</li>
              <li>Mobile numbers should include the country code, e.g. <code className="bg-background px-1 rounded">+919876543210</code></li>
              <li>Rows are matched on <code className="bg-background px-1 rounded">Unique ID</code> when given — a matching ID updates that existing record; a new ID adds a new record</li>
              <li>Rows with no Unique ID are matched automatically (by phone, email, or AI name verification) and merged, or added as new with a system-assigned ID</li>
              <li>Maximum 50,000 records per upload; maximum file size 20MB</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isUploading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleUpload} disabled={!uploadFile || !sourceType || isUploading || isReading}>
              {isUploading ? "Importing..." : isReading ? "Reading..." : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
