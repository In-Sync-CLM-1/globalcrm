import type { EChartsOption } from "echarts";

// The dashboards' single graph: Dialled, Connected and Clean calls per date, absolute counts only.
// Colour rule: one blue hue. The three measures are nested (every clean call was connected, every
// connected call was dialled), so they share the hue and differ in depth: darkest = dialled,
// lightest = clean. Lines are labelled directly at their right-hand end.

export const INK = "#1f2937";
export const MUTED = "#6b7280";
export const GRID = "#e5e7eb";
export const RAMP = ["#eef3fb", "#c4d8f2", "#7fa9e0", "#2f6fc4", "#17468a"];
export const SERIES = { dialled: "#17468a", connected: "#2f6fc4", clean: "#7fa9e0" } as const;

const TEXT = { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: MUTED };
const num = (n: number) => n.toLocaleString("en-IN");

export interface DayPoint { label: string; calls: number; connected: number; clean: number }

export function callsLineOption(points: DayPoint[]): EChartsOption {
  const line = (name: string, key: "calls" | "connected" | "clean", color: string) => ({
    name, type: "line" as const, data: points.map((p) => p[key]), color,
    symbol: "circle", symbolSize: 6, lineStyle: { width: 2.5 }, itemStyle: { borderColor: "#fff", borderWidth: 2 },
    endLabel: { show: true, formatter: `${name}`, color: INK, fontSize: 12, fontWeight: 600 },
    labelLayout: { moveOverlap: "shiftY" },
  });
  return {
    animation: false,
    textStyle: TEXT,
    tooltip: {
      trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#9ca3af" } },
      backgroundColor: "#fff", borderWidth: 0, padding: [8, 12], textStyle: { color: INK, fontSize: 12 },
      extraCssText: "box-shadow: 0 4px 20px rgba(0,0,0,.12); border-radius: 10px;",
      formatter: (ps: unknown) => {
        const i = (ps as { dataIndex: number }[])[0].dataIndex;
        const p = points[i];
        const row = (c: string, n: string, v: number) => `<div style="display:flex;justify-content:space-between;gap:20px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px"></span>${n}</span><b>${num(v)}</b></div>`;
        return `<div style="font-weight:600;margin-bottom:6px">${p.label}</div>${row(SERIES.dialled, "Dialled", p.calls)}${row(SERIES.connected, "Connected", p.connected)}${row(SERIES.clean, "Clean", p.clean)}`;
      },
    },
    grid: { left: 8, right: 84, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: points.map((p) => p.label), boundaryGap: false, axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { color: MUTED, fontSize: 11 } },
    yAxis: { type: "value", min: 0, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: MUTED, fontSize: 11 }, splitLine: { lineStyle: { color: GRID } } },
    series: [line("Dialled", "calls", SERIES.dialled), line("Connected", "connected", SERIES.connected), line("Clean", "clean", SERIES.clean)],
  } as EChartsOption;
}

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
        return `<div style="font-weight:600;margin-bottom:4px">${row.label}, ${hours[d.value[0]]}:00 to ${hours[d.value[0]] + 1}:00</div><b>${num(d.value[2])}</b> ${measure.toLowerCase()}<div style="color:${MUTED};margin-top:2px">${num(row.total)} on that day</div>`;
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
