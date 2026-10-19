import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, eachDayOfInterval, format, getDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "@/components/common/LoadingState";
import { EChart } from "@/components/charts/EChart";
import { UrlTabs } from "@/components/UrlTabs";
import { useUrlState } from "@/hooks/useUrlState";
import {
  ATT_COLORS, CATEGORY_COLORS, CATEGORY_LABEL, SERIES, VIZ, attendanceHeatmapOption, callerDispoHeatmapOption, callerHeatmapOption, dispoTreemapOption,
  funnelOption, groupedBarsOption, heroOption, hourlyHeatmapOption, linesOption, quadrantOption, rankedBarsOption, stackedBarsOption, workIdleOption,
  type CallerRow, type TrendPoint,
} from "./gamingCharts";
import { fmtClock, fmtHM, pct, sumStats, useCallers, useDayStats, useDispoCounts, useDispositionCatalog, useLatestCallDay } from "./gamingStats";

const LATE_AFTER_MINUTES = 10 * 60 + 15; // 10:00 shift start + 15 min grace
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

const CATEGORY_STYLE: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-800 border-emerald-200",
  follow_up: "bg-amber-100 text-amber-800 border-amber-200",
  negative: "bg-rose-100 text-rose-800 border-rose-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

function Tile({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function ChartCard({ title, note, height = 280, children }: { title: string; note?: string; height?: number; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="mt-2" style={{ height }}>{children}</div>
    </Card>
  );
}

function istMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).split(":").map(Number);
  return h * 60 + m;
}

function isWorkingDay(d: Date): boolean {
  const dow = getDay(d);
  if (dow === 0) return false;
  if (dow === 6) {
    const week = Math.ceil(d.getDate() / 7);
    return week !== 2 && week !== 4;
  }
  return true;
}

interface AttendanceRow { user_id: string; date: string; status: string; sign_in_time: string | null; sign_out_time: string | null; total_hours: number | null }

type AttCode = "P" | "L" | "H" | "A" | "-";
function attendanceCode(row: AttendanceRow | undefined): AttCode {
  if (!row) return "-";
  if (row.status === "absent") return "A";
  if (row.status === "half_day") return "H";
  const m = istMinutes(row.sign_in_time);
  return m !== null && m > LATE_AFTER_MINUTES ? "L" : "P";
}
const ATT_STYLE: Record<AttCode, string> = {
  P: "bg-emerald-100 text-emerald-800", L: "bg-amber-100 text-amber-800", H: "bg-orange-100 text-orange-800", A: "bg-rose-100 text-rose-800", "-": "bg-muted text-muted-foreground",
};
const ATT_LABEL: Record<AttCode, string> = { P: "Present", L: "Late", H: "Half day", A: "Absent", "-": "No record" };

