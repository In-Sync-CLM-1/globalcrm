import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Card } from "@/components/ui/card";
import { EChart } from "@/components/charts/EChart";
import { callsLineOption, type LineVariant } from "./gamingCharts";

export interface DayCounts { day: string; calls: number; connected_calls: number; clean_calls: number }

/**
 * The dashboards' one graph: Dialled, Connected and Clean calls on a date line (absolute counts).
 * The title states the finding; the rows are summed per date, whoever made the calls.
 */
export function CallsOverTime({ rows, note }: { rows: DayCounts[]; note?: string }) {
  const [variant, setVariant] = useState<LineVariant>("line");
  const { points, title } = useMemo(() => {
    const by = new Map<string, DayCounts>();
    for (const r of rows) {
      const e = by.get(r.day) ?? { day: r.day, calls: 0, connected_calls: 0, clean_calls: 0 };
      e.calls += r.calls; e.connected_calls += r.connected_calls; e.clean_calls += r.clean_calls;
      by.set(r.day, e);
    }
    const days = [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
    let headline = "No calls in the selected dates.";
    if (days.length) {
      const hi = days.reduce((a, b) => (b.calls > a.calls ? b : a));
      const lo = days.reduce((a, b) => (b.calls < a.calls ? b : a));
      headline = days.length === 1
        ? `${hi.calls.toLocaleString("en-IN")} calls dialled on ${format(parseISO(hi.day), "EEE d MMM")}.`
        : `Dialled calls ranged from ${lo.calls.toLocaleString("en-IN")} (${format(parseISO(lo.day), "EEE d MMM")}) to ${hi.calls.toLocaleString("en-IN")} (${format(parseISO(hi.day), "EEE d MMM")}) a day.`;
    }
    return {
      title: headline,
      points: days.map((d) => ({ label: format(parseISO(d.day), "d MMM"), calls: d.calls, connected: d.connected_calls, clean: d.clean_calls })),
    };
  }, [rows]);
  const option = useMemo(() => callsLineOption(points, variant), [points, variant]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Dialled = every call placed. Connected = answered. Clean = lasted a minute or more.{note ? ` ${note}` : ""}</p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs" role="group" aria-label="Chart style">
          {(["line", "area"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVariant(v)} aria-pressed={variant === v}
              className={`rounded px-3 py-1 font-medium capitalize transition-colors ${variant === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {v === "line" ? "Lines" : "Area"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 h-80"><EChart option={option} /></div>
    </Card>
  );
}
