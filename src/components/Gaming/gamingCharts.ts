import type { EChartsOption } from "echarts";

// One graph per dashboard: calls by date (rows) and hour of the day (columns).
// Colour rule: a single blue ramp carries magnitude (light = few calls, dark = many). Everything else
// on the page is neutral grey text. Green / amber / red are reserved for status chips (attendance and
// disposition type) and never used to colour a measure.

export const INK = "#1f2937";
export const MUTED = "#6b7280";
export const RAMP = ["#eef3fb", "#c4d8f2", "#7fa9e0", "#2f6fc4", "#17468a"];

const TEXT = { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: MUTED };
const num = (n: number) => n.toLocaleString("en-IN");

export interface DateHourRow { label: string; total: number; counts: number[] }

export function dateHourHeatmapOption(rows: DateHourRow[], hours: number[], measure: string): EChartsOption {
  const display = rows.slice().reverse(); // newest date at the top
  const max = Math.max(1, ...rows.flatMap((r) => r.counts));
  // white numbers on the dark half of the ramp, dark numbers on the light half
  const data = display.flatMap((r, y) => r.counts.map((v, x) => ({ value: [x, y, v], label: { color: v / max > 0.5 ? "#ffffff" : INK } })));
  return {
    animation: false,
    textStyle: TEXT,
    tooltip: {
      backgroundColor: "#fff", borderWidth: 0, padding: [8, 12], textStyle: { color: INK, fontSize: 12 },
      extraCssText: "box-shadow: 0 4px 20px rgba(0,0,0,.12); border-radius: 10px;",
      formatter: (p: unknown) => {
        const d = p as { value: number[] };
        const row = display[d.value[1]];
        const share = row.total > 0 ? Math.round((100 * d.value[2]) / row.total) : 0;
        return `<div style="font-weight:600;margin-bottom:4px">${row.label}, ${hours[d.value[0]]}:00 to ${hours[d.value[0]] + 1}:00</div><b>${num(d.value[2])}</b> ${measure.toLowerCase()}<div style="color:${MUTED};margin-top:2px">${share}% of that day's ${num(row.total)}</div>`;
      },
    },
    grid: { left: 4, right: 12, top: 30, bottom: 4, containLabel: true },
    xAxis: { type: "category", position: "top", data: hours.map((h) => `${h}:00`), axisLabel: { fontSize: 11, color: MUTED }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: display.map((r) => `${r.label}  ·  ${num(r.total)}`), axisLabel: { fontSize: 11, color: INK }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { show: false, min: 0, max, inRange: { color: RAMP } },
    series: [{
      type: "heatmap", data,
      itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 },
      label: { show: true, fontSize: 10, formatter: (p: unknown) => { const v = (p as { value: number[] }).value[2]; return v ? String(v) : ""; } },
    }],
  } as EChartsOption;
}
