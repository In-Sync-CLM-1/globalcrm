import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { FerventChartTheme } from "./ferventChartTheme";

export const UNSPECIFIED = "Unspecified";

// Every builder folds anything past the fixed 7-hue categorical palette into
// a single gray "Other" slot rather than generating new hues (dataviz skill:
// "a 9th series is never a generated hue").
function foldOther<T extends { name: string; value: number }>(items: T[], limit = 7): { name: string; value: number }[] {
  const top = items.slice(0, limit);
  const restTotal = items.slice(limit).reduce((sum, i) => sum + i.value, 0);
  return restTotal > 0 ? [...top, { name: "Other", value: restTotal }] : top;
}

// "Unspecified" and "Other" are both "no real category here" buckets — they
// stay neutral gray regardless of rank so a field that's mostly blank (the
// common case in this dataset today) doesn't paint the whole chart in
// whatever hue happens to sit first in the categorical array.
function isNeutralSlice(name: string): boolean {
  return name === "Other" || name === UNSPECIFIED;
}

function sliceColor(name: string, index: number, theme: FerventChartTheme): string {
  return isNeutralSlice(name) ? theme.otherGray : theme.categorical[index];
}

const tooltipBase = (theme: FerventChartTheme) => ({
  backgroundColor: theme.tooltipBg,
  borderColor: theme.tooltipBorder,
  borderWidth: 1,
  textStyle: { color: theme.text, fontSize: 12 },
  extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;",
});

