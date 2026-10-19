import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, eachDayOfInterval, format, getDay, parseISO } from "date-fns";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "@/components/common/LoadingState";
import { UrlTabs } from "@/components/UrlTabs";
import { useUrlState } from "@/hooks/useUrlState";
import {
  fmtClock, fmtHM, pct, sumStats, useCallers, useDayStats, useDispoCounts, useDispositionCatalog, useLatestCallDay,
} from "./gamingStats";

const PURPLE = "#7c3aed";
const TEAL = "#0d9488";
const LATE_AFTER_MINUTES = 10 * 60 + 15; // 10:00 shift start + 15 min grace

const CATEGORY_STYLE: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-800 border-emerald-200",
  follow_up: "bg-amber-100 text-amber-800 border-amber-200",
  negative: "bg-rose-100 text-rose-800 border-rose-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};
const CATEGORY_LABEL: Record<string, string> = { positive: "Positive", follow_up: "Follow-up", negative: "Negative", neutral: "Neutral" };

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
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

  const day = dayParam || latest || format(new Date(), "yyyy-MM-dd");
  const to = toParam || day;
  const from = fromParam || format(addDays(parseISO(to), -13), "yyyy-MM-dd");

  const { data: callers = [] } = useCallers(orgId);
  const nameOf = useMemo(() => Object.fromEntries(callers.map((c) => [c.id, c.name])), [callers]);

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
      const counts = await Promise.all((st ?? []).map(async (s) => {
        const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("pipeline_stage_id", s.id);
        return { ...s, count: count ?? 0 };
      }));
      return counts;
    },
    enabled: !!orgId,
  });

  const dayRows = (dayStats.data ?? []).slice().sort((a, b) => (nameOf[a.agent_id] ?? "").localeCompare(nameOf[b.agent_id] ?? ""));
  const dayTotals = sumStats(dayRows);
  const rangeTotals = sumStats(rangeStats.data ?? []);
  const attByKey = new Map((attendance.data ?? []).map((a) => [`${a.user_id}|${a.date}`, a]));
  const dayAttendance = (id: string) => attByKey.get(`${id}|${day}`);

  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; calls: number; clean: number; registrations: number; activations: number }>();
    for (const r of rangeStats.data ?? []) {
      const e = byDay.get(r.day) ?? { day: r.day, calls: 0, clean: 0, registrations: 0, activations: 0 };
      e.calls += r.calls; e.clean += r.clean_calls; e.registrations += r.registrations; e.activations += r.activations;
      byDay.set(r.day, e);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((e) => ({ ...e, label: format(parseISO(e.day), "d MMM") }));
  }, [rangeStats.data]);

  if (latestLoading) return <LoadingState message="Loading dashboard..." />;

  const funnelSteps = [
    { label: "Calls made", value: rangeTotals.calls, note: "" },
    { label: "Clean calls (a minute or more)", value: rangeTotals.clean_calls, note: `${pct(rangeTotals.clean_calls, rangeTotals.calls)}% of calls` },
    { label: "Registrations", value: rangeTotals.registrations, note: `${pct(rangeTotals.registrations, rangeTotals.clean_calls)}% of clean calls` },
    { label: "Activations", value: rangeTotals.activations, note: `${pct(rangeTotals.activations, rangeTotals.registrations)}% of registrations` },
  ];

  const perCaller = callers.map((c) => ({ c, t: sumStats((rangeStats.data ?? []).filter((r) => r.agent_id === c.id)) }));

  // disposition matrix: rows per disposition + sub-disposition, columns per caller
  const countMap = new Map<string, number>();
  for (const r of dispoCounts.data ?? []) {
    for (const key of [`d|${r.disposition_id}|${r.agent_id}`, `s|${r.sub_disposition_id}|${r.agent_id}`, `d|${r.disposition_id}|all`, `s|${r.sub_disposition_id}|all`]) {
      countMap.set(key, (countMap.get(key) ?? 0) + r.calls);
    }
  }
  const totalCalls = (dispoCounts.data ?? []).reduce((s, r) => s + r.calls, 0);

  const rangeDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).filter(isWorkingDay);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Calling Manager Dashboard</h1>
          <p className="text-sm text-muted-foreground">Every caller's day: attendance, calls, registrations and activations.</p>
        </div>
      </div>

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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Work hours" value={fmtHM(dayTotals.work_secs)} />
            <Tile label="Idle hours" value={fmtHM(dayTotals.idle_secs)} />
            <Tile label="Calls" value={dayTotals.calls} />
            <Tile label="Clean calls" value={dayTotals.clean_calls} hint={`${pct(dayTotals.clean_calls, dayTotals.calls)}% of calls`} />
            <Tile label="Registrations" value={dayTotals.registrations} hint={`${pct(dayTotals.registrations, dayTotals.clean_calls)}% of clean calls`} />
            <Tile label="Activations" value={dayTotals.activations} hint={`${pct(dayTotals.activations, dayTotals.registrations)}% of registrations`} />
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead><TableHead>Attendance</TableHead><TableHead>Login</TableHead><TableHead>Logout</TableHead>
                  <TableHead className="text-right">Work hrs</TableHead><TableHead className="text-right">Idle hrs</TableHead>
                  <TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Clean calls</TableHead>
                  <TableHead className="text-right">Registrations</TableHead><TableHead className="text-right">Activations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callers.map((c) => {
                  const r = dayRows.find((x) => x.agent_id === c.id);
                  const code = attendanceCode(dayAttendance(c.id));
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${ATT_STYLE[code]}`}>{ATT_LABEL[code]}</span></TableCell>
                      <TableCell className="tabular-nums">{fmtClock(r?.login_at ?? null)}</TableCell>
                      <TableCell className="tabular-nums">{fmtClock(r?.logout_at ?? null)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r ? fmtHM(r.work_secs) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r ? fmtHM(r.idle_secs) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r?.calls ?? "—"}</TableCell>
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
          <RangePicker from={from} to={to} setFrom={setFromParam} setTo={setToParam} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Conversion funnel</h2>
              <div className="space-y-3">
                {funnelSteps.map((s, i) => (
                  <div key={s.label}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-foreground">{s.label}</span>
                      <span className="tabular-nums text-foreground">{s.value.toLocaleString("en-IN")} <span className="text-xs text-muted-foreground">{s.note}</span></span>
                    </div>
                    <div className="h-3 rounded bg-muted">
                      <div className="h-3 rounded" style={{ width: `${Math.max(2, pct(s.value, funnelSteps[0].value))}%`, background: PURPLE, opacity: 1 - i * 0.2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Leads by stage</h2>
              <div className="space-y-2">
                {(stages.data ?? []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? PURPLE }} />{s.name}</span>
                    <span className="tabular-nums text-foreground">{s.count.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart title="Calls and clean calls per day" data={trend} lines={[["calls", "Calls", PURPLE], ["clean", "Clean calls", TEAL]]} />
            <TrendChart title="Registrations and activations per day" data={trend} lines={[["registrations", "Registrations", PURPLE], ["activations", "Activations", TEAL]]} />
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Clean</TableHead>
                  <TableHead className="text-right">Clean %</TableHead><TableHead className="text-right">Registrations</TableHead>
                  <TableHead className="text-right">Reg % of clean</TableHead><TableHead className="text-right">Activations</TableHead><TableHead className="text-right">Activation % of reg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perCaller.map(({ c, t }) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.calls}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.clean_calls}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.clean_calls, t.calls)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{t.registrations}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.registrations, t.clean_calls)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{t.activations}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.activations, t.registrations)}%</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Team</TableCell>
                  <TableCell className="text-right tabular-nums">{rangeTotals.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{rangeTotals.clean_calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(rangeTotals.clean_calls, rangeTotals.calls)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{rangeTotals.registrations}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(rangeTotals.registrations, rangeTotals.clean_calls)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{rangeTotals.activations}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(rangeTotals.activations, rangeTotals.registrations)}%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="dispositions" className="space-y-4">
          <RangePicker from={from} to={to} setFrom={setFromParam} setTo={setToParam} />
          <p className="text-sm text-muted-foreground">
            Every call ends with one disposition and one sub-disposition chosen by the caller. Registered and Activated are the two outcomes that drive the funnel.{" "}
            <Link to="/admin/call-dispositions" className="text-primary underline">Edit the list</Link>
          </p>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Disposition / sub-disposition</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">% of calls</TableHead>
                  {callers.map((c) => <TableHead key={c.id} className="text-right">{c.name.split(" ")[0]}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(catalog.data?.dispositions ?? []).flatMap((d) => {
                  const subs = (catalog.data?.subs ?? []).filter((s) => s.disposition_id === d.id);
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
                      <TableCell className="text-right font-semibold tabular-nums">{countMap.get(`d|${d.id}|all`) ?? 0}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{pct(countMap.get(`d|${d.id}|all`) ?? 0, totalCalls)}%</TableCell>
                      {callers.map((c) => <TableCell key={c.id} className="text-right font-semibold tabular-nums">{countMap.get(`d|${d.id}|${c.id}`) ?? 0}</TableCell>)}
                    </TableRow>,
                    ...subs.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-8 text-muted-foreground">{s.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{countMap.get(`s|${s.id}|all`) ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(countMap.get(`s|${s.id}|all`) ?? 0, totalCalls)}%</TableCell>
                        {callers.map((c) => <TableCell key={c.id} className="text-right tabular-nums">{countMap.get(`s|${s.id}|${c.id}`) ?? 0}</TableCell>)}
                      </TableRow>
                    )),
                  ];
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <RangePicker from={from} to={to} setFrom={setFromParam} setTo={setToParam} />
          <div className="flex flex-wrap gap-2 text-xs">
            {(["P", "L", "H", "A"] as AttCode[]).map((k) => <span key={k} className={`rounded px-2 py-0.5 font-medium ${ATT_STYLE[k]}`}>{k} = {ATT_LABEL[k]}</span>)}
            <span className="text-muted-foreground">Shift starts 10:00 with a 15 minute grace. Late = login after 10:15. Half day = under 8 hours logged in. Sundays and the 2nd and 4th Saturdays are off.</span>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead><TableHead className="text-right">Present</TableHead><TableHead className="text-right">Late</TableHead>
                  <TableHead className="text-right">Half day</TableHead><TableHead className="text-right">Absent</TableHead><TableHead className="text-right">Avg login</TableHead><TableHead className="text-right">Avg hours</TableHead>
                  {rangeDays.map((d) => <TableHead key={d.toISOString()} className="px-1 text-center text-[11px]">{format(d, "d")}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {callers.map((c) => {
                  const codes = rangeDays.map((d) => attendanceCode(attByKey.get(`${c.id}|${format(d, "yyyy-MM-dd")}`)));
                  const rows = rangeDays.map((d) => attByKey.get(`${c.id}|${format(d, "yyyy-MM-dd")}`)).filter((r): r is AttendanceRow => !!r && r.status !== "absent");
                  const logins = rows.map((r) => istMinutes(r.sign_in_time)).filter((m): m is number => m !== null);
                  const avgLogin = logins.length ? Math.round(logins.reduce((s, m) => s + m, 0) / logins.length) : null;
                  const avgHours = rows.length ? rows.reduce((s, r) => s + (r.total_hours ?? 0), 0) / rows.length : null;
                  const count = (k: AttCode) => codes.filter((x) => x === k).length;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{count("P") + count("L")}</TableCell>
                      <TableCell className="text-right tabular-nums">{count("L")}</TableCell>
                      <TableCell className="text-right tabular-nums">{count("H")}</TableCell>
                      <TableCell className="text-right tabular-nums">{count("A")}</TableCell>
                      <TableCell className="text-right tabular-nums">{avgLogin === null ? "—" : `${String(Math.floor(avgLogin / 60)).padStart(2, "0")}:${String(avgLogin % 60).padStart(2, "0")}`}</TableCell>
                      <TableCell className="text-right tabular-nums">{avgHours === null ? "—" : avgHours.toFixed(1)}</TableCell>
                      {codes.map((k, i) => <TableCell key={i} className="px-1 text-center"><span className={`inline-block w-6 rounded py-0.5 text-[11px] font-semibold ${ATT_STYLE[k]}`}>{k}</span></TableCell>)}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
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
      <Input id="gaming-from" type="date" className="w-44" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
      <label htmlFor="gaming-to" className="text-sm text-muted-foreground">To</label>
      <Input id="gaming-to" type="date" className="w-44" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
    </div>
  );
}

function TrendChart({ title, data, lines }: { title: string; data: Record<string, number | string>[]; lines: [string, string, string][] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {lines.map(([key, name, color]) => <Line key={key} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={2} dot={{ r: 3 }} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
