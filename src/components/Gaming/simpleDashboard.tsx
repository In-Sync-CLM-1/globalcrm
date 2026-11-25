import { useMemo, type ReactNode } from "react";
import { addDays, differenceInCalendarDays, format, parseISO, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EChart } from "@/components/charts/EChart";
import { useUrlState } from "@/hooks/useUrlState";
import { volumeOption } from "./gamingCharts";
import { pct, type DayOutcomes, type HourlyRow } from "./gamingStats";

export type Period = "today" | "week" | "month";
const day = (d: Date) => format(d, "yyyy-MM-dd");
const VERSUS: Record<Period, string> = { today: "yesterday", week: "last week", month: "last month" };

/** Today in India, whatever the computer's own time zone. */
const indiaToday = () => parseISO(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));

/** The chosen period, and the same stretch of the period before it. */
export function usePeriod() {
  const [period, setPeriod] = useUrlState<Period>("period", "today");
  return useMemo(() => {
    const p: Period = period === "week" || period === "month" ? period : "today";
    const now = indiaToday();
    const from = p === "today" ? now : p === "week" ? startOfWeek(now, { weekStartsOn: 1 }) : startOfMonth(now);
    const span = differenceInCalendarDays(now, from);
    const prevFrom = p === "today" ? addDays(now, -1) : p === "week" ? addDays(from, -7) : startOfMonth(subMonths(now, 1));
    const prevTo = p === "month" ? new Date(Math.min(addDays(prevFrom, span).getTime(), addDays(from, -1).getTime())) : addDays(prevFrom, span);
    return { period: p, setPeriod, from: day(from), to: day(now), prevFrom: day(prevFrom), prevTo: day(prevTo), versus: VERSUS[p] };
  }, [period, setPeriod]);
}

export function PeriodSwitch({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1 text-sm" role="group" aria-label="Period">
      {(["today", "week", "month"] as const).map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)} aria-pressed={value === p}
          className={`rounded-md px-4 py-1.5 font-medium capitalize transition-colors ${value === p ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {p}
        </button>
      ))}
    </div>
  );
}

/** One figure, with its change against the previous period. */
export function StatCard({ label, value, prev, versus, icon: Icon, hint }: {
  label: string; value: number | string; prev?: number; versus?: string; icon: LucideIcon; hint?: ReactNode;
}) {
  const now = typeof value === "number" ? value : null;
  const diff = now !== null && prev !== undefined ? now - prev : null;
  return (
    <Card className="rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</p>
      {diff !== null && versus && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {diff > 0 ? <ArrowUp className="h-3 w-3 text-emerald-600" /> : diff < 0 ? <ArrowDown className="h-3 w-3 text-rose-600" /> : null}
          {diff === 0 ? `Same as ${versus}` : `${Math.abs(diff).toLocaleString("en-IN")} ${diff > 0 ? "more" : "fewer"} than ${versus}`}
        </p>
      )}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** Call volume: by hour for today, by day for a week or month. */
export function VolumeCard({ period, from, to, hourly, days }: { period: Period; from: string; to: string; hourly: HourlyRow[]; days: DayOutcomes[] }) {
  const points = useMemo(() => {
    if (period === "today") {
      const by = new Map<number, number>();
      for (const r of hourly) by.set(r.hour, (by.get(r.hour) ?? 0) + r.calls);
      const used = [...by.entries()].filter(([, n]) => n > 0).map(([h]) => h);
      const lo = Math.min(9, ...used), hi = Math.max(19, ...used);
      return Array.from({ length: hi - lo + 1 }, (_, i) => ({ label: `${String(lo + i).padStart(2, "0")}:00`, calls: by.get(lo + i) ?? 0 }));
    }
    const by = new Map<string, number>();
    for (const r of days) by.set(r.day, (by.get(r.day) ?? 0) + r.total);
    const n = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;
    return Array.from({ length: n }, (_, i) => {
      const d = addDays(parseISO(from), i);
      return { label: format(d, "d MMM"), calls: by.get(day(d)) ?? 0 };
    });
  }, [period, from, to, hourly, days]);
  const option = useMemo(() => volumeOption(points), [points]);
  return (
    <Card className="rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Call volume</h2>
      <p className="text-xs text-muted-foreground">Outcomes saved, {period === "today" ? "by hour today" : `by day this ${period}`}</p>
      <div className="mt-2 h-64"><EChart option={option} /></div>
    </Card>
  );
}

export const connectRate = (connected: number, total: number) => `${pct(connected, total)}%`;