export function buildTrendOption(monthlyTrend: { label: string; count: number }[], theme: FerventChartTheme, color?: string): EChartsOption {
  const hue = color ?? theme.categorical[2];
  return {
    grid: { left: 34, right: 12, top: 16, bottom: 24 },
    tooltip: { trigger: "axis", ...tooltipBase(theme) },
    xAxis: {
      type: "category",
      data: monthlyTrend.map((m) => m.label),
      axisLine: { lineStyle: { color: theme.grid } },
      axisTick: { show: false },
      axisLabel: { color: theme.mutedText, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: theme.grid, type: "dashed" } },
      axisLabel: { color: theme.mutedText, fontSize: 11 },
    },
    series: [
      {
        type: "line",
        name: "Records added",
        data: monthlyTrend.map((m) => m.count),
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2.5, color: hue },
        itemStyle: { color: hue, borderWidth: 2, borderColor: theme.surface },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${hue}4D` },
            { offset: 1, color: `${hue}00` },
          ]),
        },
      },
    ],
  };
}

export function buildIndustryTreemapOption(byIndustry: { name: string; value: number }[], theme: FerventChartTheme): EChartsOption {
  const data = foldOther(byIndustry).map((d, i) => ({
    name: d.name,
    value: d.value,
    itemStyle: { color: sliceColor(d.name, i, theme) },
  }));

  return {
    tooltip: { ...tooltipBase(theme), formatter: (p: any) => `${p.name}: ${p.value} record(s)` },
    series: [
      {
        type: "treemap",
        data,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          color: "#fff",
          fontSize: 12,
          fontWeight: 500,
          overflow: "truncate",
          formatter: "{b}\n{c}",
        },
        upperLabel: { show: false },
        itemStyle: { borderColor: theme.surface, borderWidth: 2, gapWidth: 2 },
      },
    ],
  };
}

export function buildDesignationDonutOption(byDesignationLevel: { name: string; value: number }[], theme: FerventChartTheme): EChartsOption {
  const folded = foldOther(byDesignationLevel);
  const total = folded.reduce((sum, d) => sum + d.value, 0) || 1;
  const data = folded.map((d, i) => ({
    name: d.name,
    value: d.value,
    itemStyle: { color: sliceColor(d.name, i, theme) },
  }));

  return {
    tooltip: { trigger: "item", ...tooltipBase(theme), formatter: (p: any) => `${p.name}: ${p.value} (${p.percent}%)` },
    legend: {
      bottom: 0,
      left: "center",
      textStyle: { color: theme.mutedText, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
      type: "scroll",
    },
    series: [
      {
        type: "pie",
        radius: ["46%", "72%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 4 },
        label: {
          show: true,
          color: theme.text,
          fontSize: 11,
          formatter: (p: any) => (p.value / total >= 0.08 ? `${p.name}\n${p.percent}%` : ""),
        },
        labelLine: { show: true, length: 8, length2: 6 },
        data,
      },
    ],
  };
}

// Generic ranked horizontal bar — backs Top States, Top Designations, Top
// Cities, Employee Size and Top Companies, so every "leaderboard" chart in
// the dashboard shares one implementation instead of five near-duplicates.
export function buildRankedBarOption(
  items: { name: string; value: number }[],
  theme: FerventChartTheme,
  opts: { topN?: number; color?: string; labelWidth?: number } = {}
): EChartsOption {
  const { topN = 8, color = theme.sequential[3], labelWidth = 100 } = opts;
  const top = items.slice(0, topN).slice().reverse();
  return {
    grid: { left: labelWidth, right: 36, top: 8, bottom: 8 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipBase(theme) },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: theme.grid, type: "dashed" } },
      axisLabel: { color: theme.mutedText, fontSize: 11 },
    },
    yAxis: {
      type: "category",
      data: top.map((s) => s.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 12, width: labelWidth - 10, overflow: "truncate" },
    },
    series: [
      {
        type: "bar",
        name: "Records",
        data: top.map((s) => s.value),
        barWidth: 14,
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: theme.mutedText, fontSize: 11 },
      },
    ],
  };
}

export function buildStatusSegmentOption(byStatus: { name: string; value: number }[], theme: FerventChartTheme): EChartsOption {
  const folded = foldOther(byStatus);
  const total = folded.reduce((sum, d) => sum + d.value, 0) || 1;

  return {
    tooltip: {
      trigger: "item",
      ...tooltipBase(theme),
      formatter: (p: any) => `${p.seriesName}: ${p.value} (${((p.value / total) * 100).toFixed(0)}%)`,
    },
    legend: { bottom: 0, left: "center", textStyle: { color: theme.mutedText, fontSize: 11 }, itemWidth: 10, itemHeight: 10, type: "scroll" },
    grid: { left: 8, right: 8, top: 4, bottom: 32 },
    xAxis: { type: "value", show: false, max: total },
    yAxis: { type: "category", data: ["status"], show: false },
    series: folded.map((d, i, arr) => {
      const share = d.value / total;
      return {
        name: d.name,
        type: "bar",
        stack: "status",
        barWidth: 30,
        data: [d.value],
        itemStyle: {
          color: sliceColor(d.name, i, theme),
          borderRadius: i === 0 ? [4, 0, 0, 4] : i === arr.length - 1 ? [0, 4, 4, 0] : 0,
        },
        label: {
          show: share >= 0.08,
          formatter: `${(share * 100).toFixed(0)}%`,
          color: "#fff",
          position: "inside",
          fontSize: 11,
          fontWeight: 500,
        },
      };
    }) as EChartsOption["series"],
  };
}

// GitHub-style calendar heatmap of daily record additions — the one chart in
// the dashboard where color legitimately encodes magnitude on a day grid, so
// it gets its own warm ramp instead of reusing the blue "default" or any
// categorical hue (dataviz skill: a true heatmap needs a ramp built for it).
export function buildDailyActivityHeatmapOption(
  daily: { date: string; count: number }[],
  theme: FerventChartTheme,
  range: [string, string]
): EChartsOption {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return {
    tooltip: {
      ...tooltipBase(theme),
      formatter: (p: any) => `${p.data[0]}: ${p.data[1]} record(s)`,
    },
    // Only hex stops here — theme.grid/theme.surface resolve to `hsl(...)`
    // strings, and echarts can't lerp those for a gradient (it silently
    // produces black at the low end instead of erroring).
    visualMap: {
      min: 0,
      max,
      show: false,
      inRange: { color: theme.warm },
    },
    calendar: {
      range,
      cellSize: ["auto", 15],
      left: 40,
      right: 12,
      top: 20,
      bottom: 8,
      itemStyle: { borderWidth: 2, borderColor: theme.surface, color: theme.grid },
      splitLine: { show: false },
      yearLabel: { show: false },
      monthLabel: { color: theme.mutedText, fontSize: 10 },
      dayLabel: { color: theme.mutedText, fontSize: 10, firstDay: 1 },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: daily.map((d) => [d.date, d.count]),
      },
    ],
  };
}
