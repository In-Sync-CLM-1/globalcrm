import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { FerventChartTheme } from "./ferventChartTheme";

// Every builder folds anything past the fixed 7-hue categorical palette into
// a single gray "Other" slot rather than generating new hues (dataviz skill:
// "a 9th series is never a generated hue").
function foldOther<T extends { name: string; value: number }>(items: T[], limit = 7): { name: string; value: number }[] {
  const top = items.slice(0, limit);
  const restTotal = items.slice(limit).reduce((sum, i) => sum + i.value, 0);
  return restTotal > 0 ? [...top, { name: "Other", value: restTotal }] : top;
}

const tooltipBase = (theme: FerventChartTheme) => ({
  backgroundColor: theme.tooltipBg,
  borderColor: theme.tooltipBorder,
  borderWidth: 1,
  textStyle: { color: theme.text, fontSize: 12 },
  extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;",
});

export function buildTrendOption(monthlyTrend: { label: string; count: number }[], theme: FerventChartTheme): EChartsOption {
  const hue = theme.categorical[0];
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
  const data = foldOther(byIndustry).map((d, i, arr) => ({
    name: d.name,
    value: d.value,
    itemStyle: { color: d.name === "Other" && i === arr.length - 1 ? theme.otherGray : theme.categorical[i] },
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
  const data = folded.map((d, i, arr) => ({
    name: d.name,
    value: d.value,
    itemStyle: { color: d.name === "Other" && i === arr.length - 1 ? theme.otherGray : theme.categorical[i] },
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
      const isOther = d.name === "Other" && i === arr.length - 1;
      const share = d.value / total;
      return {
        name: d.name,
        type: "bar",
        stack: "status",
        barWidth: 30,
        data: [d.value],
        itemStyle: {
          color: isOther ? theme.otherGray : theme.categorical[i],
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
