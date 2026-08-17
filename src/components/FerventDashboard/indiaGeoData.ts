// State + city canonicalization for the India detail map (state choropleth
// + city bubbles). Two separate concerns living in one file because they're
// only ever consumed together, by the same chart.
//
// Both raw fields are messy in real data (verified live, 2026-08-17):
//  - `state` mixes real state names (sometimes with diacritics — "Mahārāshtra",
//    "Telangāna"), the literal placeholder "IND"/"Unspecified", and non-Indian
//    region codes from international-targeted imports (NA/EU/APAC/MEA/SEA/FSE/
//    ASEAN/UKI/ANZ/ME, even "France"/"California"/"Sri Lanka" — a separate,
//    still-open data-quality issue, not something this dashboard can fix by
//    guessing). None of those render on an India state map.
//  - `city` mixes bare city names with full "City, State, Country" strings
//    ("Mumbai, Maharashtra, India") and diacritics ("Hyderābād").
//
// Both canonicalizers are conservative: unmatched values simply don't render
// on the map (they still count in every KPI/other aggregate) rather than
// guessing a placement.

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// The 36 states/UTs actually present in indiaMap.json (src/assets/indiaMap.json),
// i.e. the exact set of names the choropleth can render.
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

/** Canonicalize a raw `state` value to one of the 36 map-renderable names, or null. */
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

// City name -> [lng, lat] for the bubble layer. Not exhaustive — cities
// outside this list still count toward every other total, they just don't
// get a bubble.
const CITY_ALIASES: Record<string, string> = {
  "new delhi": "delhi", "delhi ncr": "delhi", "delhi/ncr": "delhi", "delhi delhi": "delhi",
  "bangalore / bengaluru": "bangalore", bengaluru: "bangalore", bnglr: "bangalore",
  gurugram: "gurgaon", "hyderabad/ secunderabad": "hyderabad", "hyderabad/secunderabad": "hyderabad",
  hyderabad_secunderabad: "hyderabad", secunderabad: "hyderabad",
};

const NON_CITY_LABELS = new Set(["webinar", "virtual", "online", "n/a", "na", "(no city)", "", "india", "unspecified"]);

export const CITY_COORDS: Record<string, [number, number]> = {
  delhi: [77.21, 28.61], mumbai: [72.87, 19.08], bangalore: [77.59, 12.97], pune: [73.86, 18.52],
  hyderabad: [78.49, 17.39], chennai: [80.27, 13.08], kochi: [76.27, 9.93], noida: [77.39, 28.54],
  "greater noida": [77.5, 28.47], lonavala: [73.41, 18.75], ahmedabad: [72.57, 23.02], kolkata: [88.36, 22.57],
  chandigarh: [76.78, 30.73], jaipur: [75.79, 26.91], goa: [73.87, 15.49], lucknow: [80.95, 26.85],
  coimbatore: [76.96, 11.02], raipur: [81.63, 21.25], gurgaon: [77.03, 28.46], trivandrum: [76.95, 8.52],
  guwahati: [91.74, 26.14], rishikesh: [78.27, 30.09], bhubaneswar: [85.82, 20.3], aurangabad: [75.34, 19.88],
  nagpur: [79.09, 21.15], indore: [75.86, 22.72], surat: [72.83, 21.17], bhopal: [77.41, 23.26],
  visakhapatnam: [83.3, 17.69], vizag: [83.3, 17.69], patna: [85.14, 25.61], cochin: [76.27, 9.93],
  faridabad: [77.31, 28.41], ghaziabad: [77.44, 28.67], thane: [72.97, 19.22],
};

/**
 * Canonicalize a raw `city` value to one of CITY_COORDS's keys, or null.
 * Handles the common "City, State, Country" compound form by taking only
 * the first comma-separated segment (the real cases carry it exactly this
 * way: "Mumbai, Maharashtra, India") — a bare space-separated triple with no
 * comma ("Pune Mahārāshtra India") isn't reliably splittable and is left
 * unmapped rather than guessed.
 */
export function canonicalCity(raw: string | null): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const firstSegment = stripDiacritics(trimmed.split(",")[0].trim().toLowerCase());
  if (!firstSegment || NON_CITY_LABELS.has(firstSegment)) return null;
  const key = CITY_ALIASES[firstSegment] || firstSegment;
  return CITY_COORDS[key] ? key : null;
}
