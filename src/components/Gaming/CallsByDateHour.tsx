import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Card } from "@/components/ui/card";
import { EChart } from "@/components/charts/EChart";
import { dateHourHeatmapOption } from "./gamingCharts";
import type { HourlyRow } from "./gamingStats";

const MEASURES = [
  { key: "calls", label: "Dialled" },
  { key: "new_dials", label: "New dials" },
  { key: "connected_calls", label: "Connected" },
  { key: "clean_calls", label: "Clean" },
] as const;
type MeasureKey = (typeof MEASURES)[number]["key"];

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * The dashboards' one graph: calls compared across dates (rows) and across the hours of the day (columns).
 * The title states the finding; the toggle switches the measure without adding another chart.
 */
export function CallsByDateHour({ rows, note, defaultMeasure = "calls", measures }: { rows: HourlyRow[]; note?: string; defaultMeasure?: MeasureKey; measures?: MeasureKey[] }) {
  const [measure, setMeasure] = useState<MeasureKey>(defaultMeasure);
  const label = MEASURES.find((m) => m.key === measure)!.label;

  const { option, title, height } = useMemo(() => {
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const hours = [...new Set(rows.map((r) => r.hour))].sort((a, b) => a - b);
    const byKey = new Map(rows.map((r) => [`${r.day}|${r.hour}`, r[measure]]));
    const matrix = days.map((d) => hours.map((h) => byKey.get(`${d}|${h}`) ?? 0));
    const dayTotals = matrix.map((m) => m.reduce((s, v) => s + v, 0));
    const hourTotals = hours.map((_, x) => matrix.reduce((s, m) => s + m[x], 0));

    let headline = "No calls in the selected dates.";
    if (days.length && hourTotals.some((v) => v > 0)) {
      const peak = hours[hourTotals.indexOf(Math.max(...hourTotals))];
      // quietest hour inside the working day, ignoring the first and last (partial) hours
      const inner = hours.map((h, i) => ({ h, v: hourTotals[i] })).filter((x) => x.h > hours[0] && x.h < hours[hours.length - 1]);
      const low = inner.length ? inner.reduce((a, b) => (b.v < a.v ? b : a)) : null;
      const bestDay = days[dayTotals.indexOf(Math.max(...dayTotals))];
      const worstDay = days[dayTotals.indexOf(Math.min(...dayTotals))];
      headline = `${label} calls peak at ${hourLabel(peak)}${low ? ` and dip at ${hourLabel(low.h)}` : ""}. Busiest day: ${format(parseISO(bestDay), "EEE d MMM")}; quietest: ${format(parseISO(worstDay), "EEE d MMM")}.`;
    }
    const rowsOut = days.map((d, i) => ({ label: format(parseISO(d), "EEE d MMM"), total: dayTotals[i], counts: matrix[i] }));
    return { option: dateHourHeatmapOption(rowsOut, hours, label), title: headline, height: Math.max(220, days.length * 34 + 60) };
  }, [rows, measure, label]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each row is a date, each column an hour of the day. Darker means more calls. The number after the date is that day's total.{note ? ` ${note}` : ""}
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs" role="group" aria-label="Measure">
          {MEASURES.filter((m) => !measures || measures.includes(m.key)).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMeasure(m.key)}
              className={`rounded px-3 py-1 font-medium transition-colors ${measure === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={measure === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2" style={{ height }}><EChart option={option} /></div>
    </Card>
  );
}
