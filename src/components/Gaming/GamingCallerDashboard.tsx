import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState } from "@/components/common/LoadingState";
import { useUrlState } from "@/hooks/useUrlState";
import {
  DAILY_TARGETS, fmtClock, fmtHM, pct, sumStats, useCallers, useDayStats, useDispoCounts, useDispositionCatalog, useLatestCallDay,
} from "./gamingStats";

const PURPLE = "#7c3aed";

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function TargetTile({ label, value, target }: { label: string; value: number; target: number }) {
  const done = value >= target;
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value} <span className="text-sm font-normal text-muted-foreground">of {target}</span>
      </p>
      <Progress value={Math.min(100, pct(value, target))} className="mt-2 h-1.5" />
      <p className="mt-1 text-xs text-muted-foreground">{done ? "Daily target met" : `${target - value} to go`}</p>
    </Card>
  );
}

export function GamingCallerDashboard({ orgId }: { orgId: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const { data: latest, isLoading: latestLoading } = useLatestCallDay(orgId, userId);
  const [dayParam, setDayParam] = useUrlState("day", "");
  const day = dayParam || latest || format(new Date(), "yyyy-MM-dd");
  const weekFrom = format(addDays(parseISO(day), -6), "yyyy-MM-dd");

  const { data: callers = [] } = useCallers(orgId);
  const me = callers.find((c) => c.id === userId);

  const dayStats = useDayStats(orgId, day, day, userId);
  const weekStats = useDayStats(orgId, weekFrom, day, userId);
  const teamWeek = useDayStats(orgId, weekFrom, day);
  const dispoCounts = useDispoCounts(orgId, day, day, userId);
  const catalog = useDispositionCatalog(orgId);

  const attendance = useQuery({
    queryKey: ["gaming-my-attendance", userId, day],
    queryFn: async () => {
      const { data } = await supabase.from("attendance_records").select("status, sign_in_time, sign_out_time, total_hours").eq("user_id", userId!).eq("date", day).maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  const hourly = useQuery({
    queryKey: ["gaming-my-hourly", userId, day],
    queryFn: async () => {
      const { data } = await supabase.from("call_logs").select("started_at, call_duration")
        .eq("org_id", orgId).eq("agent_id", userId!)
        .gte("started_at", `${day}T00:00:00+05:30`).lt("started_at", `${format(addDays(parseISO(day), 1), "yyyy-MM-dd")}T00:00:00+05:30`)
        .limit(1000);
      const buckets = new Map<number, { calls: number; clean: number }>();
      for (const r of data ?? []) {
        const h = Number(new Date(r.started_at!).toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).slice(0, 2));
        const b = buckets.get(h) ?? { calls: 0, clean: 0 };
        b.calls++; if ((r.call_duration ?? 0) >= 60) b.clean++;
        buckets.set(h, b);
      }
      return Array.from({ length: 10 }, (_, i) => 9 + i).map((h) => ({ hour: `${h}:00`, calls: buckets.get(h)?.calls ?? 0, clean: buckets.get(h)?.clean ?? 0 }));
    },
    enabled: !!userId,
  });

  const callbacks = useQuery({
    queryKey: ["gaming-my-callbacks", userId],
    queryFn: async () => {
      const { data } = await supabase.from("contact_activities")
        .select("id, contact_id, subject, scheduled_at, priority")
        .eq("org_id", orgId).eq("created_by", userId!).eq("activity_type", "call").is("completed_at", null)
        .order("scheduled_at", { ascending: true }).limit(8);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const myLeads = useQuery({
    queryKey: ["gaming-my-leads", userId],
    queryFn: async () => {
      const { data: st } = await supabase.from("pipeline_stages").select("id, name, stage_order, color").eq("org_id", orgId).order("stage_order");
      return Promise.all((st ?? []).map(async (s) => {
        const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("assigned_to", userId!).eq("pipeline_stage_id", s.id);
        return { ...s, count: count ?? 0 };
      }));
    },
    enabled: !!userId,
  });

  const today = sumStats(dayStats.data ?? []);
  const row = dayStats.data?.[0];
  const dispoRows = useMemo(() => {
    const bySub = new Map<string, number>(); const byDispo = new Map<string, number>();
    for (const r of dispoCounts.data ?? []) {
      if (r.sub_disposition_id) bySub.set(r.sub_disposition_id, (bySub.get(r.sub_disposition_id) ?? 0) + r.calls);
      if (r.disposition_id) byDispo.set(r.disposition_id, (byDispo.get(r.disposition_id) ?? 0) + r.calls);
    }
    return (catalog.data?.dispositions ?? []).map((d) => ({
      d, total: byDispo.get(d.id) ?? 0,
      subs: (catalog.data?.subs ?? []).filter((s) => s.disposition_id === d.id).map((s) => ({ s, n: bySub.get(s.id) ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n),
    })).filter((x) => x.total > 0);
  }, [dispoCounts.data, catalog.data]);

  const board = useMemo(() => {
    const by = new Map<string, { id: string; registrations: number; activations: number; calls: number }>();
    for (const r of teamWeek.data ?? []) {
      const e = by.get(r.agent_id) ?? { id: r.agent_id, registrations: 0, activations: 0, calls: 0 };
      e.registrations += r.registrations; e.activations += r.activations; e.calls += r.calls;
      by.set(r.agent_id, e);
    }
    return [...by.values()].sort((a, b) => b.registrations + b.activations - (a.registrations + a.activations));
  }, [teamWeek.data]);

  if (latestLoading || !userId) return <LoadingState message="Loading your dashboard..." />;

  const status = attendance.data?.status;
  const attLabel = status === "present" ? "Present" : status === "half_day" ? "Half day" : status === "absent" ? "Absent" : "No record";
  const week = (weekStats.data ?? []).slice().sort((a, b) => b.day.localeCompare(a.day));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Hello{me ? `, ${me.name.split(" ")[0]}` : ""}</h1>
          <p className="text-sm text-muted-foreground">Your calling day: where you stand against today's targets.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="caller-day" className="text-sm text-muted-foreground">Day</label>
          <Input id="caller-day" type="date" className="w-44" value={day} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => e.target.value && setDayParam(e.target.value)} />
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-x-8 gap-y-2 p-4">
        <div><p className="text-xs text-muted-foreground">Attendance</p><Badge variant={status === "present" ? "default" : "secondary"}>{attLabel}</Badge></div>
        <div><p className="text-xs text-muted-foreground">Login</p><p className="font-medium tabular-nums">{fmtClock(row?.login_at ?? attendance.data?.sign_in_time ?? null)}</p></div>
        <div><p className="text-xs text-muted-foreground">Logout</p><p className="font-medium tabular-nums">{fmtClock(row?.logout_at ?? attendance.data?.sign_out_time ?? null)}</p></div>
        <div><p className="text-xs text-muted-foreground">Work hours</p><p className="font-medium tabular-nums">{fmtHM(today.work_secs)}</p></div>
        <div><p className="text-xs text-muted-foreground">Idle hours</p><p className="font-medium tabular-nums">{fmtHM(today.idle_secs)}</p></div>
        <Link to="/attendance" className="ml-auto text-sm text-primary underline">My attendance</Link>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <TargetTile label="Calls" value={today.calls} target={DAILY_TARGETS.calls} />
        <TargetTile label="Clean calls" value={today.clean_calls} target={DAILY_TARGETS.clean} />
        <TargetTile label="Registrations" value={today.registrations} target={DAILY_TARGETS.registrations} />
        <TargetTile label="Activations" value={today.activations} target={DAILY_TARGETS.activations} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Clean calls" value={`${pct(today.clean_calls, today.calls)}%`} hint="of your calls ran a minute or more" />
        <Tile label="Registrations" value={`${pct(today.registrations, today.clean_calls)}%`} hint="of your clean calls" />
        <Tile label="Activations" value={`${pct(today.activations, today.registrations)}%`} hint="of your registrations" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Calls through the day</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly.data ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="calls" name="Calls" fill={PURPLE} radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Callbacks waiting for you</h2>
          {(callbacks.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No callbacks scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {(callbacks.data ?? []).map((cb) => (
                <li key={cb.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/contacts/${cb.contact_id}`} className="flex items-center gap-2 text-foreground hover:underline"><Phone size={14} className="text-muted-foreground" />{(cb.subject ?? "").replace("Callback — ", "")}</Link>
                  <span className="tabular-nums text-muted-foreground">{cb.scheduled_at ? new Date(cb.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">How your calls ended</h2>
          {dispoRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls on this day.</p>
          ) : (
            <div className="space-y-3">
              {dispoRows.map(({ d, total, subs }) => (
                <div key={d.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-foreground">{d.name}</span>
                    <span className="tabular-nums text-foreground">{total} <span className="text-xs text-muted-foreground">({pct(total, today.calls)}%)</span></span>
                  </div>
                  <p className="text-xs text-muted-foreground">{subs.map((x) => `${x.s.name} ${x.n}`).join(" · ")}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">My leads by stage</h2>
          <div className="space-y-2">
            {(myLeads.data ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? PURPLE }} />{s.name}</span>
                <span className="tabular-nums text-foreground">{s.count.toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
          <Link to="/pipeline" className="mt-3 inline-block text-sm text-primary underline">Open my pipeline</Link>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <h2 className="p-4 pb-0 text-sm font-semibold text-foreground">My last 7 days</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Clean</TableHead>
                <TableHead className="text-right">Reg.</TableHead><TableHead className="text-right">Act.</TableHead><TableHead className="text-right">Work hrs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {week.map((r) => (
                <TableRow key={r.day}>
                  <TableCell>{format(parseISO(r.day), "EEE d MMM")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.clean_calls}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.registrations}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.activations}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtHM(r.work_secs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="overflow-x-auto">
          <h2 className="p-4 pb-0 text-sm font-semibold text-foreground">Team this week (registrations + activations)</h2>
          <Table>
            <TableHeader>
              <TableRow><TableHead>#</TableHead><TableHead>Caller</TableHead><TableHead className="text-right">Reg.</TableHead><TableHead className="text-right">Act.</TableHead><TableHead className="text-right">Calls</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {board.map((b, i) => {
                const name = callers.find((c) => c.id === b.id)?.name ?? "Caller";
                return (
                  <TableRow key={b.id} className={b.id === userId ? "bg-primary/10 font-semibold" : ""}>
                    <TableCell>{i + 1}</TableCell><TableCell>{b.id === userId ? `${name} (you)` : name}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.registrations}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.activations}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.calls}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
