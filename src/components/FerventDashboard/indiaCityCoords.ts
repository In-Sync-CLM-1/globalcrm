// City name -> [lng, lat] for the geo bubble map, plus common spelling
// variants folded to one canonical key so "Bengaluru"/"Bangalore" etc. land
// on the same bubble. Not exhaustive — cities outside this list still count
// toward the KPI/bar totals, they just don't get a map bubble.
export const CITY_ALIASES: Record<string, string> = {
  "new delhi": "delhi", "delhi ncr": "delhi", "delhi/ncr": "delhi", "pan india": "delhi", pan: "delhi",
  india: "delhi", multi: "delhi", bengaluru: "bangalore", bnglr: "bangalore", mumbaio: "mumbai", gurugram: "gurgaon",
};

export const ONLINE_CITY_LABELS = new Set(["webinar", "virtual", "online", "n/a", "na", "(no city)", ""]);

export const CITY_COORDS: Record<string, [number, number]> = {
  delhi: [77.21, 28.61], mumbai: [72.87, 19.08], bangalore: [77.59, 12.97], pune: [73.86, 18.52],
  hyderabad: [78.49, 17.39], chennai: [80.27, 13.08], kochi: [76.27, 9.93], noida: [77.39, 28.54],
  "greater noida": [77.5, 28.47], lonavala: [73.41, 18.75], ahmedabad: [72.57, 23.02], kolkata: [88.36, 22.57],
  chandigarh: [76.78, 30.73], jaipur: [75.79, 26.91], goa: [73.87, 15.49], lucknow: [80.95, 26.85],
  coimbatore: [76.96, 11.02], raipur: [81.63, 21.25], gurgaon: [77.03, 28.46], trivandrum: [76.95, 8.52],
  guwahati: [91.74, 26.14], rishikesh: [78.27, 30.09], bhubaneswar: [85.82, 20.3], aurangabad: [75.34, 19.88],
  nagpur: [79.09, 21.15], indore: [75.86, 22.72], surat: [72.83, 21.17], bhopal: [77.41, 23.26],
  visakhapatnam: [83.3, 17.69], vizag: [83.3, 17.69], patna: [85.14, 25.61], cochin: [76.27, 9.93],
};

export function canonicalCity(rawCity: string | null): string | null {
  const raw = (rawCity || "").toLowerCase().trim();
  if (!raw || ONLINE_CITY_LABELS.has(raw)) return null;
  return CITY_ALIASES[raw] || raw;
}
