import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, eachDayOfInterval, format, getDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "@/components/common/LoadingState";
import { UrlTabs } from "@/components/UrlTabs";
import { useUrlState } from "@/hooks/useUrlState";
import { CallsByDateHour } from "./CallsByDateHour";
import {
  fmtClock, fmtHM, pct, sumStats, useCallers, useDayStats, useDispoCounts, useDispositionCatalog, useHourlyCounts, useLatestCallDay,
} from "./gamingStats";

const LATE_AFTER_MINUTES = 10 * 60 + 15; // 10:00 shift start + 15 min grace

// Status colours, used only on small chips that name a state.
const CATEGORY_STYLE: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-800 border-emerald-200",
  follow_up: "bg-amber-50 text-amber-800 border-amber-200",
  negative: "bg-rose-50 text-rose-800 border-rose-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
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
  P: "bg-emerald-50 text-emerald-800", L: "bg-amber-50 text-amber-800", H: "bg-orange-50 text-orange-800", A: "bg-rose-50 text-rose-800", "-": "bg-muted text-muted-foreground",
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
  const dayStats = useDayStats(orgId, day, day);
  const rangeStats = useDayStats(orgId, from, to);
  const hourly = useHourlyCounts(orgId, from, to);
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
      const { data: st } = await supabase.from("pipeline_stages").select("id, name, stage_order").eq("org_id", orgId).order("stage_order");
      return Promise.all((st ?? []).map(async (s) => {
        const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("pipeline_stage_id", s.id);
        return { name: s.name, count: count ?? 0 };
      }));
    },
    enabled: !!orgId,
  });

  const rangeTotals = sumStats(rangeStats.data ?? []);
  const dayRows = dayStats.data ?? [];
  const dayTotals = sumStats(dayRows);
  const attByKey = useMemo(() => new Map((attendance.data ?? []).map((a) => [`${a.user_id}|${a.date}`, a])), [attendance.data]);

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

  const rangeDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).filter(isWorkingDay);
  const attCodes = callers.map((c) => rangeDays.map((d) => attendanceCode(attByKey.get(`${c.id}|${format(d, "yyyy-MM-dd")}`))));

  if (latestLoading) return <LoadingState message="Loading dashboard..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Calling Manager Dashboard</h1>
          <p className="mt-1 max-w-3xl text-base text-foreground">
            Callers dialled {rangeTotals.calls.toLocaleString("en-IN")} calls. {pct(rangeTotals.clean_calls, rangeTotals.calls)}% were clean (a minute or more),
            {" "}{pct(rangeTotals.registrations, rangeTotals.clean_calls)}% of clean calls became registrations, and {pct(rangeTotals.activations, rangeTotals.registrations)}% of registrations activated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="gaming-from" className="text-sm text-muted-foreground">From</label>
          <Input id="gaming-from" type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFromParam(e.target.value)} />
          <label htmlFor="gaming-to" className="text-sm text-muted-foreground">To</label>
          <Input id="gaming-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setToParam(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Dialled" value={rangeTotals.calls.toLocaleString("en-IN")} />
        <Tile label="New dials" value={rangeTotals.new_dials.toLocaleString("en-IN")} hint="first-ever call to a lead" />
        <Tile label="Connected" value={rangeTotals.connected_calls.toLocaleString("en-IN")} hint={`${pct(rangeTotals.connected_calls, rangeTotals.calls)}% of dialled`} />
        <Tile label="Clean calls" value={rangeTotals.clean_calls.toLocaleString("en-IN")} hint={`${pct(rangeTotals.clean_calls, rangeTotals.calls)}% of dialled`} />
        <Tile label="Registrations" value={rangeTotals.registrations.toLocaleString("en-IN")} hint={`${pct(rangeTotals.registrations, rangeTotals.clean_calls)}% of clean calls`} />
        <Tile label="Activations" value={rangeTotals.activations.toLocaleString("en-IN")} hint={`${pct(rangeTotals.activations, rangeTotals.registrations)}% of registrations`} />
      </div>
      {(stages.data ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">Leads by stage: {(stages.data ?? []).map((s) => `${s.name} ${s.count.toLocaleString("en-IN")}`).join(" · ")}</p>
      )}

      <CallsByDateHour rows={hourly.data ?? []} />

      <UrlTabs defaultValue="day" className="space-y-4">
        <TabsList>
          <TabsTrigger value="day">Day view</TabsTrigger>
          <TabsTrigger value="dispositions">Dispositions</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="day" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="gaming-day" className="text-sm text-muted-foreground">Day</label>
            <Input id="gaming-day" type="date" className="w-44" value={day} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => e.target.value && setDayParam(e.target.value)} />
            <span className="text-sm text-muted-foreground">
              {dayTotals.calls} dialled · {fmtHM(dayTotals.work_secs)} work hours · {fmtHM(dayTotals.idle_secs)} idle hours
            </span>
          </div>
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

        <TabsContent value="dispositions" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Every call ends with one disposition and one sub-disposition chosen by the caller. Registered and Activated drive the funnel.{" "}
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
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Shift starts 10:00 with a 15 minute grace. Late = login after 10:15. Half day = under 8 hours logged in. Sundays and the 2nd and 4th Saturdays are off.{" "}
            <Link to="/admin/attendance-report" className="text-primary underline">Full attendance report</Link>
          </p>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Caller</TableHead><TableHead className="text-right">Present</TableHead><TableHead className="text-right">Late</TableHead>
                  <TableHead className="text-right">Half day</TableHead><TableHead className="text-right">Absent</TableHead>
                  {rangeDays.map((d) => <TableHead key={d.toISOString()} className="px-1 text-center text-[11px]">{format(d, "d")}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {callers.map((c, i) => {
                  const codes = attCodes[i] ?? [];
                  const n = (k: AttCode) => codes.filter((x) => x === k).length;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{n("P") + n("L")}</TableCell>
                      <TableCell className="text-right tabular-nums">{n("L")}</TableCell>
                      <TableCell className="text-right tabular-nums">{n("H")}</TableCell>
                      <TableCell className="text-right tabular-nums">{n("A")}</TableCell>
                      {codes.map((k, j) => <TableCell key={j} className="px-1 text-center"><span title={ATT_LABEL[k]} className={`inline-block w-6 rounded py-0.5 text-[11px] font-semibold ${ATT_STYLE[k]}`}>{k === "-" ? "" : k}</span></TableCell>)}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <p className="text-xs text-muted-foreground">P present · L late · H half day · A absent</p>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
