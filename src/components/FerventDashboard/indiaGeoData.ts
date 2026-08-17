// State + city canonicalization for the India-specific charts (state
// treemap + city leaderboard). Two separate concerns living in one file
// because they're only ever consumed by the same pair of adjacent cards.
//
// Both raw fields are messy in real data (verified live, 2026-08-17):
//  - `state` mixes real state names (sometimes with diacritics — "Mahārāshtra",
//    "Telangāna"), the literal placeholder "IND"/"Unspecified", and non-Indian
//    region codes from international-targeted imports (NA/EU/APAC/MEA/SEA/FSE/
//    ASEAN/UKI/ANZ/ME, even "France"/"California"/"Sri Lanka" — a separate,
//    still-open data-quality issue, not something this dashboard can fix by
//    guessing). None of those are real states.
//  - `city` mixes bare city names with full "City, State, Country" strings
//    ("Mumbai, Maharashtra, India") and diacritics ("Hyderābād").
//
// Both canonicalizers are conservative: unmatched values return null (they
// still count in every KPI/other aggregate) rather than guessing.

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// The 36 states/UTs India is officially divided into (matches
// src/assets/indiaMap.json's feature list, though that file is no longer
// rendered directly by this dashboard — this list is the source of truth
// for "is this a real Indian state" independent of any map).
export const INDIA_STATE_NAMES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Chandigarh", "Puducherry",
  "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep",
] as const;

const STATE_SET = new Set<string>(INDIA_STATE_NAMES);

const STATE_ALIASES: Record<string, string> = {
  orissa: "Odisha",
  "jammu & kashmir": "Jammu and Kashmir",
  "delhi ncr": "Delhi",
  "new delhi": "Delhi",
  ncr: "Delhi",
  pondicherry: "Puducherry",
  uttaranchal: "Uttarakhand",
};

/** Canonicalize a raw `state` value to one of the 36 real state/UT names, or null. */
export function canonicalState(raw: string | null): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const clean = stripDiacritics(trimmed);
  if (STATE_SET.has(clean)) return clean;
  const key = clean.toLowerCase();
  const alias = STATE_ALIASES[key];
  if (alias) return alias;
  const found = INDIA_STATE_NAMES.find((s) => s.toLowerCase() === key);
  return found || null;
}

// Common spelling/compound-string variants folded to one canonical,
// display-ready city name.
const CITY_ALIASES: Record<string, string> = {
  "new delhi": "Delhi", "delhi ncr": "Delhi", "delhi/ncr": "Delhi", "delhi delhi": "Delhi",
  "bangalore / bengaluru": "Bangalore", bengaluru: "Bangalore", bnglr: "Bangalore",
  gurugram: "Gurgaon", "hyderabad/ secunderabad": "Hyderabad", "hyderabad/secunderabad": "Hyderabad",
  secunderabad: "Hyderabad", "greater noida": "Noida", cochin: "Kochi", vizag: "Visakhapatnam",
};

const NON_CITY_LABELS = new Set(["webinar", "virtual", "online", "n/a", "na", "(no city)", "", "india", "unspecified"]);

/**
 * Canonicalize a raw `city` value to a clean, display-ready name, or null.
 * Handles the common "City, State, Country" compound form by taking only
 * the first comma-separated segment (the real cases carry it exactly this
 * way: "Mumbai, Maharashtra, India") — a bare space-separated triple with no
 * comma ("Pune Mahārāshtra India") isn't reliably splittable and is left
 * unmapped rather than guessed. Unlike a map, a ranked list doesn't need a
 * known coordinate to show a city, so this accepts anything that looks like
 * a real place name rather than gating on a fixed whitelist.
 */
export function canonicalCity(raw: string | null): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const firstSegment = stripDiacritics(trimmed.split(",")[0].trim());
  const key = firstSegment.toLowerCase();
  if (!key || NON_CITY_LABELS.has(key) || /^\d+$/.test(key)) return null;
  return CITY_ALIASES[key] || titleCase(firstSegment);
}
