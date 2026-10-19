import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { LoadingState } from "@/components/common/LoadingState";
import { EChart } from "@/components/charts/EChart";
import { useUrlState } from "@/hooks/useUrlState";
import { SERIES, VIZ, dispoTreemapOption, funnelOption, groupedBarsOption, linesOption, rankedBarsOption, stackedBarsOption } from "./gamingCharts";
import { DAILY_TARGETS, fmtClock, fmtHM, pct, sumStats, useCallers, useDayStats, useDispoCounts, useDispositionCatalog, useLatestCallDay } from "./gamingStats";

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function Tile({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function TargetTile({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const done = value >= target;
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value} <span className="text-sm font-normal text-muted-foreground">of {target}</span>
      </p>
      <Progress value={Math.min(100, pct(value, target))} className="mt-2 h-1.5" />
      <p className="mt-1 text-xs text-muted-foreground">{done ? "Daily target met" : `${target - value} to go`}</p>
    </Card>
  );
}

function ChartCard({ title, note, height = 260, children }: { title: string; note?: string; height?: number; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="mt-2" style={{ height }}>{children}</div>
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
      const { data } = await supabase.from("call_logs").select("started_at, call_duration, answered_at")
        .eq("org_id", orgId).eq("agent_id", userId!)
        .gte("started_at", `${day}T00:00:00+05:30`).lt("started_at", `${format(addDays(parseISO(day), 1), "yyyy-MM-dd")}T00:00:00+05:30`)
        .limit(1000);
      const b = new Map<number, { calls: number; connected: number; clean: number }>();
      for (const r of data ?? []) {
        const h = Number(new Date(r.started_at!).toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).slice(0, 2));
        const e = b.get(h) ?? { calls: 0, connected: 0, clean: 0 };
        e.calls++; if (r.answered_at) e.connected++; if ((r.call_duration ?? 0) >= 60) e.clean++;
        b.set(h, e);
      }
      return b;
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

  const dispoNodes = useMemo(() => {
    const bySub = new Map<string, number>(); const byDispo = new Map<string, number>();
    for (const r of dispoCounts.data ?? []) {
      if (r.sub_disposition_id) bySub.set(r.sub_disposition_id, (bySub.get(r.sub_disposition_id) ?? 0) + r.calls);
      if (r.disposition_id) byDispo.set(r.disposition_id, (byDispo.get(r.disposition_id) ?? 0) + r.calls);
    }
    return (catalog.data?.dispositions ?? []).map((d) => ({
      id: d.id, name: d.name, category: d.category ?? "neutral", calls: byDispo.get(d.id) ?? 0,
      subs: (catalog.data?.subs ?? []).filter((s) => s.disposition_id === d.id).map((s) => ({ name: s.name, calls: bySub.get(s.id) ?? 0 })),
    }));
  }, [dispoCounts.data, catalog.data]);

  const board = useMemo(() => {
    const by = new Map<string, { id: string; registrations: number; activations: number }>();
    for (const r of teamWeek.data ?? []) {
      const e = by.get(r.agent_id) ?? { id: r.agent_id, registrations: 0, activations: 0 };
      e.registrations += r.registrations; e.activations += r.activations;
      by.set(r.agent_id, e);
    }
    return [...by.values()].sort((a, b) => b.registrations + b.activations - (a.registrations + a.activations));
  }, [teamWeek.data]);

  if (latestLoading || !userId) return <LoadingState message="Loading your dashboard..." />;

  const status = attendance.data?.status;
  const attLabel = status === "present" ? "Present" : status === "half_day" ? "Half day" : status === "absent" ? "Absent" : "No record";
  const week = (weekStats.data ?? []).slice().sort((a, b) => a.day.localeCompare(b.day));
  const weekLabels = week.map((r) => format(parseISO(r.day), "EEE d"));
  const boardNames = board.map((b) => (b.id === userId ? "You" : (callers.find((c) => c.id === b.id)?.name ?? "Caller").split(" ")[0]));

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
        <TargetTile label="Dialled" value={today.calls} target={DAILY_TARGETS.calls} color={SERIES.dialled} />
        <TargetTile label="Clean calls" value={today.clean_calls} target={DAILY_TARGETS.clean} color={SERIES.clean} />
        <TargetTile label="Registrations" value={today.registrations} target={DAILY_TARGETS.registrations} color={SERIES.registrations} />
        <TargetTile label="Activations" value={today.activations} target={DAILY_TARGETS.activations} color={SERIES.activations} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="New dials" value={today.new_dials} hint="first-ever calls to a lead" color={SERIES.newDials} />
        <Tile label="Connected" value={today.connected_calls} hint={`${pct(today.connected_calls, today.calls)}% of your calls`} color={SERIES.connected} />
        <Tile label="Clean calls" value={`${pct(today.clean_calls, today.calls)}%`} hint="of your calls ran a minute or more" color={SERIES.clean} />
        <Tile label="Registrations" value={`${pct(today.registrations, today.clean_calls)}%`} hint="of your clean calls" color={SERIES.registrations} />
        <Tile label="Activations" value={`${pct(today.activations, today.registrations)}%`} hint="of your registrations" color={SERIES.activations} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Calls through the day" note="Dialled, connected and clean calls per hour">
          <EChart option={groupedBarsOption(HOURS.map((h) => `${h}:00`), [
            { name: "Dialled", color: SERIES.dialled, data: HOURS.map((h) => hourly.data?.get(h)?.calls ?? 0) },
            { name: "Connected", color: SERIES.connected, data: HOURS.map((h) => hourly.data?.get(h)?.connected ?? 0) },
            { name: "Clean", color: SERIES.clean, data: HOURS.map((h) => hourly.data?.get(h)?.clean ?? 0) },
          ])} />
        </ChartCard>
        <ChartCard title="My funnel today">
          <EChart option={funnelOption([
            { name: "Calls dialled", value: today.calls, note: "" },
            { name: "Clean calls", value: today.clean_calls, note: `${pct(today.clean_calls, today.calls)}% of calls` },
            { name: "Registrations", value: today.registrations, note: `${pct(today.registrations, today.clean_calls)}% of clean` },
            { name: "Activations", value: today.activations, note: `${pct(today.activations, today.registrations)}% of registered` },
          ])} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ChartCard title="How my calls ended" note="Each block is a disposition, split into its sub-dispositions; size is the number of calls" height={320}>
            <EChart option={dispoTreemapOption(dispoNodes)} />
          </ChartCard>
        </div>
        <div className="lg:col-span-2">
          <Card className="h-full p-4">
            <h2 className="text-sm font-semibold text-foreground">Callbacks waiting for you</h2>
            {(callbacks.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No callbacks scheduled.</p>
            ) : (
              <ul className="mt-3 space-y-2">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="My last 7 days" note="Dialled, connected and clean calls; the dashed line is the daily dialling target">
          <EChart option={groupedBarsOption(weekLabels, [
            { name: "Dialled", color: SERIES.dialled, data: week.map((r) => r.calls) },
            { name: "Connected", color: SERIES.connected, data: week.map((r) => r.connected_calls) },
            { name: "Clean", color: SERIES.clean, data: week.map((r) => r.clean_calls) },
          ], "", DAILY_TARGETS.calls)} />
        </ChartCard>
        <ChartCard title="Registrations and activations, last 7 days">
          <EChart option={linesOption(weekLabels, [
            { name: "Registrations", color: SERIES.registrations, data: week.map((r) => r.registrations) },
            { name: "Activations", color: SERIES.activations, data: week.map((r) => r.activations) },
          ])} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Team this week" note="Registrations and activations; you are the bar labelled “You”">
          <EChart option={stackedBarsOption(boardNames, [
            { name: "Registrations", color: SERIES.registrations, data: board.map((b) => b.registrations) },
            { name: "Activations", color: SERIES.activations, data: board.map((b) => b.activations) },
          ])} />
        </ChartCard>
        <ChartCard title="My leads by stage" note="Every lead assigned to you">
          <EChart option={rankedBarsOption((myLeads.data ?? []).map((s) => ({ name: s.name, value: s.count, color: s.color ?? VIZ.blue })), "", 90)} />
        </ChartCard>
      </div>
    </div>
  );
}
