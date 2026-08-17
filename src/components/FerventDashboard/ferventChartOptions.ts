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

export interface CityMapPoint {
  name: string;
  coords: [number, number];
  count: number;
}

export interface CountryDatum {
  name: string;
  value: number;
}

// World choropleth — every country is colored by record count on the same
// sequential ramp as the ranked bars elsewhere (magnitude, no identity), so
// this genuinely reads as a heatmap rather than a set of categorical blobs.
// Countries with zero records stay a flat neutral gray rather than the ramp's
// lightest step, so "no data" and "a little data" stay visually distinct.
// Small nations not present in the underlying map polygons (Singapore, Hong
// Kong) are layered on top as scatter points instead — see SMALL_NATION_COORDS.
//
// India outweighs every other country in this dataset by ~35x (domestic
// vendor list vs. a handful of international contacts), so a linear color
// scale crushes every other country to the same near-white pixel — exactly
// the "distinction" this map exists to show would disappear. Coloring is
// done on sqrt(count) instead; tooltips still show the real count via
// `rawValue`, only the fill intensity is compressed.
export function buildWorldHeatmapOption(
  countries: CountryDatum[],
  smallNations: CountryDatum[],
  theme: FerventChartTheme,
  smallNationCoords: Record<string, [number, number]>
): EChartsOption {
  const rawMax = Math.max(1, ...countries.map((c) => c.value), ...smallNations.map((c) => c.value));
  const scale = (v: number) => Math.sqrt(v);
  return {
    tooltip: {
      ...tooltipBase(theme),
      formatter: (p: any) => {
        const raw = typeof p.data?.rawValue === "number" ? p.data.rawValue : Array.isArray(p.value) ? p.value[2] : p.value;
        return `${p.name}<br/><b>${raw || 0}</b> record(s)`;
      },
    },
    visualMap: {
      min: 0,
      max: scale(rawMax),
      show: false,
      inRange: { color: theme.sequential },
    },
    geo: {
      map: "World",
      roam: true,
      scaleLimit: { min: 1, max: 6 },
      layoutCenter: ["50%", "52%"],
      layoutSize: "100%",
      itemStyle: { areaColor: theme.grid, borderColor: theme.surface, borderWidth: 0.6 },
      emphasis: { itemStyle: { areaColor: theme.sequential[2] }, label: { show: false } },
      // India's polygon is 36 concatenated state shapes (see worldMap.json's
      // build note) rather than one dissolved outline — at this render scale
      // the internal state-border strokes stack into a dark, jagged smear.
      // Zeroing India's own border width keeps the (correct) fill shape
      // clean without touching every other country's outline.
      regions: [{ name: "India", itemStyle: { borderWidth: 0 } }],
    },
    series: [
      {
        type: "map",
        map: "World",
        geoIndex: 0,
        data: countries.map((c) => ({ name: c.name, value: scale(c.value), rawValue: c.value })),
      },
      {
        type: "effectScatter",
        coordinateSystem: "geo",
        data: smallNations
          .filter((n) => smallNationCoords[n.name])
          .map((n) => ({ name: n.name, value: [...smallNationCoords[n.name], n.value] })),
        showEffectOn: "render",
        rippleEffect: { scale: 2, brushType: "stroke" },
        zlevel: 1,
        symbolSize: (val: number[]) => 8 + 20 * Math.sqrt((val[2] || 0) / rawMax),
        itemStyle: { color: theme.categorical[2], shadowBlur: 6, shadowColor: `${theme.categorical[2]}66` },
        label: { show: true, formatter: (p: any) => p.name, position: "top", color: theme.text, fontSize: 10, distance: 6 },
      },
    ],
  };
}

// Domestic vs international vs unclassified split — a fixed, semantic three-
// way donut (never categorical-cycled) so the color always means the same
// thing: teal is India, blue is international, gray is "country field
// couldn't be classified" (never silently folded into either real bucket).
export function buildGeoSplitDonutOption(
  domestic: number,
  international: number,
  unclassified: number,
  theme: FerventChartTheme
): EChartsOption {
  const total = domestic + international + unclassified || 1;
  const data = [
    { name: "Domestic (India)", value: domestic, itemStyle: { color: theme.categorical[0] } },
    { name: "International", value: international, itemStyle: { color: theme.categorical[2] } },
    { name: "Unclassified", value: unclassified, itemStyle: { color: theme.otherGray } },
  ].filter((d) => d.value > 0);

  return {
    tooltip: { trigger: "item", ...tooltipBase(theme), formatter: (p: any) => `${p.name}: ${p.value} (${p.percent}%)` },
    legend: { bottom: 0, left: "center", textStyle: { color: theme.mutedText, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    series: [
      {
        type: "pie",
        radius: ["58%", "82%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 4 },
        label: { show: false },
        data,
      },
      {
        type: "pie",
        radius: ["0%", "0%"],
        center: ["50%", "42%"],
        silent: true,
        label: {
          show: true,
          position: "center",
          formatter: () => `${Math.round((domestic / total) * 100)}%\n{sub|Domestic}`,
          fontSize: 22,
          fontWeight: 700,
          color: theme.text,
          rich: { sub: { fontSize: 11, fontWeight: 400, color: theme.mutedText } },
        },
        data: [{ value: 1 }],
      },
    ],
  };
}

// India geo bubble map of where records are physically located. Bubble size
// is the only encoding that matters here (place identity comes from the
// label/tooltip), so — like the sequential ramp elsewhere — it's blue, not
// another green, and distinct from the heatmap's warm ramp above it.
export function buildCityGeoMapOption(points: CityMapPoint[], theme: FerventChartTheme): EChartsOption {
  const max = Math.max(1, ...points.map((p) => p.count));
  const blue = theme.categorical[2];
  return {
    tooltip: {
      ...tooltipBase(theme),
      formatter: (p: any) => `${p.name}<br/><b>${p.value?.[2] ?? 0}</b> record(s)`,
    },
    geo: {
      map: "India",
      roam: false,
      layoutCenter: ["50%", "52%"],
      layoutSize: "108%",
      itemStyle: { areaColor: theme.grid, borderColor: theme.surface },
      emphasis: { itemStyle: { areaColor: theme.sequential[0] }, label: { show: false } },
    },
    series: [
      {
        type: "effectScatter",
        coordinateSystem: "geo",
        data: points.map((p) => ({ name: p.name, value: [...p.coords, p.count] })),
        showEffectOn: "render",
        rippleEffect: { scale: 2.2, brushType: "stroke" },
        zlevel: 1,
        symbolSize: (val: number[]) => 10 + 34 * Math.sqrt((val[2] || 0) / max),
        itemStyle: { color: blue, shadowBlur: 6, shadowColor: `${blue}66` },
        label: {
          show: true,
          formatter: (p: any) => p.name,
          position: "top",
          color: theme.text,
          fontSize: 10,
          distance: 6,
        },
      },
    ],
  };
}
