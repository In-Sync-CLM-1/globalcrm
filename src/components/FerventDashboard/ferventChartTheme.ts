// Chart color plan for the Fervent Dashboard, validated with the dataviz
// skill's validate_palette.js script (categorical, light + dark surfaces —
// all checks pass; teal/amber/emerald carry a contrast WARN so those slots
// always ship with a visible direct label, never color alone).
//
// Fixed hue order — never cycled, never reassigned by a chart's own sort:
// teal, coral, blue, purple, amber, emerald, indigo. An 8th+ category folds
// into "Other" rather than generating a new hue.
const CATEGORICAL_LIGHT = ["#0DA893", "#F0512D", "#0D8FE0", "#8B3DF0", "#C9920A", "#0DAE6B", "#4547E0"];
const CATEGORICAL_DARK = ["#0D9E82", "#E85A3D", "#1D8FE0", "#9333EA", "#B8850F", "#0D9E5C", "#5457E8"];
const OTHER_GRAY_LIGHT = "#9CA6B4";
const OTHER_GRAY_DARK = "#7D8AA0";

// Sequential single-hue ramp (light -> dark) for magnitude encodings — the
// ranked "Top States" bar and the trend area, where color carries no
// identity (axis labels already do), so one brand hue reads as a system
// rather than a rainbow.
const SEQUENTIAL_LIGHT = ["#CFF3EA", "#8FE0CC", "#4CC7A8", "#0DA893", "#0A7E6E"];
const SEQUENTIAL_DARK = ["#0A5C4E", "#0D8371", "#0D9E82", "#3FC2A5", "#8FE0CC"];

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
    text: resolveHsl("--foreground", dark ? "#f7f8fa" : "#1e2a3a"),
    mutedText: resolveHsl("--muted-foreground", dark ? "#9aa5b5" : "#6b7684"),
    grid: resolveHsl("--border", dark ? "#2a3648" : "#e2e6eb"),
    surface: resolveHsl("--card", dark ? "#141c29" : "#ffffff"),
    tooltipBg: resolveHsl("--popover", dark ? "#141c29" : "#ffffff"),
    tooltipBorder: resolveHsl("--border", dark ? "#2a3648" : "#e2e6eb"),
  };
}
