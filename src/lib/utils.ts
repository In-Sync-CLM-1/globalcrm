import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Storage object keys reject control characters (including a raw newline
// pasted into a Windows filename, e.g. "...June 19\n2026...") and several
// punctuation characters — strip/replace them so the upload always succeeds.
// The original name is preserved separately (e.g. import_jobs.file_name) for
// display; this is only for the storage path.
export function sanitizeStorageFileName(name: string): string {
  const controlCharPattern = new RegExp("[\\x00-\\x1F\\x7F]", "g");
  return (
    name
      .replace(controlCharPattern, " ")
      .replace(/[<>:"|?*\\/]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file"
  );
}