export function GamingManagerDashboard({ orgId }: { orgId: string }) {
  const { data: latest, isLoading: latestLoading } = useLatestCallDay(orgId);
  const [dayParam, setDayParam] = useUrlState("day", "");
  const [fromParam, setFromParam] = useUrlState("from", "");
  const [toParam, setToParam] = useUrlState("to", "");
  const [dispoParam, setDispoParam] = useUrlState("dispo", "");

  const day = dayParam || latest || format(new Date(), "yyyy-MM-dd");
  const to = toParam || day;
  const from = fromParam || format(addDays(parseISO(to), -13), "yyyy-MM-dd");

  const { data: callers = [] } = useCallers(orgId);
  const names = callers.map((c) => c.name.split(" ")[0]);

  const dayStats = useDayStats(orgId, day, day);
  const rangeStats = useDayStats(orgId, from, to);
  const dispoCounts = useDispoCounts(orgId, from, to);
  const catalog = useDispositionCatalog(orgId);

  const attendance = useQuery({
    queryKey: ["gaming-attendance", orgId, from, to],
    queryFn: async (): Promise<AttendanceRow[]> => {
      const { data } = await supabase
        .from("attendance_records")
        .select("user_id, date, status, sign_in_time, sign_out_time, total_hours")
        .eq("org_id", orgId).gte("date", from).lte("date", to);
      return (data ?? []) as AttendanceRow[];
    },
    enabled: !!orgId,
  });

  const stages = useQuery({
    queryKey: ["gaming-stage-counts", orgId],
    queryFn: async () => {
      const { data: st } = await supabase.from("pipeline_stages").select("id, name, stage_order, color").eq("org_id", orgId).order("stage_order");
      return Promise.all((st ?? []).map(async (s) => {
        const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("pipeline_stage_id", s.id);
        return { ...s, count: count ?? 0 };
      }));
    },
    enabled: !!orgId,
  });

  // calls per caller per hour on the selected day (blank stretches show idle time)
  const hourly = useQuery({
    queryKey: ["gaming-hourly", orgId, day],
    queryFn: async () => {
      const { data } = await supabase.from("call_logs").select("agent_id, started_at")
        .eq("org_id", orgId)
        .gte("started_at", `${day}T00:00:00+05:30`).lt("started_at", `${format(addDays(parseISO(day), 1), "yyyy-MM-dd")}T00:00:00+05:30`)
        .limit(1000);
      const m = new Map<string, number>();
      for (const r of data ?? []) {
        const h = Number(new Date(r.started_at!).toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).slice(0, 2));
        m.set(`${r.agent_id}|${h}`, (m.get(`${r.agent_id}|${h}`) ?? 0) + 1);
      }
      return m;
    },
    enabled: !!orgId,
  });

  const dayRows = dayStats.data ?? [];
  const dayTotals = sumStats(dayRows);
  const rangeTotals = sumStats(rangeStats.data ?? []);
  const attByKey = useMemo(() => new Map((attendance.data ?? []).map((a) => [`${a.user_id}|${a.date}`, a])), [attendance.data]);

  const trend = useMemo<TrendPoint[]>(() => {
    const byDay = new Map<string, TrendPoint & { day: string }>();
    for (const r of rangeStats.data ?? []) {
      const e = byDay.get(r.day) ?? { day: r.day, label: format(parseISO(r.day), "d MMM"), calls: 0, newDials: 0, connected: 0, clean: 0, registrations: 0, activations: 0 };
      e.calls += r.calls; e.newDials += r.new_dials; e.connected += r.connected_calls; e.clean += r.clean_calls; e.registrations += r.registrations; e.activations += r.activations;
      byDay.set(r.day, e);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [rangeStats.data]);

  const toCallerRow = (name: string, rows: typeof dayRows): CallerRow => {
    const t = sumStats(rows);
    return { name, calls: t.calls, newDials: t.new_dials, connected: t.connected_calls, clean: t.clean_calls, registrations: t.registrations, activations: t.activations, workHrs: +(t.work_secs / 3600).toFixed(1), idleHrs: +(t.idle_secs / 3600).toFixed(1) };
  };
  const dayCallers = callers.map((c) => toCallerRow(c.name.split(" ")[0], dayRows.filter((r) => r.agent_id === c.id)));
  const rangeCallers = callers.map((c) => toCallerRow(c.name.split(" ")[0], (rangeStats.data ?? []).filter((r) => r.agent_id === c.id)));

  // dispositions
  const { byDispo, bySub, byCaller } = useMemo(() => {
    const byDispo = new Map<string, number>(); const bySub = new Map<string, number>(); const byCaller = new Map<string, number>();
    for (const r of dispoCounts.data ?? []) {
      if (r.disposition_id) byDispo.set(r.disposition_id, (byDispo.get(r.disposition_id) ?? 0) + r.calls);
      if (r.sub_disposition_id) bySub.set(r.sub_disposition_id, (bySub.get(r.sub_disposition_id) ?? 0) + r.calls);
      byCaller.set(`${r.disposition_id}|${r.agent_id}`, (byCaller.get(`${r.disposition_id}|${r.agent_id}`) ?? 0) + r.calls);
      byCaller.set(`s|${r.sub_disposition_id}|${r.agent_id}`, (byCaller.get(`s|${r.sub_disposition_id}|${r.agent_id}`) ?? 0) + r.calls);
    }
    return { byDispo, bySub, byCaller };
  }, [dispoCounts.data]);
  const dispositions = catalog.data?.dispositions ?? [];
  const subs = catalog.data?.subs ?? [];
  const totalCalls = [...byDispo.values()].reduce((s, n) => s + n, 0);
  const selectedDispo = dispositions.find((d) => d.id === dispoParam) ?? dispositions[0];

  // attendance
  const rangeDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).filter(isWorkingDay);
  const attCodes = callers.map((c) => rangeDays.map((d) => attendanceCode(attByKey.get(`${c.id}|${format(d, "yyyy-MM-dd")}`))));
  const attCount = (k: AttCode) => attCodes.map((row) => row.filter((x) => x === k).length);
  const attendanceRate = rangeDays.map((d) => {
    const key = format(d, "yyyy-MM-dd");
    const here = callers.filter((c) => { const r = attByKey.get(`${c.id}|${key}`); return r && r.status !== "absent"; }).length;
    return callers.length ? Math.round((100 * here) / callers.length) : 0;
  });

  if (latestLoading) return <LoadingState message="Loading dashboard..." />;

  const labels = trend.map((t) => t.label);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Calling Manager Dashboard</h1>
        <p className="text-sm text-muted-foreground">Every caller's day: attendance, calls, registrations and activations.</p>
      </div>

      <Card className="p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Dialled, new dials, connected and clean calls by date</h2>
            <p className="text-xs text-muted-foreground">
              {rangeTotals.calls.toLocaleString("en-IN")} dialled · {rangeTotals.new_dials.toLocaleString("en-IN")} new dials · {rangeTotals.connected_calls.toLocaleString("en-IN")} connected · {rangeTotals.clean_calls.toLocaleString("en-IN")} clean (a minute or more).
              Top: each measure indexed to its own average (100). Bottom: daily rates. Hover for real counts.
            </p>
          </div>
          <RangePicker from={from} to={to} setFrom={setFromParam} setTo={setToParam} />
        </div>
        <div className="h-[400px]"><EChart option={heroOption(trend)} /></div>
      </Card>

      <UrlTabs defaultValue="day" className="space-y-4">
        <TabsList>
          <TabsTrigger value="day">Day view</TabsTrigger>
          <TabsTrigger value="funnel">Funnel &amp; trend</TabsTrigger>
          <TabsTrigger value="dispositions">Dispositions</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="day" className="space-y-4">
          <div className="flex items-center gap-2">
            <label htmlFor="gaming-day" className="text-sm text-muted-foreground">Day</label>
            <Input id="gaming-day" type="date" className="w-44" value={day} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => e.target.value && setDayParam(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Tile label="Work hours" value={fmtHM(dayTotals.work_secs)} />
            <Tile label="Idle hours" value={fmtHM(dayTotals.idle_secs)} color={SERIES.idle} />
            <Tile label="Dialled" value={dayTotals.calls} hint={`${dayTotals.new_dials} new dials`} color={SERIES.dialled} />
            <Tile label="Connected" value={dayTotals.connected_calls} hint={`${pct(dayTotals.connected_calls, dayTotals.calls)}% of dialled`} color={SERIES.connected} />
            <Tile label="Clean calls" value={dayTotals.clean_calls} hint={`${pct(dayTotals.clean_calls, dayTotals.calls)}% of dialled`} color={SERIES.clean} />
            <Tile label="Registrations" value={dayTotals.registrations} hint={`${pct(dayTotals.registrations, dayTotals.clean_calls)}% of clean calls`} color={SERIES.registrations} />
            <Tile label="Activations" value={dayTotals.activations} hint={`${pct(dayTotals.activations, dayTotals.registrations)}% of registrations`} color={SERIES.activations} />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <ChartCard title="Caller scorecard" note="Each column is shaded against the best caller in that column" height={300}>
                <EChart option={callerHeatmapOption(dayCallers)} />
              </ChartCard>
            </div>
            <div className="lg:col-span-2">
              <ChartCard title="Work and idle hours" note="Idle = gaps over 5 minutes between calls, plus time before the first and after the last call" height={300}>
                <EChart option={workIdleOption(dayCallers)} />
              </ChartCard>
            </div>
          </div>
          <ChartCard title="When each caller was dialling" note="Calls dialled per hour; empty stretches are breaks and idle time" height={290}>
            <EChart option={hourlyHeatmapOption(names, HOURS, callers.map((c) => HOURS.map((h) => hourly.data?.get(`${c.id}|${h}`) ?? 0)))} />
          </ChartCard>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead><TableHead>Attendance</TableHead><TableHead>Login</TableHead><TableHead>Logout</TableHead>
                  <TableHead className="text-right">Work hrs</TableHead><TableHead className="text-right">Idle hrs</TableHead>
                  <TableHead className="text-right">Calls</TableHead><TableHead className="text-right">New dials</TableHead><TableHead className="text-right">Clean calls</TableHead>
                  <TableHead className="text-right">Registrations</TableHead><TableHead className="text-right">Activations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callers.map((c) => {
                  const r = dayRows.find((x) => x.agent_id === c.id);
                  const code = attendanceCode(attByKey.get(`${c.id}|${day}`));
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${ATT_STYLE[code]}`}>{ATT_LABEL[code]}</span></TableCell>
                      <TableCell className="tabular-nums">{fmtClock(r?.login_at ?? null)}</TableCell>
                      <TableCell className="tabular-nums">{fmtClock(r?.logout_at ?? null)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r ? fmtHM(r.work_secs) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r ? fmtHM(r.idle_secs) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.calls ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.new_dials ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.clean_calls ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.registrations ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.activations ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <p className="text-sm text-muted-foreground">
            A clean call lasts a minute or more: {pct(dayTotals.clean_calls, dayTotals.calls)}% of calls were clean, {pct(dayTotals.registrations, dayTotals.clean_calls)}% of those became registrations and {pct(dayTotals.activations, dayTotals.registrations)}% of registrations activated.
          </p>
        </TabsContent>

        <TabsContent value="funnel" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Conversion funnel" note="For the dates above" height={300}>
              <EChart option={funnelOption([
                { name: "Calls dialled", value: rangeTotals.calls, note: "" },
                { name: "Clean calls", value: rangeTotals.clean_calls, note: `${pct(rangeTotals.clean_calls, rangeTotals.calls)}% of calls` },
                { name: "Registrations", value: rangeTotals.registrations, note: `${pct(rangeTotals.registrations, rangeTotals.clean_calls)}% of clean` },
                { name: "Activations", value: rangeTotals.activations, note: `${pct(rangeTotals.activations, rangeTotals.registrations)}% of registered` },
              ])} />
            </ChartCard>
            <ChartCard title="Leads by stage" note="Every lead in the org today" height={300}>
              <EChart option={rankedBarsOption((stages.data ?? []).map((s) => ({ name: s.name, value: s.count, color: s.color ?? VIZ.blue })), "", 90)} />
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Registrations and activations per day">
              <EChart option={linesOption(labels, [{ name: "Registrations", color: SERIES.registrations, data: trend.map((t) => t.registrations) }, { name: "Activations", color: SERIES.activations, data: trend.map((t) => t.activations) }])} />
            </ChartCard>
            <ChartCard title="New dials and repeat dials per day" note="A new dial is the first call ever made to a lead">
              <EChart option={groupedBarsOption(labels, [{ name: "New dials", color: SERIES.newDials, data: trend.map((t) => t.newDials) }, { name: "Repeat dials", color: SERIES.idle, data: trend.map((t) => t.calls - t.newDials) }])} />
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Caller scorecard" note="Dates above. Each column is shaded against the best caller in that column" height={300}>
              <EChart option={callerHeatmapOption(rangeCallers)} />
            </ChartCard>
            <ChartCard title="Effort and outcome" note="Calls dialled against registrations; dashed lines mark the team median" height={300}>
              <EChart option={quadrantOption(rangeCallers)} />
            </ChartCard>
          </div>
          <ChartCard title="Conversion by caller" note="Clean % of calls · registered % of clean calls · activated % of registrations">
            <EChart option={groupedBarsOption(names, [
              { name: "Clean %", color: SERIES.clean, data: rangeCallers.map((r) => pct(r.clean, r.calls)) },
              { name: "Registered % of clean", color: SERIES.registrations, data: rangeCallers.map((r) => pct(r.registrations, r.clean)) },
              { name: "Activated % of registered", color: SERIES.activations, data: rangeCallers.map((r) => pct(r.activations, r.registrations)) },
            ], "%")} />
          </ChartCard>
        </TabsContent>

        <TabsContent value="dispositions" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Every call ends with one disposition and one sub-disposition chosen by the caller. Registered and Activated drive the funnel.{" "}
            <Link to="/admin/call-dispositions" className="text-primary underline">Edit the list</Link>
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(CATEGORY_LABEL).map(([k, label]) => <span key={k} className="rounded px-2 py-0.5 font-medium text-white" style={{ background: CATEGORY_COLORS[k] }}>{label}</span>)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Every disposition and sub-disposition" note={`${totalCalls.toLocaleString("en-IN")} calls in the dates above; area = number of calls`} height={380}>
              <EChart option={dispoTreemapOption(dispositions.map((d) => ({ id: d.id, name: d.name, category: d.category ?? "neutral", calls: byDispo.get(d.id) ?? 0, subs: subs.filter((s) => s.disposition_id === d.id).map((s) => ({ name: s.name, calls: bySub.get(s.id) ?? 0 })) })))} />
            </ChartCard>
            <ChartCard title="Calls by disposition" note="Ranked, coloured by disposition type" height={380}>
              <EChart option={rankedBarsOption(dispositions.map((d) => ({ name: d.name, value: byDispo.get(d.id) ?? 0, color: CATEGORY_COLORS[d.category ?? "neutral"] })).sort((a, b) => b.value - a.value))} />
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Disposition by caller" note="Shaded against the busiest caller in each column" height={300}>
              <EChart option={callerDispoHeatmapOption(names, dispositions.map((d) => d.name), callers.map((c) => dispositions.map((d) => byCaller.get(`${d.id}|${c.id}`) ?? 0)))} />
            </ChartCard>
            <ChartCard title="Disposition mix by caller" note="Calls grouped by disposition type" height={300}>
              <EChart option={stackedBarsOption(names, Object.keys(CATEGORY_LABEL).map((k) => ({
                name: CATEGORY_LABEL[k], color: CATEGORY_COLORS[k],
                data: callers.map((c) => dispositions.filter((d) => (d.category ?? "neutral") === k).reduce((s, d) => s + (byCaller.get(`${d.id}|${c.id}`) ?? 0), 0)),
              })))} />
            </ChartCard>
          </div>
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Sub-dispositions</h2>
                <p className="text-xs text-muted-foreground">{selectedDispo?.description}</p>
              </div>
              <Select value={selectedDispo?.id ?? ""} onValueChange={setDispoParam}>
                <SelectTrigger className="w-60"><SelectValue placeholder="Choose a disposition" /></SelectTrigger>
                <SelectContent>{dispositions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div style={{ height: Math.max(120, subs.filter((s) => s.disposition_id === selectedDispo?.id).length * 40 + 24) }}>
              <EChart option={rankedBarsOption(subs.filter((s) => s.disposition_id === selectedDispo?.id).map((s) => ({ name: s.name, value: bySub.get(s.id) ?? 0, color: CATEGORY_COLORS[selectedDispo?.category ?? "neutral"] })).sort((a, b) => b.value - a.value), "", 230)} />
            </div>
          </Card>
          <details className="rounded-lg border bg-card">
            <summary className="cursor-pointer p-4 text-sm font-medium text-foreground">Full table: every disposition and sub-disposition by caller</summary>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Disposition / sub-disposition</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">% of calls</TableHead>
                    {names.map((n) => <TableHead key={n} className="text-right">{n}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dispositions.flatMap((d) => {
                    const cat = d.category ?? "neutral";
                    return [
                      <TableRow key={d.id} className="bg-muted/50">
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{d.name}</span>
                            <Badge variant="outline" className={CATEGORY_STYLE[cat]}>{CATEGORY_LABEL[cat] ?? cat}</Badge>
                          </div>
                          {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{byDispo.get(d.id) ?? 0}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{pct(byDispo.get(d.id) ?? 0, totalCalls)}%</TableCell>
                        {callers.map((c) => <TableCell key={c.id} className="text-right font-semibold tabular-nums">{byCaller.get(`${d.id}|${c.id}`) ?? 0}</TableCell>)}
                      </TableRow>,
                      ...subs.filter((s) => s.disposition_id === d.id).map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="pl-8 text-muted-foreground">{s.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{bySub.get(s.id) ?? 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(bySub.get(s.id) ?? 0, totalCalls)}%</TableCell>
                          {callers.map((c) => <TableCell key={c.id} className="text-right tabular-nums">{byCaller.get(`s|${s.id}|${c.id}`) ?? 0}</TableCell>)}
                        </TableRow>
                      )),
                    ];
                  })}
                </TableBody>
              </Table>
            </div>
          </details>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {([["P", ATT_COLORS.present], ["L", ATT_COLORS.late], ["H", ATT_COLORS.half], ["A", ATT_COLORS.absent]] as [AttCode, string][]).map(([k, c]) => <span key={k} className="rounded px-2 py-0.5 font-semibold text-white" style={{ background: c }}>{k} = {ATT_LABEL[k]}</span>)}
            <span className="text-muted-foreground">Shift starts 10:00 with a 15 minute grace. Late = login after 10:15. Half day = under 8 hours logged in. Sundays and the 2nd and 4th Saturdays are off.</span>
          </div>
          <ChartCard title="Attendance, day by day" note="One cell per caller per working day" height={Math.max(220, callers.length * 44 + 60)}>
            <EChart option={attendanceHeatmapOption(names, rangeDays.map((d) => format(d, "d")), attCodes)} />
          </ChartCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Attendance by caller" note="Working days in the dates above">
              <EChart option={stackedBarsOption(names, [
                { name: "Present", color: ATT_COLORS.present, data: attCount("P") }, { name: "Late", color: ATT_COLORS.late, data: attCount("L") },
                { name: "Half day", color: ATT_COLORS.half, data: attCount("H") }, { name: "Absent", color: ATT_COLORS.absent, data: attCount("A") },
              ])} />
            </ChartCard>
            <ChartCard title="Team attendance by day" note="Share of callers who signed in">
              <EChart option={linesOption(rangeDays.map((d) => format(d, "d MMM")), [{ name: "Signed in", color: ATT_COLORS.present, data: attendanceRate }], "%")} />
            </ChartCard>
          </div>
          <p className="text-sm text-muted-foreground">
            Month calendar, leave and regularisation requests: <Link to="/admin/attendance-report" className="text-primary underline">full attendance report</Link>.
          </p>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}

function RangePicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="gaming-from" className="text-sm text-muted-foreground">From</label>
      <Input id="gaming-from" type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
      <label htmlFor="gaming-to" className="text-sm text-muted-foreground">To</label>
      <Input id="gaming-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
    </div>
  );
}
