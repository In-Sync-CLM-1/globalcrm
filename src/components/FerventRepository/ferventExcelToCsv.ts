import type { Row } from "read-excel-file/browser";

export interface ExcelConversion {
  csvText: string;
  sheetName: string;
  /** Names of the other sheets in the workbook, which were not imported. */
  ignoredSheets: string[];
  /** Data rows, excluding the header row. */
  rowCount: number;
}

export const EXCEL_EXTENSIONS = [".xlsx", ".xlsm"];

export function isExcelFile(file: File): boolean {
  return EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

/** Legacy Excel 97-2003, which the reader can't open — worth a specific message. */
export function isLegacyExcelFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xls");
}

/** Swap the Excel extension for .csv, since that's what actually gets uploaded. */
export function toCsvFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".csv";
}

function formatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  // Newlines inside a cell would split one record across several lines, and both
  // the preview here and the backend importer read the file line by line.
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function escapeCsv(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function isEmptyRow(row: Row): boolean {
  return row.every((cell) => cellToText(cell) === "");
}

/**
 * Serialises sheet rows to CSV, padding every row to the widest one so the
 * header and its values stay aligned even when trailing cells are blank.
 */
export function rowsToCsv(rows: Row[]): string {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows
    .map((row) => {
      const cells: string[] = [];
      for (let i = 0; i < columnCount; i++) cells.push(escapeCsv(cellToText(row[i])));
      return cells.join(",");
    })
    .join("\n");
}

/**
 * Builds the CSV from an already-read workbook. Workbooks often lead with a
 * blank cover sheet, so this takes the first sheet that actually has data
 * rather than blindly taking sheet 1.
 */
export function workbookToCsv(sheets: { sheet: string; data: Row[] }[]): ExcelConversion {
  const populated = sheets.find((s) => s.data.some((row) => !isEmptyRow(row)));
  if (!populated) throw new Error("This Excel file has no data in it.");

  const rows = populated.data.filter((row) => !isEmptyRow(row));

  return {
    csvText: rowsToCsv(rows),
    sheetName: populated.sheet,
    ignoredSheets: sheets.filter((s) => s !== populated).map((s) => s.sheet),
    rowCount: Math.max(0, rows.length - 1),
  };
}

/**
 * Converts the first populated sheet of an Excel workbook to CSV text, so the
 * rest of the import pipeline (preview, upload, backend parsing) keeps working
 * on CSV exactly as before.
 */
/**
 * Loads the Excel reader chunk, self-healing once if the build moved on
 * since this tab was opened (stale chunk hash after a deploy).
 */
async function loadExcelReader() {
  try {
    return await import("read-excel-file/browser");
  } catch {
    const key = "ferven_excel_chunk_reload";
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
      return new Promise<typeof import("read-excel-file/browser")>(() => {});
    }
    throw new Error("This page is out of date. Please refresh the page and try again.");
  }
}

export async function convertExcelToCsv(file: File): Promise<ExcelConversion> {
  const { default: readXlsxFile } = await loadExcelReader();

  let sheets: { sheet: string; data: Row[] }[];
  try {
    sheets = await readXlsxFile(file);
  } catch {
    throw new Error("This Excel file couldn't be read. Please re-save it as .xlsx or export it as CSV.");
  }

  return workbookToCsv(sheets);
}
