// Chart color plan for the Fervent Dashboard, validated with the dataviz
// skill's validate_palette.js script (categorical, light + dark surfaces —
// all checks pass; coral/amber/emerald carry a contrast WARN so those slots
// always ship with a visible direct label, never color alone).
//
// Fixed hue order — never cycled, never reassigned by a chart's own sort:
// teal, coral, blue, purple, amber, emerald, indigo. Only two of the seven
// (teal, emerald) read as green, and each chart below is assigned a single
// explicit hue rather than defaulting to index 0, so green never becomes
// the dashboard's dominant color even though it anchors the array. An 8th+
// category folds into "Other" rather than generating a new hue.
const CATEGORICAL_LIGHT = ["#0DA893", "#F0512D", "#0D8FE0", "#8B3DF0", "#C9920A", "#0DAE6B", "#4547E0"];
const CATEGORICAL_DARK = ["#0D9E82", "#E85A3D", "#1D8FE0", "#9333EA", "#B8850F", "#0D9E5C", "#5457E8"];
const OTHER_GRAY_LIGHT = "#9CA6B4";
const OTHER_GRAY_DARK = "#7D8AA0";

// Sequential single-hue ramp (light -> dark) for magnitude encodings where
// color carries no identity (axis labels already do). Blue, not teal/green,
// so the "default" fill any bar chart falls back to isn't another green.
const SEQUENTIAL_LIGHT = ["#D6EAFB", "#9CCBF5", "#5CA8EA", "#0D8FE0", "#0A5F94"];
const SEQUENTIAL_DARK = ["#0A4A73", "#0D6FA8", "#1D8FE0", "#5CADEA", "#9CCBF5"];

// Warm ramp reserved for the daily-activity heatmap — intensity there reads
// naturally as "hot" in amber/red, and it keeps the calendar visually
// distinct from every teal/blue chart around it.
const WARM_LIGHT = ["#FDECD2", "#F8C98A", "#F0A24C", "#E06B2B", "#B8451A"];
const WARM_DARK = ["#7A2E10", "#B8451A", "#E06B2B", "#F0A24C", "#F8C98A"];

function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function resolveHsl(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw ? `hsl(${raw})` : fallback;
}

export interface FerventChartTheme {
  categorical: string[];
  otherGray: string;
  sequential: string[];
  warm: string[];
  text: string;
  mutedText: string;
  grid: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
}

// Reads the app's live CSS custom properties so the charts always match the
// current theme's actual tokens rather than an automatic light->dark invert.
export function getFerventChartTheme(): FerventChartTheme {
  const dark = isDarkMode();
  return {
    categorical: dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT,
    otherGray: dark ? OTHER_GRAY_DARK : OTHER_GRAY_LIGHT,
    sequential: dark ? SEQUENTIAL_DARK : SEQUENTIAL_LIGHT,
    warm: dark ? WARM_DARK : WARM_LIGHT,
    text: resolveHsl("--foreground", dark ? "#f7f8fa" : "#1e2a3a"),
    mutedText: resolveHsl("--muted-foreground", dark ? "#9aa5b5" : "#6b7684"),
    grid: resolveHsl("--border", dark ? "#2a3648" : "#e2e6eb"),
    surface: resolveHsl("--card", dark ? "#141c29" : "#ffffff"),
    tooltipBg: resolveHsl("--popover", dark ? "#141c29" : "#ffffff"),
    tooltipBorder: resolveHsl("--border", dark ? "#2a3648" : "#e2e6eb"),
  };
}
