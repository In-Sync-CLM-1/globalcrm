// Normalization helpers for the Fervent Database's Employee Size and
// Turnover fields, shared by the Repository page's edit/bulk-edit dialogs
// and the CSV bulk-import pipeline (mirrored in
// supabase/functions/_shared/ferventFieldNormalization.ts — edge functions
// run on Deno and can't import from src/).

// LinkedIn's standard employee-headcount bands, stored without thousands
// separators to match the DB's existing bucket format (e.g. "10001-100000").
export const EMPLOYEE_SIZE_BUCKETS = [
  "1-10", "11-50", "51-200", "201-500", "501-1000",
  "1001-5000", "5001-10000", "10001-100000", "100001+",
];

const EMPLOYEE_SIZE_THRESHOLDS: [number, string][] = [
  [10, "1-10"], [50, "11-50"], [200, "51-200"], [500, "201-500"],
  [1000, "501-1000"], [5000, "1001-5000"], [10000, "5001-10000"],
  [100000, "10001-100000"], [Infinity, "100001+"],
];

// Maps a raw employee-count entry onto the standard bands above so it lines
// up with the fixed checkbox filter. Already-bucketed values pass through
// unchanged; a bare number gets bucketed; anything else (blank, unparseable
// text) is left as typed rather than silently discarded.
export function normalizeEmployeeSize(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || (EMPLOYEE_SIZE_BUCKETS as string[]).includes(trimmed)) return trimmed;
  const n = parseInt(trimmed.replace(/,/g, ""), 10);
  if (!Number.isFinite(n)) return trimmed;
  const bucket = EMPLOYEE_SIZE_THRESHOLDS.find(([max]) => n <= max);
  return bucket ? bucket[1] : trimmed;
}

// Parses a free-text turnover entry (e.g. "150 CR", "45 Lakh", "2B", "500M")
// into INR millions for the min/max range filter. Deliberately bails on any
// value containing "$" rather than guessing a USD->INR conversion rate for
// legacy dollar-denominated rows — those stay filterable by raw text only.
export function parseTurnoverInrMillion(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text || text.includes("$")) return null;
  const clean = text.replace(/,/g, "");
  const match = clean.match(/([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|lakh|lac|bn|billion|b|mn|million|m)\b/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit === "cr" || unit === "crore") return value * 10;
  if (unit === "lakh" || unit === "lac") return value * 0.1;
  if (unit === "bn" || unit === "billion" || unit === "b") return value * 1000;
  return value; // mn / million / m
}

export function formatTurnoverInrMillion(m: number): string {
  if (m >= 1000) {
    const b = m / 1000;
    return `₹${Number.isInteger(b) ? b : b.toFixed(1)}B`;
  }
  return `₹${Number.isInteger(m) ? m : m.toFixed(1)}M`;
}
