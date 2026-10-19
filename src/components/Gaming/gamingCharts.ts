import type { EChartsOption } from "echarts";

// Chart options for the Gaming dashboards, styled after RMPL's DemandCom executive
// summary: quiet chrome, rich tooltips, ranked bars with direct value labels, a funnel,
// density heat-maps, an effort-vs-outcome quadrant and linked dual-grid charts.

export const VIZ = {
  surface: "#fcfcfb", ink: "#0b0b0b", inkSecondary: "#52514e", inkMuted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7",
  blue: "#2a78d6", aqua: "#1baf7a", yellow: "#eda100", violet: "#4a3aa7", gray: "#aaa9a1",
  good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b",
} as const;

/** One identity per measure, used on every chart so colour always means the same thing. */
export const SERIES = { dialled: VIZ.blue, newDials: VIZ.violet, connected: VIZ.aqua, clean: VIZ.yellow, registrations: VIZ.violet, activations: VIZ.aqua, idle: VIZ.gray };
export const CATEGORY_COLORS: Record<string, string> = { positive: VIZ.good, follow_up: VIZ.warning, negative: VIZ.critical, neutral: VIZ.gray };
export const CATEGORY_LABEL: Record<string, string> = { positive: "Positive", follow_up: "Follow-up", negative: "Negative", neutral: "Neutral" };
export const ATT_COLORS = { present: "#1baf7a", late: "#eda100", half: "#ec835a", absent: "#d03b3b", none: "#e9e8e2" };

const TEXT = { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: VIZ.inkSecondary };
const AXIS = {
  axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { color: VIZ.inkMuted, fontSize: 11 },
  splitLine: { lineStyle: { color: VIZ.grid, width: 1 } },
};
const TOOLTIP = {
  backgroundColor: "#ffffff", borderWidth: 0, padding: [8, 12], textStyle: { color: VIZ.ink, fontSize: 12 },
  extraCssText: "box-shadow: 0 4px 20px rgba(0,0,0,.12); border-radius: 10px;",
};
const num = (n: number) => n.toLocaleString("en-IN");
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0);
const dot = (c: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px"></span>`;
const legendOf = (names: string[]) => ({ top: 0, right: 8, itemGap: 16, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: VIZ.inkSecondary, fontSize: 12 }, data: names });

export interface TrendPoint { label: string; calls: number; newDials: number; connected: number; clean: number; registrations: number; activations: number }

