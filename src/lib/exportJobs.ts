import { supabase } from "@/integrations/supabase/client";

// Exports are made by the database (see migration 20261124090000_db_exports): the screen asks for one, a background
// worker writes the file, and the browser then downloads it in pieces.

export type ExportKind =
  | "fervent_repository"
  | "contacts"
  | "contact_search"
  | "whatsapp_messages"
  | "whatsapp_recipients"
  | "table";

export interface ExportJob {
  id: string;
  requested_by: string | null;
  kind: ExportKind;
  params: Record<string, unknown>;
  file_name: string;
  status: "preparing" | "ready" | "failed" | "expired";
  row_count: number | null;
  byte_count: number | null;
  chunk_count: number | null;
  error: string | null;
  created_at: string;
  expires_at: string | null;
  profiles: { first_name: string | null; last_name: string | null } | null;
}

export const EXPORT_JOB_COLUMNS =
  "id, requested_by, kind, params, file_name, status, row_count, byte_count, chunk_count, error, created_at, expires_at, profiles!requested_by(first_name, last_name)";

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  fervent_repository: "Database",
  contacts: "Contacts",
  contact_search: "Contact search",
  whatsapp_messages: "WhatsApp messages",
  whatsapp_recipients: "WhatsApp campaign",
  table: "Table",
};

// The tables and functions are newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Is this organisation's switch (settings.db_exports.enabled) on? Fervent's own database export does not need it. */
export async function dbExportsEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("db_exports_enabled");
  if (error) throw error;
  return !!data;
}

// Exports asked for in this tab. Kept in sessionStorage so a refresh does not lose track of them.
const PENDING_KEY = "pending-exports";
export const EXPORTS_CHANGED = "exports-changed";

export function pendingExports(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function savePending(ids: string[]) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be blocked; the export itself is unaffected and shows in Export History.
  }
  window.dispatchEvent(new Event(EXPORTS_CHANGED));
}

export const addPending = (id: string) => savePending([...new Set([...pendingExports(), id])]);
export const removePending = (id: string) => savePending(pendingExports().filter((x) => x !== id));

export async function requestExport(kind: ExportKind, params: Record<string, unknown>, fileName: string): Promise<string> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, error } = await db.rpc("request_export", {
    _kind: kind,
    _params: { ...params, tz },
    _file_name: fileName,
  });
  if (error) throw new Error(error.message);
  addPending(data as string);
  return data as string;
}

export async function fetchExportJobs(ids: string[]): Promise<ExportJob[]> {
  const { data, error } = await db.from("export_jobs").select(EXPORT_JOB_COLUMNS).in("id", ids);
  if (error) throw error;
  return (data || []) as ExportJob[];
}

async function fetchChunk(jobId: string, no: number): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await db.rpc("get_export_chunk", { _job: jobId, _no: no });
    if (!error) return data as string;
    // 42501 = refused, P0001 = no longer available: trying again will not help.
    if (attempt >= 4 || error.code === "42501" || error.code === "P0001") throw new Error(error.message);
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
}

/** Downloads a ready export into the browser's Downloads folder. */
export async function downloadExport(
  job: Pick<ExportJob, "id" | "chunk_count" | "file_name">,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const count = job.chunk_count || 0;
  if (count === 0) throw new Error("This file is empty.");
  const parts: BlobPart[] = new Array(count * 2 - 1).fill("\n");
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < count) {
      const no = next++;
      const text = await fetchChunk(job.id, no);
      // Held as a Blob so a large file does not sit in memory as text.
      parts[no * 2] = new Blob([text]);
      done++;
      onProgress?.(Math.round((done / count) * 100));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, count) }, worker));

  const url = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = job.file_name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function describeFilters(filters: unknown): string {
  if (!filters || typeof filters !== "object") return "";
  const active = Object.entries(filters as Record<string, unknown>)
    .map(([key, value]) => [key, valueText(value)] as const)
    .filter(([, text]) => text !== "");
  // matchMode is always saved, so on its own it does not mean a filter was used.
  if (active.every(([key]) => key === "matchMode")) return "";
  return active.map(([key, text]) => `${key}: ${text}`).join(", ");
}

/** What an export contained, in words, for Export History. */
export function describeExport(job: Pick<ExportJob, "kind" | "params">): string {
  const p = job.params || {};
  if (job.kind === "table") return valueText(p.table);
  const out: string[] = [];
  if (Array.isArray(p.ids) && p.ids.length) {
    out.push(`${p.ids.length} selected record(s)`);
  } else if (Array.isArray(p.conditions)) {
    const c = p.conditions as { label?: string; operator?: string; value?: unknown }[];
    out.push(c.map((x) => `${x.label ?? ""} ${String(x.operator ?? "").replace(/_/g, " ")} ${valueText(x.value)}`.trim()).join(", "));
  } else if (p.advanced && typeof p.advanced === "object") {
    const adv = p.advanced as { mode?: string; conditions?: { field: string; op: string; value: string }[] };
    out.push((adv.conditions || []).filter((c) => c.value?.trim()).map((c) => `${c.field} ${c.op.replace(/_/g, " ")} ${c.value.trim()}`)
      .join(adv.mode === "any" ? " or " : " and "));
  } else {
    out.push(describeFilters(p.filters ?? p.legacy));
  }
  if (p.status && p.status !== "all") out.push(`status: ${valueText(p.status)}`);
  if (Array.isArray(p.fields) && p.fields.length) out.push(`${p.fields.length} fields`);
  return out.filter(Boolean).join(" · ") || "None";
}

export function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
