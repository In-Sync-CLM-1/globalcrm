// Chart color plan for the Fervent Dashboard's editorial redesign — a warm
// paper ground with a single clay/terracotta accent, not the generic
// multi-color SaaS palette. Validated with the dataviz skill's
// validate_palette.js (categorical, light + dark surfaces — all seven
// checks pass; ochre carries a contrast WARN so it always ships with a
// visible direct label, never color alone).
//
// Fixed hue order — never cycled, never reassigned by a chart's own sort:
// clay, violet, teal, ochre, rose, moss, blue. Clay is both slot 1 AND the
// brand accent (--primary in ferventEditorial.css), so it's reserved for
// the single most important series in a chart, not spent on whichever
// category happens to sort first. An 8th+ category folds into "Other"
// rather than generating a new hue.
const CATEGORICAL_LIGHT = ["#C15F3C", "#7A4A94", "#0E8C74", "#C98A1E", "#BF5580", "#4A7A2E", "#2E6CA8"];
const CATEGORICAL_DARK = ["#D97354", "#9A6BB0", "#1F9A7E", "#B8791E", "#BF5580", "#6B9946", "#4A87C4"];
const OTHER_GRAY_LIGHT = "#A79E8C";
const OTHER_GRAY_DARK = "#8C8270";

// Sequential single-hue ramp (light -> dark) for magnitude encodings where
// color carries no identity (axis labels already do). Built from the clay
// accent itself — the world map's dominant country is drawn in the same
// hue as the dashboard's primary color, so the map reads as "this brand's
// view of the world" rather than a generic blue heatmap.
const SEQUENTIAL_LIGHT = ["#F3E0D5", "#E5B79E", "#D18B66", "#C15F3C", "#8A3F26"];
const SEQUENTIAL_DARK = ["#4A2818", "#7A3F26", "#B0623A", "#D97354", "#F0A585"];

// Warm ramp reserved for the daily-activity heatmap — a deeper, more
// saturated push into the same clay family so intensity still reads as
// "hot," while staying visually distinct from the sequential map ramp
// above it (the map ramp is intentionally soft; this one is bolder).
const WARM_LIGHT = ["#FBEADD", "#F0BE93", "#DE8F52", "#C15F3C", "#8F3115"];
const WARM_DARK = ["#5C2410", "#8F3115", "#C15F3C", "#E58E5C", "#F5C09A"];

function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
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
  fontDisplay: string;
  fontBody: string;
}

// Hardcoded to the editorial palette (ferventEditorial.css) rather than
// read from the shared app's CSS custom properties — this dashboard
// deliberately diverges from the rest of the app's teal/coral theme, so
// there's nothing to inherit; these are the same hex/HSL values the scoped
// .fervent-editorial CSS class defines for the surrounding DOM.
export function getFerventChartTheme(): FerventChartTheme {
  const dark = isDarkMode();
  return {
    categorical: dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT,
    otherGray: dark ? OTHER_GRAY_DARK : OTHER_GRAY_LIGHT,
    sequential: dark ? SEQUENTIAL_DARK : SEQUENTIAL_LIGHT,
    warm: dark ? WARM_DARK : WARM_LIGHT,
    text: dark ? "#F3EDE1" : "#26221C",
    mutedText: dark ? "#B4A990" : "#78705F",
    grid: dark ? "#3A332A" : "#E5DBC7",
    surface: dark ? "#241F19" : "#FBF8F1",
    tooltipBg: dark ? "#241F19" : "#FBF8F1",
    tooltipBorder: dark ? "#3A332A" : "#E5DBC7",
    fontDisplay: "'Source Serif 4', Georgia, serif",
    fontBody: "'IBM Plex Sans', -apple-system, sans-serif",
  };
}