/** Hero: linked dual grid. Top = four measures indexed to their own average (100). Bottom = daily rates. */
export function heroOption(trend: TrendPoint[]): EChartsOption {
  const labels = trend.map((t) => t.label);
  const avg = (k: "calls" | "newDials" | "connected" | "clean") => (trend.length ? trend.reduce((s, t) => s + t[k], 0) / trend.length : 0);
  const base = { calls: avg("calls"), newDials: avg("newDials"), connected: avg("connected"), clean: avg("clean") };
  const idx = (k: keyof typeof base) => trend.map((t) => (base[k] > 0 ? Math.round((100 * t[k]) / base[k]) : 0));
  const line = (name: string, color: string, data: number[], x: number, extra: object = {}) => ({
    name, type: "line" as const, xAxisIndex: x, yAxisIndex: x, data, color, smooth: true, symbol: "circle", symbolSize: 6,
    lineStyle: { width: 2.5 }, itemStyle: { borderColor: VIZ.surface, borderWidth: 2 }, ...extra,
  });
  return {
    animation: false, textStyle: TEXT,
    legend: legendOf(["Dialled", "New dials", "Connected", "Clean", "Connected %", "Clean %", "New-dial share %"]),
    tooltip: {
      ...TOOLTIP, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: VIZ.axis } },
      formatter: (ps: unknown) => {
        const i = (ps as { dataIndex: number }[])[0].dataIndex; const t = trend[i];
        const row = (c: string, n: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:18px">${dot(c)}<span style="flex:1">${n}</span><b>${v}</b></div>`;
        return `<div style="font-weight:600;margin-bottom:6px">${t.label}</div>`
          + row(SERIES.dialled, "Dialled", num(t.calls)) + row(SERIES.newDials, "New dials", num(t.newDials))
          + row(SERIES.connected, "Connected", `${num(t.connected)} · ${pctOf(t.connected, t.calls)}%`) + row(SERIES.clean, "Clean (1 min+)", `${num(t.clean)} · ${pctOf(t.clean, t.calls)}%`)
          + `<div style="border-top:1px solid #e2e8f0;margin-top:6px;padding-top:6px;color:${VIZ.inkMuted}">Registrations ${num(t.registrations)} · Activations ${num(t.activations)}</div>`;
      },
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [{ left: 8, right: 16, top: 34, height: "46%", containLabel: true }, { left: 8, right: 16, bottom: 6, height: "26%", containLabel: true }],
    xAxis: [
      { type: "category", gridIndex: 0, data: labels, ...AXIS, splitLine: { show: false }, axisLabel: { show: false } },
      { type: "category", gridIndex: 1, data: labels, ...AXIS, splitLine: { show: false } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, name: "Index (average = 100)", nameTextStyle: { fontSize: 10, color: VIZ.inkMuted, align: "left" }, scale: true, ...AXIS },
      { type: "value", gridIndex: 1, name: "% of dialled", nameTextStyle: { fontSize: 10, color: VIZ.inkMuted, align: "left" }, scale: true, ...AXIS },
    ],
    series: [
      line("Dialled", SERIES.dialled, idx("calls"), 0, { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: VIZ.axis, type: "dashed" }, data: [{ yAxis: 100 }] } }),
      line("New dials", SERIES.newDials, idx("newDials"), 0),
      line("Connected", SERIES.connected, idx("connected"), 0),
      line("Clean", SERIES.clean, idx("clean"), 0),
      line("Connected %", SERIES.connected, trend.map((t) => pctOf(t.connected, t.calls)), 1, { lineStyle: { width: 2, type: "dashed" } }),
      line("Clean %", SERIES.clean, trend.map((t) => pctOf(t.clean, t.calls)), 1, { lineStyle: { width: 2, type: "dashed" } }),
      line("New-dial share %", SERIES.newDials, trend.map((t) => pctOf(t.newDials, t.calls)), 1, { lineStyle: { width: 2, type: "dashed" } }),
    ],
  } as EChartsOption;
}

export function funnelOption(steps: { name: string; value: number; note: string }[]): EChartsOption {
  const ramp = ["#9ec5f4", "#6da7ec", "#3987e5", "#184f95"];
  return {
    animation: false, textStyle: TEXT, color: ramp,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const s = steps.find((x) => x.name === (p as { name: string }).name)!; return `<b>${num(s.value)}</b><br/><span style="color:${VIZ.inkMuted}">${s.name}${s.note ? " · " + s.note : ""}</span>`; } },
    series: [{
      type: "funnel", left: "34%", right: "4%", top: 8, bottom: 8, sort: "none", minSize: "10%", gap: 4,
      label: { show: true, position: "left", formatter: (p: unknown) => { const s = steps.find((x) => x.name === (p as { name: string }).name)!; return `{a|${s.name}}\n{b|${num(s.value)}${s.note ? "  " + s.note : ""}}`; }, rich: { a: { color: VIZ.ink, fontSize: 12, fontWeight: 600, lineHeight: 18 }, b: { color: VIZ.inkMuted, fontSize: 11 } } },
      labelLine: { show: true, length: 14, lineStyle: { color: VIZ.axis } },
      itemStyle: { borderColor: VIZ.surface, borderWidth: 2 },
      data: steps.map((s) => ({ name: s.name, value: s.value })),
    }],
  } as EChartsOption;
}

