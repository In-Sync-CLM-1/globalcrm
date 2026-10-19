import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState } from "@/components/common/LoadingState";
import { useUrlState } from "@/hooks/useUrlState";
import { CallsByDateHour } from "./CallsByDateHour";
import { DAILY_TARGETS, fmtClock, fmtHM, pct, sumStats, useCallers, useDayStats, useDispoCounts, useDispositionCatalog, useHourlyCounts, useLatestCallDay } from "./gamingStats";

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function GamingCallerDashboard({ orgId }: { orgId: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const { data: latest, isLoading: latestLoading } = useLatestCallDay(orgId, userId);
  const [dayParam, setDayParam] = useUrlState("day", "");
  const day = dayParam || latest || format(new Date(), "yyyy-MM-dd");
  const weekFrom = format(addDays(parseISO(day), -13), "yyyy-MM-dd");

  const { data: callers = [] } = useCallers(orgId);
  const me = callers.find((c) => c.id === userId);

  const dayStats = useDayStats(orgId, day, day, userId);
  const teamWeek = useDayStats(orgId, format(addDays(parseISO(day), -6), "yyyy-MM-dd"), day);
  const hourly = useHourlyCounts(orgId, weekFrom, day, userId);
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

  const callbacks = useQuery({
    queryKey: ["gaming-my-callbacks", userId],
    queryFn: async () => {
      const { data } = await supabase.from("contact_activities")
        .select("id, contact_id, subject, scheduled_at")
        .eq("org_id", orgId).eq("created_by", userId!).eq("activity_type", "call").is("completed_at", null)
        .order("scheduled_at", { ascending: true }).limit(8);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const today = sumStats(dayStats.data ?? []);
  const row = dayStats.data?.[0];

  const ended = useMemo(() => {
    const bySub = new Map<string, number>(); const byDispo = new Map<string, number>();
    for (const r of dispoCounts.data ?? []) {
      if (r.sub_disposition_id) bySub.set(r.sub_disposition_id, (bySub.get(r.sub_disposition_id) ?? 0) + r.calls);
      if (r.disposition_id) byDispo.set(r.disposition_id, (byDispo.get(r.disposition_id) ?? 0) + r.calls);
    }
    return (catalog.data?.dispositions ?? []).map((d) => ({
      id: d.id, name: d.name, total: byDispo.get(d.id) ?? 0,
      subs: (catalog.data?.subs ?? []).filter((s) => s.disposition_id === d.id).map((s) => ({ name: s.name, n: bySub.get(s.id) ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n),
    })).filter((x) => x.total > 0);
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
  const metTargets = [today.calls >= DAILY_TARGETS.calls, today.clean_calls >= DAILY_TARGETS.clean, today.registrations >= DAILY_TARGETS.registrations, today.activations >= DAILY_TARGETS.activations].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Hello{me ? `, ${me.name.split(" ")[0]}` : ""}</h1>
          <p className="mt-1 max-w-3xl text-base text-foreground">
            You dialled {today.calls} calls on {format(parseISO(day), "EEE d MMM")}: {pct(today.clean_calls, today.calls)}% were clean, {today.registrations} became registrations and {today.activations} activated.
            {" "}You met {metTargets} of 4 daily targets.
          </p>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Dialled" value={`${today.calls} / ${DAILY_TARGETS.calls}`} hint={today.calls >= DAILY_TARGETS.calls ? "target met" : `${DAILY_TARGETS.calls - today.calls} to go`} />
        <Tile label="New dials" value={today.new_dials} hint="first-ever call to a lead" />
        <Tile label="Connected" value={today.connected_calls} hint={`${pct(today.connected_calls, today.calls)}% of dialled`} />
        <Tile label="Clean calls" value={`${today.clean_calls} / ${DAILY_TARGETS.clean}`} hint={today.clean_calls >= DAILY_TARGETS.clean ? "target met" : `${DAILY_TARGETS.clean - today.clean_calls} to go`} />
        <Tile label="Registrations" value={`${today.registrations} / ${DAILY_TARGETS.registrations}`} hint={`${pct(today.registrations, today.clean_calls)}% of clean calls`} />
        <Tile label="Activations" value={`${today.activations} / ${DAILY_TARGETS.activations}`} hint={`${pct(today.activations, today.registrations)}% of registrations`} />
      </div>

      <CallsByDateHour rows={hourly.data ?? []} note="Your calls, last 14 days." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground">How your calls ended on {format(parseISO(day), "d MMM")}</h2>
          {ended.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No calls on this day.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {ended.map((d) => (
                <div key={d.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-foreground">{d.name}</span>
                    <span className="tabular-nums text-foreground">{d.total} <span className="text-xs text-muted-foreground">({pct(d.total, today.calls)}%)</span></span>
                  </div>
                  {d.subs.length > 0 && <p className="text-xs text-muted-foreground">{d.subs.map((x) => `${x.name} ${x.n}`).join(" · ")}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
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
          <Card className="overflow-x-auto">
            <h2 className="p-4 pb-0 text-sm font-semibold text-foreground">Team, last 7 days</h2>
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Caller</TableHead><TableHead className="text-right">Registrations</TableHead><TableHead className="text-right">Activations</TableHead></TableRow></TableHeader>
              <TableBody>
                {board.map((b, i) => {
                  const name = callers.find((c) => c.id === b.id)?.name.split(" ")[0] ?? "Caller";
                  return (
                    <TableRow key={b.id} className={b.id === userId ? "bg-muted/60 font-semibold" : ""}>
                      <TableCell>{i + 1}</TableCell><TableCell>{b.id === userId ? `${name} (you)` : name}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.registrations}</TableCell><TableCell className="text-right tabular-nums">{b.activations}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
