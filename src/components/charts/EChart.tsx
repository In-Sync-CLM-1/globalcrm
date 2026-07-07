import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

interface EChartProps {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
  eventHandlers?: Record<string, (params: any) => void>;
}

// Thin React wrapper around echarts's imperative API: owns one chart instance
// per mount, re-applies `option` on every change, and keeps the chart sized
// to its container via ResizeObserver so it fills whatever grid/flex cell
// it's given (the basis for the dashboard's no-scroll layout).
export function EChart({ option, className, style, eventHandlers }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  // Re-bind on every render so handlers always close over current props
  // (drilldown callbacks depend on filteredRows/groupBy state that changes often).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !eventHandlers) return;
    Object.entries(eventHandlers).forEach(([event, handler]) => chart.on(event, handler));
    return () => {
      Object.keys(eventHandlers).forEach((event) => chart.off(event));
    };
  });

  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%", ...style }} />;
}
