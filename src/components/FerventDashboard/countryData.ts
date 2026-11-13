// Country name -> canonical world-map region name, plus the domestic/
// international classifier used everywhere the dashboard splits data by
// geography. The canonical names are exactly the feature names baked into
// worldMap.json (see WORLD_COUNTRY_NAMES), so a name that "matches" here is
// guaranteed to paint on the map.
//
// The underlying repository's `country` column is unreliable for a chunk of
// records — an import-mapping issue left company names sitting in the
// country field for a large slice of rows (confirmed live: ~31% of records
// have a non-country string like "Jyothy Laboratories Ltd." in `country`).
// Rather than guess, anything that isn't a recognized country name (India or
// otherwise) is classified as "Unclassified" — see feedback_unknown_is_not_zero:
// an unknown is never silently folded into a real bucket.
export const WORLD_COUNTRY_NAMES = [
  "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahamas", "Bangladesh", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
  "Bosnia and Herz.", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia",
  "Cameroon", "Canada", "Central African Rep.", "Chad", "Chile", "China", "Colombia", "Congo",
  "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Côte d'Ivoire", "Dem. Rep. Congo", "Denmark",
  "Djibouti", "Dominican Rep.", "Ecuador", "Egypt", "El Salvador", "Eq. Guinea", "Eritrea", "Estonia",
  "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece",
  "Greenland", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
  "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan",
  "Jordan", "Kazakhstan", "Kenya", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
  "Lesotho", "Liberia", "Libya", "Lithuania", "Luxembourg", "Macedonia", "Madagascar", "Malawi",
  "Malaysia", "Mali", "Mauritania", "Mexico", "Moldova", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nepal", "Netherlands", "New Caledonia", "New Zealand",
  "Nicaragua", "Niger", "Nigeria", "North Korea", "Norway", "Oman", "Pakistan", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar",
  "Romania", "Russia", "Rwanda", "S. Sudan", "Saudi Arabia", "Senegal", "Serbia", "Sierra Leone",
  "Slovakia", "Slovenia", "Solomon Is.", "Somalia", "Somaliland", "South Africa", "South Korea",
  "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Timor-Leste", "Togo", "Trinidad and Tobago", "Tunisia", "Turkey",
  "Turkmenistan", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
  "United States of America", "Uruguay", "Uzbekistan", "Vanuatu", "Venezuela", "Vietnam", "Yemen",
  "Zambia", "Zimbabwe", "eSwatini",
] as const;

// Countries too small to render as a filled region at world scale (absent
// from the 110m base map). Shown as point markers instead, same idea as the
// India city-bubble map's CITY_COORDS.
export const SMALL_NATION_COORDS: Record<string, [number, number]> = {
  Singapore: [103.82, 1.35],
  "Hong Kong": [114.11, 22.4],
};

const WORLD_COUNTRY_SET = new Set<string>([...WORLD_COUNTRY_NAMES, ...Object.keys(SMALL_NATION_COORDS)]);

// Common spelling/abbreviation variants seen in real vendor-list exports,
// folded to the canonical name used by the map + set above.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States of America",
  us: "United States of America",
  "u.s.a": "United States of America",
  "u.s.a.": "United States of America",
  "u.s": "United States of America",
  "u.s.": "United States of America",
  "united states": "United States of America",
  "united states of america": "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  "u.k": "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  uae: "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "u.a.e": "United Arab Emirates",
  "czech republic": "Czechia",
  "ivory coast": "Côte d'Ivoire",
  "cote d'ivoire": "Côte d'Ivoire",
  "north macedonia": "Macedonia",
  "dr congo": "Dem. Rep. Congo",
  "democratic republic of congo": "Dem. Rep. Congo",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "republic of congo": "Congo",
  burma: "Myanmar",
  "korea, south": "South Korea",
  "republic of korea": "South Korea",
  "korea republic": "South Korea",
  "korea, north": "North Korea",
  "russian federation": "Russia",
  swaziland: "eSwatini",
  eswatini: "eSwatini",
  hongkong: "Hong Kong",
  "hong kong sar": "Hong Kong",
  bharat: "India",
  ind: "India",
};

/**
 * Classify a raw `country` field value into the canonical map region name
 * (India, or any recognized country), or null if it doesn't match any known
 * country — the caller buckets those as "Unclassified" rather than guessing.
 */
export function canonicalCountry(raw: string | null): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  if (WORLD_COUNTRY_SET.has(trimmed)) return trimmed;
  const key = trimmed.toLowerCase();
  const alias = COUNTRY_ALIASES[key];
  if (alias) return alias;
  // Case-insensitive fallback against the canonical list itself.
  const found = [...WORLD_COUNTRY_SET].find((c) => c.toLowerCase() === key);
  return found || null;
}

export function isDomestic(raw: string | null): boolean {
  return canonicalCountry(raw) === "India";
}