/** Ranked horizontal bars with direct value labels, optional per-bar colours. */
export function rankedBarsOption(rows: { name: string; value: number; color: string }[], unit = "", maxLabel = 130): EChartsOption {
  const display = rows.slice().reverse();
  return {
    animation: false, textStyle: TEXT,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const r = display[(p as { dataIndex: number }).dataIndex]; return `<b>${num(r.value)}${unit}</b><br/><span style="color:${VIZ.inkMuted}">${r.name}</span>`; } },
    xAxis: { type: "value", ...AXIS, minInterval: 1 },
    yAxis: { type: "category", data: display.map((r) => r.name), ...AXIS, splitLine: { show: false }, axisLabel: { color: VIZ.inkSecondary, fontSize: 11, width: maxLabel, overflow: "truncate" } },
    series: [{
      type: "bar", barMaxWidth: 18, data: display.map((r) => ({ value: r.value, itemStyle: { color: r.color, borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", fontSize: 10.5, color: VIZ.inkMuted, formatter: (p: unknown) => num((p as { value: number }).value) + unit },
    }],
  } as EChartsOption;
}

export interface CallerRow { name: string; calls: number; newDials: number; connected: number; clean: number; registrations: number; activations: number; workHrs: number; idleHrs: number }

/** Density heat-map: callers x measures, each column coloured relative to its best caller. */
export function callerHeatmapOption(rows: CallerRow[]): EChartsOption {
  const metrics: { label: string; get: (r: CallerRow) => number; rate?: boolean }[] = [
    { label: "Calls", get: (r) => r.calls }, { label: "New dials", get: (r) => r.newDials },
    { label: "Connected %", get: (r) => pctOf(r.connected, r.calls), rate: true }, { label: "Clean %", get: (r) => pctOf(r.clean, r.calls), rate: true },
    { label: "Registrations", get: (r) => r.registrations }, { label: "Reg. % of clean", get: (r) => pctOf(r.registrations, r.clean), rate: true },
    { label: "Activations", get: (r) => r.activations }, { label: "Act. % of reg.", get: (r) => pctOf(r.activations, r.registrations), rate: true },
  ];
  const display = rows.slice().reverse();
  const colMax = metrics.map((m) => Math.max(1, ...rows.map((r) => m.get(r))));
  const data = display.flatMap((r, y) => metrics.map((m, x) => ({ value: [x, y, colMax[x] > 0 ? m.get(r) / colMax[x] : 0], raw: m.get(r), rate: !!m.rate })));
  return {
    animation: false, textStyle: TEXT,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const d = p as { value: number[]; data: { raw: number; rate: boolean } }; const m = metrics[d.value[0]]; return `<div style="font-weight:600;margin-bottom:4px">${display[d.value[1]].name}</div>${m.label}: <b>${num(d.data.raw)}${d.data.rate ? "%" : ""}</b><div style="color:${VIZ.inkMuted};margin-top:2px">${Math.round(d.value[2] * 100)}% of the best in this column</div>`; } },
    grid: { left: 4, right: 12, top: 34, bottom: 4, containLabel: true },
    xAxis: { type: "category", position: "top", data: metrics.map((m) => m.label), axisLabel: { fontSize: 10, color: VIZ.inkMuted, fontWeight: 600 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: display.map((r) => r.name), axisLabel: { fontSize: 11, color: VIZ.ink }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { show: false, min: 0, max: 1, dimension: 2, inRange: { color: ["#e6f0fc", "#9ec5f4", "#3987e5", "#184f95"] } },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 }, label: { show: true, fontSize: 10, formatter: (p: unknown) => { const d = (p as { data: { raw: number; rate: boolean } }).data; return `${num(d.raw)}${d.rate ? "%" : ""}`; } } }],
  } as EChartsOption;
}

