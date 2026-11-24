import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, format, getDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState } from "@/components/common/LoadingState";
import { useUrlState } from "@/hooks/useUrlState";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { usePhoneAppStatus, useTeamPhones, type TeamPhone } from "@/hooks/usePhoneApp";
import { PhoneCallTiles } from "@/components/PhoneApp/PhoneCallTiles";
import { CallerDayReport, type DayAttendance } from "./CallerDayReport";
import { CallsByDateHour } from "./CallsByDateHour";
import { CELL, Fig, NUM, Person, ROW, StatusChip, TH, TableCard, type Tone } from "./GamingTable";
import { CallsOverTime } from "./CallsOverTime";
import {
  pct, sumStats, useCallers, useDayOutcomes, useDayStats, useDispoCounts, useDispositionCatalog, useHourlyCounts, useLatestCallDay,
} from "./gamingStats";

// Status colours live only on small chips and the group-row edge; they name a state, never a measure.
const CATEGORY_TONE: Record<string, Tone> = { positive: "good", follow_up: "warn", negative: "bad", neutral: "neutral" };
const CATEGORY_BORDER: Record<string, string> = {
  positive: "border-l-4 border-l-emerald-400", follow_up: "border-l-4 border-l-amber-400", negative: "border-l-4 border-l-rose-400", neutral: "border-l-4 border-l-slate-300",
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

function isWorkingDay(d: Date): boolean {
  const dow = getDay(d);
  if (dow === 0) return false;
  if (dow === 6) {
    const week = Math.ceil(d.getDate() / 7);
    return week !== 2 && week !== 4;
  }
  return true;
}

/** A phone is silent when it has not checked in for at least one full working day. */
function phoneState(p: TeamPhone | undefined): { tone: Tone; label: string; silent: boolean } {
  if (!p) return { tone: "bad", label: "App not installed", silent: true };
  if (p.connected) return { tone: "good", label: "Connected now", silent: false };
  if (!p.call_log_allowed) return { tone: "bad", label: "Call history permission off", silent: true };
  if (!p.last_seen_at) return { tone: "bad", label: "Never checked in", silent: true };
  const last = new Date(p.last_seen_at);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(last); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  let missed = 0;
  for (; d < today; d.setDate(d.getDate() + 1)) if (isWorkingDay(d)) missed++;
  return missed >= 1 ? { tone: "bad", label: `Silent for ${missed} working day${missed > 1 ? "s" : ""}`, silent: true } : { tone: "neutral", label: "Checked in today or last working day", silent: false };
}

export function GamingManagerDashboard({ orgId }: { orgId: string }) {
  const { canAccessFeature } = useFeatureAccess();
  const showAttendance = canAccessFeature("attendance");
  const { data: phoneApp } = usePhoneAppStatus();
  const usesPhoneApp = !!phoneApp?.enabled;
  const teamPhones = useTeamPhones(usesPhoneApp);
  const { data: latest, isLoading: latestLoading } = useLatestCallDay(orgId);
  const [fromParam, setFromParam] = useUrlState("from", "");
  const [toParam, setToParam] = useUrlState("to", "");

  const lastDay = toParam || latest || format(new Date(), "yyyy-MM-dd");
  const firstDay = fromParam || format(addDays(parseISO(lastDay), -13), "yyyy-MM-dd");
  // Dates picked the wrong way round are read as the same range.
  const [from, to] = firstDay <= lastDay ? [firstDay, lastDay] : [lastDay, firstDay];

  const { data: callers = [], isSuccess: callersLoaded } = useCallers(orgId);
  const rangeStats = useDayStats(orgId, from, to);
  const dayOutcomes = useDayOutcomes(orgId, from, to);
  const hourly = useHourlyCounts(orgId, from, to);
  const dispoCounts = useDispoCounts(orgId, from, to);
  const catalog = useDispositionCatalog(orgId);

  const attendance = useQuery({
    queryKey: ["gaming-attendance", orgId, from, to],
    queryFn: async (): Promise<DayAttendance[]> => {
      const { data } = await supabase
        .from("attendance_records")
        .select("user_id, date, sign_in_time, sign_out_time, total_hours")
        .eq("org_id", orgId).gte("date", from).lte("date", to);
      return (data ?? []) as DayAttendance[];
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

  if (latestLoading) return <LoadingState message="Loading dashboard..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Calling Manager Dashboard</h1>
          <p className="mt-1 max-w-3xl text-base text-foreground">
            Callers saved {rangeTotals.calls.toLocaleString("en-IN")} call outcomes in these dates. The counts below are the outcomes exactly as callers picked them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="gaming-from" className="text-sm text-muted-foreground">From</label>
          <Input id="gaming-from" type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFromParam(e.target.value)} />
          <label htmlFor="gaming-to" className="text-sm text-muted-foreground">To</label>
          <Input id="gaming-to" type="date" className="w-40" value={to} onChange={(e) => e.target.value && setToParam(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-2">
        <Tile label="Calls (outcomes saved)" value={rangeTotals.calls.toLocaleString("en-IN")} />
        <Tile label="New dials" value={rangeTotals.new_dials.toLocaleString("en-IN")} hint="first-ever call to a lead" />
      </div>
      {(stages.data ?? []).length > 0 && (
        <p className="text-xs text-muted-foreground">Leads by stage: {(stages.data ?? []).map((s) => `${s.name} ${s.count.toLocaleString("en-IN")}`).join(" · ")}</p>
      )}

      {usesPhoneApp && <PhoneCallTiles totals={rangeTotals} />}

      <CallsOverTime rows={rangeStats.data ?? []} />

      <CallsByDateHour measures={usesPhoneApp ? ["calls", "new_dials", "phone_calls", "connected_calls"] : ["calls", "new_dials"]} rows={hourly.data ?? []} />

      {usesPhoneApp && (
        <TableCard
          title="Callers' phones"
          subtitle={`${callers.filter((c) => phoneState((teamPhones.data ?? []).find((p) => p.user_id === c.id)).silent).length} of ${callers.length} phones are not reporting calls. A phone is flagged when the In-Sync Phone app has not checked in for a full working day.`}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent"><TH>Caller</TH><TH>Phone</TH><TH>Status</TH><TH>Last checked in</TH><TH>Last calls sent</TH></TableRow>
            </TableHeader>
            <TableBody>
              {callers.map((c) => {
                const p = (teamPhones.data ?? []).find((x) => x.user_id === c.id);
                const st = phoneState(p);
                const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "—";
                return (
                  <TableRow key={c.id} className={ROW}>
                    <TableCell className={CELL}><Person name={c.name} /></TableCell>
                    <TableCell className={CELL}>{p?.device_name ?? "—"}</TableCell>
                    <TableCell className={CELL}><StatusChip tone={st.tone}>{st.label}</StatusChip></TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{when(p?.last_seen_at)}</TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{when(p?.last_sync_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}

        <CallerDayReport
          callers={callers}
          outcomes={dayOutcomes.data ?? []}
          stats={rangeStats.data ?? []}
          attendance={attendance.data ?? []}
          showAttendance={showAttendance}
          ready={callersLoaded && rangeStats.isSuccess && dayOutcomes.isSuccess && attendance.isSuccess}
          from={from}
          to={to}
          onFrom={setFromParam}
          onTo={setToParam}
        />

        <TableCard
          title="Call outcomes"
          subtitle={<>Each count is the number of outcomes callers saved in the chosen dates, per caller and in total. <Link to="/admin/call-dispositions" className="text-primary underline">Edit the list</Link></>}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TH>Disposition / sub-disposition</TH><TH right>Calls</TH><TH right>Share</TH>
                {callers.map((c) => <TH key={c.id} right>{c.name.split(" ")[0]}</TH>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispositions.flatMap((d) => {
                const cat = d.category ?? "neutral";
                return [
                  <TableRow key={d.id} className={`bg-muted/40 hover:bg-muted/60 ${CATEGORY_BORDER[cat] ?? CATEGORY_BORDER.neutral}`}>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{d.name}</span>
                        <StatusChip tone={CATEGORY_TONE[cat] ?? "neutral"}>{CATEGORY_LABEL[cat] ?? cat}</StatusChip>
                      </div>
                      {d.description && <p className="mt-0.5 text-xs text-muted-foreground">{d.description}</p>}
                    </TableCell>
                    <TableCell className={`${NUM} font-semibold`}><Fig v={byDispo.get(d.id) ?? 0} bold /></TableCell>
                    <TableCell className={`${NUM} font-semibold`}>{pct(byDispo.get(d.id) ?? 0, totalCalls)}%</TableCell>
                    {callers.map((c) => <TableCell key={c.id} className={`${NUM} font-semibold`}><Fig v={byCaller.get(`${d.id}|${c.id}`) ?? 0} bold /></TableCell>)}
                  </TableRow>,
                  ...subs.filter((s) => s.disposition_id === d.id).map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/40">
                      <TableCell className="py-2 pl-9 text-muted-foreground"><span className="mr-2 inline-block h-1 w-1 rounded-full bg-muted-foreground/60 align-middle" />{s.name}</TableCell>
                      <TableCell className={`${NUM} py-2`}><Fig v={bySub.get(s.id) ?? 0} /></TableCell>
                      <TableCell className={`${NUM} py-2 text-muted-foreground`}>{pct(bySub.get(s.id) ?? 0, totalCalls)}%</TableCell>
                      {callers.map((c) => <TableCell key={c.id} className={`${NUM} py-2`}><Fig v={byCaller.get(`s|${s.id}|${c.id}`) ?? 0} /></TableCell>)}
                    </TableRow>
                  )),
                ];
              })}
            </TableBody>
          </Table>
        </TableCard>
    </div>
  );
}