/** Effort vs outcome: calls dialled vs registrations per caller, median guides. */
export function quadrantOption(rows: CallerRow[]): EChartsOption {
  const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
  const mx = median(rows.map((r) => r.calls)); const my = median(rows.map((r) => r.registrations));
  return {
    animation: false, textStyle: TEXT,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const d = p as { name: string; value: number[] }; return `<div style="font-weight:600;margin-bottom:4px">${d.name}</div>Calls dialled: <b>${num(d.value[0])}</b><br/>Registrations: <b>${num(d.value[1])}</b><div style="color:${VIZ.inkMuted};margin-top:4px">${pctOf(d.value[1], d.value[0])}% of dials become registrations</div>`; } },
    grid: { left: 8, right: 28, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: "value", name: "Calls dialled", nameLocation: "middle", nameGap: 26, nameTextStyle: { fontSize: 10, color: VIZ.inkMuted }, scale: true, ...AXIS },
    yAxis: { type: "value", name: "Registrations", nameTextStyle: { fontSize: 10, color: VIZ.inkMuted }, scale: true, ...AXIS },
    series: [{
      type: "scatter", symbolSize: 16, itemStyle: { color: VIZ.violet, borderColor: "#fff", borderWidth: 2 },
      label: { show: true, position: "top", fontSize: 10.5, color: VIZ.ink, formatter: (p: unknown) => (p as { name: string }).name }, labelLayout: { hideOverlap: true },
      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: VIZ.axis, type: "dashed" }, data: [{ xAxis: mx }, { yAxis: my }] },
      data: rows.map((r) => ({ name: r.name, value: [r.calls, r.registrations] })),
    }],
  } as EChartsOption;
}

export function workIdleOption(rows: CallerRow[]): EChartsOption {
  const display = rows.slice().reverse();
  const bar = (name: string, key: "workHrs" | "idleHrs", color: string, last: boolean) => ({
    name, type: "bar" as const, stack: "h", barMaxWidth: 20, color, data: display.map((r) => r[key]),
    itemStyle: last ? { borderRadius: [0, 4, 4, 0] } : {}, label: { show: true, fontSize: 10.5, color: "#fff", formatter: (p: unknown) => `${(p as { value: number }).value}h` },
  });
  return {
    animation: false, textStyle: TEXT, legend: legendOf(["Work hrs", "Idle hrs"]),
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: "value", ...AXIS }, yAxis: { type: "category", data: display.map((r) => r.name), ...AXIS, splitLine: { show: false }, axisLabel: { color: VIZ.inkSecondary, fontSize: 11 } },
    series: [bar("Work hrs", "workHrs", VIZ.aqua, false), bar("Idle hrs", "idleHrs", VIZ.gray, true)],
  } as EChartsOption;
}

/** Callers x hour-of-day heat-map of calls dialled; blank stretches show idle time. */
export function hourlyHeatmapOption(callers: string[], hours: number[], counts: number[][]): EChartsOption {
  const display = callers.slice().reverse();
  const rows = counts.slice().reverse();
  const data = rows.flatMap((r, y) => r.map((v, x) => ({ value: [x, y, v] })));
  const max = Math.max(1, ...rows.flat());
  return {
    animation: false, textStyle: TEXT,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const d = p as { value: number[] }; return `<div style="font-weight:600;margin-bottom:4px">${display[d.value[1]]}, ${hours[d.value[0]]}:00</div><b>${d.value[2]}</b> calls dialled`; } },
    grid: { left: 4, right: 12, top: 30, bottom: 4, containLabel: true },
    xAxis: { type: "category", position: "top", data: hours.map((h) => `${h}:00`), axisLabel: { fontSize: 10, color: VIZ.inkMuted }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: display, axisLabel: { fontSize: 11, color: VIZ.ink }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { show: false, min: 0, max, inRange: { color: ["#f1f0ea", "#9ec5f4", "#3987e5", "#184f95"] } },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 }, label: { show: true, fontSize: 10, color: VIZ.ink, formatter: (p: unknown) => ((p as { value: number[] }).value[2] ? String((p as { value: number[] }).value[2]) : "") } }],
  } as EChartsOption;
}

export interface DispoNode { id: string; name: string; category: string; calls: number; subs: { name: string; calls: number }[] }

/** Disposition > sub-disposition treemap, coloured by disposition type. */
export function dispoTreemapOption(nodes: DispoNode[]): EChartsOption {
  const total = nodes.reduce((s, n) => s + n.calls, 0);
  return {
    animation: false, textStyle: TEXT,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const d = p as { name: string; value: number; treePathInfo: { name: string }[] }; return `<div style="font-weight:600">${d.treePathInfo.slice(1).map((x) => x.name).join(" › ")}</div><b>${num(d.value)}</b> calls · ${pctOf(d.value, total)}%`; } },
    series: [{
      type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, left: 0, right: 0, top: 0, bottom: 0,
      label: { show: true, formatter: "{b}\n{c}", fontSize: 11, color: "#fff" },
      upperLabel: { show: true, height: 22, color: "#fff", fontSize: 11, fontWeight: 600 },
      itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 },
      levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }, { itemStyle: { gapWidth: 1 }, colorSaturation: [0.55, 0.85] }],
      data: nodes.filter((n) => n.calls > 0).map((n) => ({ name: n.name, value: n.calls, itemStyle: { color: CATEGORY_COLORS[n.category] ?? VIZ.gray }, children: n.subs.filter((s) => s.calls > 0).map((s) => ({ name: s.name, value: s.calls })) })),
    }],
  } as EChartsOption;
}

/** Callers x dispositions heat-map (count per cell). */
export function callerDispoHeatmapOption(callers: string[], dispos: string[], counts: number[][]): EChartsOption {
  const display = callers.slice().reverse(); const rows = counts.slice().reverse();
  const colMax = dispos.map((_, x) => Math.max(1, ...rows.map((r) => r[x])));
  const data = rows.flatMap((r, y) => r.map((v, x) => ({ value: [x, y, v / colMax[x]], raw: v })));
  return {
    animation: false, textStyle: TEXT,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const d = p as { value: number[]; data: { raw: number } }; return `<div style="font-weight:600;margin-bottom:4px">${display[d.value[1]]}</div>${dispos[d.value[0]]}: <b>${num(d.data.raw)}</b> calls`; } },
    grid: { left: 4, right: 12, top: 58, bottom: 4, containLabel: true },
    xAxis: { type: "category", position: "top", data: dispos, axisLabel: { fontSize: 10, color: VIZ.inkMuted, fontWeight: 600, interval: 0, rotate: 30 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: display, axisLabel: { fontSize: 11, color: VIZ.ink }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { show: false, min: 0, max: 1, dimension: 2, inRange: { color: ["#f1f0ea", "#c9b8f0", "#8a6fd6", "#4a3aa7"] } },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 }, label: { show: true, fontSize: 10, formatter: (p: unknown) => num((p as { data: { raw: number } }).data.raw) } }],
  } as EChartsOption;
}

/** Stacked horizontal bars (per caller, by disposition type or attendance status). */
export function stackedBarsOption(names: string[], series: { name: string; color: string; data: number[] }[]): EChartsOption {
  const display = names.slice().reverse();
  return {
    animation: false, textStyle: TEXT, legend: legendOf(series.map((s) => s.name)),
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: "value", ...AXIS, minInterval: 1 }, yAxis: { type: "category", data: display, ...AXIS, splitLine: { show: false }, axisLabel: { color: VIZ.inkSecondary, fontSize: 11 } },
    series: series.map((s, i) => ({ name: s.name, type: "bar" as const, stack: "s", barMaxWidth: 20, color: s.color, data: s.data.slice().reverse(), itemStyle: i === series.length - 1 ? { borderRadius: [0, 4, 4, 0] } : {} })),
  } as EChartsOption;
}

/** Grouped vertical bars by category (e.g. conversion rates per caller). */
export function groupedBarsOption(names: string[], series: { name: string; color: string; data: number[] }[], unit = "", target?: number): EChartsOption {
  return {
    animation: false, textStyle: TEXT, legend: legendOf(series.map((s) => s.name)),
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => `${num(Number(v))}${unit}` },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: names, ...AXIS, splitLine: { show: false } }, yAxis: { type: "value", ...AXIS, minInterval: 1 },
    series: series.map((s, i) => ({
      name: s.name, type: "bar" as const, color: s.color, data: s.data, barMaxWidth: 18, itemStyle: { borderRadius: [3, 3, 0, 0] },
      label: { show: names.length <= 8, position: "top" as const, fontSize: 10, color: VIZ.inkMuted, formatter: (p: unknown) => `${num((p as { value: number }).value)}${unit}` },
      ...(i === 0 && target ? { markLine: { silent: true, symbol: "none", lineStyle: { color: VIZ.axis, type: "dashed" }, label: { formatter: "Target", color: VIZ.inkMuted, fontSize: 10 }, data: [{ yAxis: target }] } } : {}),
    })),
  } as EChartsOption;
}

/** Area/line trend of one or more series per date. */
export function linesOption(labels: string[], series: { name: string; color: string; data: number[] }[], unit = ""): EChartsOption {
  return {
    animation: false, textStyle: TEXT, legend: legendOf(series.map((s) => s.name)),
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: VIZ.axis } }, valueFormatter: (v: unknown) => `${num(Number(v))}${unit}` },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: labels, ...AXIS, splitLine: { show: false } }, yAxis: { type: "value", ...AXIS, minInterval: 1 },
    series: series.map((s) => ({ name: s.name, type: "line" as const, data: s.data, color: s.color, smooth: true, symbol: "circle", symbolSize: 6, lineStyle: { width: 2.5 }, itemStyle: { borderColor: VIZ.surface, borderWidth: 2 }, areaStyle: { color: s.color, opacity: 0.08 } })),
  } as EChartsOption;
}

/** Attendance calendar heat-map: callers x working days, categorical colours with P/L/H/A labels. */
export function attendanceHeatmapOption(names: string[], days: string[], codes: string[][]): EChartsOption {
  const order = ["P", "L", "H", "A", "-"]; const color = [ATT_COLORS.present, ATT_COLORS.late, ATT_COLORS.half, ATT_COLORS.absent, ATT_COLORS.none];
  const label: Record<string, string> = { P: "Present", L: "Late", H: "Half day", A: "Absent", "-": "No record" };
  const display = names.slice().reverse(); const rows = codes.slice().reverse();
  const data = rows.flatMap((r, y) => r.map((c, x) => ({ value: [x, y, order.indexOf(c)], code: c })));
  return {
    animation: false, textStyle: TEXT,
    tooltip: { ...TOOLTIP, formatter: (p: unknown) => { const d = p as { value: number[]; data: { code: string } }; return `<div style="font-weight:600;margin-bottom:4px">${display[d.value[1]]}, ${days[d.value[0]]}</div>${dot(color[d.value[2]])}${label[d.data.code]}`; } },
    grid: { left: 4, right: 12, top: 28, bottom: 4, containLabel: true },
    xAxis: { type: "category", position: "top", data: days, axisLabel: { fontSize: 10, color: VIZ.inkMuted }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: display, axisLabel: { fontSize: 11, color: VIZ.ink }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { show: false, type: "piecewise", dimension: 2, pieces: color.map((c, i) => ({ value: i, color: c })) },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 3 }, label: { show: true, fontSize: 10, fontWeight: 600, color: "#fff", formatter: (p: unknown) => { const c = (p as { data: { code: string } }).data.code; return c === "-" ? "" : c; } } }],
  } as EChartsOption;
}
