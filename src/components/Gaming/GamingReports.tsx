import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import {
  ArrowLeft, CalendarDays, ChevronRight, Clock, Download, FileText, Headphones, Layers, ListChecks, PhoneMissed, Smartphone, TrendingUp, Trophy, UserCheck, Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useDialixaStatus } from "@/hooks/useDialixa";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useGamingAccess } from "@/hooks/useGamingAccess";
import { useNotification } from "@/hooks/useNotification";
import { usePhoneAppStatus, useTeamPhones, type TeamPhone } from "@/hooks/usePhoneApp";
import { useUrlState } from "@/hooks/useUrlState";
import { useUserRole } from "@/hooks/useUserRole";
import { exportToCSV, type ExportColumn } from "@/utils/exportUtils";
import { CallerDayReport, type DayAttendance } from "./CallerDayReport";
import { CallsByDateHour } from "./CallsByDateHour";
import { CallsOverTime } from "./CallsOverTime";
import { DialixaCallReport } from "./DialixaCallReport";
import { CELL, Fig, NUM, Person, ROW, StatusChip, TH, TableCard, type Tone } from "./GamingTable";
import {
  fmtClock, fmtHM, pct, sumOutcomes, sumStats, useCallersWithHistory, useDayOutcomes, useDayStats, useDispoCounts, useDispositionCatalog, useHourlyCounts,
  type CallerWithHistory,
} from "./gamingStats";

const PAGE = 25;
const CATEGORY_TONE: Record<string, Tone> = { positive: "good", follow_up: "warn", negative: "bad", neutral: "neutral" };
const n = (v: number) => v.toLocaleString("en-IN");
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "—";
const nextDay = (d: string) => format(addDays(parseISO(d), 1), "yyyy-MM-dd");

interface Ctx {
  orgId: string; from: string; to: string;
  /** null = everyone; a caller is always limited to their own id. */
  agent: string | null;
  manager: boolean; canExport: boolean; callers: CallerWithHistory[];
}

interface ReportDef {
  key: string; group: "Call reports" | "Caller reports" | "Outcome reports"; title: string; about: string; icon: LucideIcon;
  who?: "manager" | "caller"; dates?: boolean; callerFilter?: boolean;
}

const REPORTS: ReportDef[] = [
  { key: "calls", group: "Call reports", title: "Call detail", about: "Every call, with its outcome", icon: FileText, dates: true, callerFilter: true },
  { key: "not-connected", group: "Call reports", title: "Not-connected calls", about: "Calls that did not reach the player", icon: PhoneMissed, dates: true, callerFilter: true },
  { key: "peak-hours", group: "Call reports", title: "Peak hours", about: "Calls by hour and by date", icon: TrendingUp, dates: true, callerFilter: true },
  { key: "players", group: "Call reports", title: "New and returning players", about: "Players called once, and again", icon: Users, dates: true, callerFilter: true },
  { key: "dialixa", group: "Call reports", title: "Dialixa calls and talk time", about: "Calls as Dialixa recorded them", icon: Headphones, who: "manager", dates: true },
  { key: "productivity", group: "Caller reports", title: "Caller productivity", about: "Calls, results and talk time", icon: UserCheck, dates: true, callerFilter: true },
  { key: "day-wise", group: "Caller reports", title: "Day-wise calling", about: "Each caller, day by day", icon: CalendarDays },
  { key: "attendance", group: "Caller reports", title: "Attendance and hours", about: "Start, end and hours", icon: Clock, dates: true, callerFilter: true },
  { key: "phones", group: "Caller reports", title: "Callers' phones", about: "Which phones are reporting calls", icon: Smartphone, who: "manager" },
  { key: "team", group: "Caller reports", title: "Team ranking", about: "Calls by caller in the dates chosen", icon: Trophy, who: "caller", dates: true },
  { key: "outcomes", group: "Outcome reports", title: "Outcomes by caller", about: "How each call ended", icon: ListChecks, dates: true, callerFilter: true },
  { key: "stages", group: "Outcome reports", title: "Leads by stage", about: "Where the players stand now", icon: Layers },
];

function ExportButton({ rows, columns, name, show, disabled }: { rows: () => Promise<Record<string, unknown>[]> | Record<string, unknown>[]; columns: ExportColumn[]; name: string; show: boolean; disabled?: boolean }) {
  const notify = useNotification();
  const [busy, setBusy] = useState(false);
  if (!show) return null;
  return (
    <Button variant="outline" size="sm" className="h-9" disabled={busy || disabled} onClick={async () => {
      setBusy(true);
      try { exportToCSV(await rows(), columns, name); } catch (e) { notify.error("Nothing exported", e as Error); }
      setBusy(false);
    }}>
      <Download className="mr-2 h-4 w-4" />{busy ? "Exporting…" : "Export CSV"}
    </Button>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
      <span>Page {page + 1} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

const Empty = ({ cols, text }: { cols: number; text: string }) => (
  <TableRow><TableCell colSpan={cols} className="py-10 text-center text-sm text-muted-foreground">{text}</TableCell></TableRow>
);

/* ------------------------------------------------------------------ call detail, not connected */

interface CallRow {
  id: string; started_at: string | null; agent_id: string | null; direction: string | null; status: string | null; conversation_duration: number | null; contact_id: string | null;
  contacts: { first_name: string | null; last_name: string | null } | null;
  call_dispositions: { name: string; category: string | null } | null; call_sub_dispositions: { name: string } | null;
}

function CallsReport({ c, missed }: { c: Ctx; missed?: boolean }) {
  const { data: catalog } = useDispositionCatalog(c.orgId);
  const [dispo, setDispo] = useUrlState("dispo", "all");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [c.from, c.to, c.agent, dispo]);
  const nameOf = useMemo(() => Object.fromEntries(c.callers.map((x) => [x.id, x.name])), [c.callers]);

  const run = async (first: number, last: number) => {
    let q = supabase.from("call_logs")
      .select("id, started_at, agent_id, direction, status, conversation_duration, contact_id, contacts:contact_id(first_name, last_name), call_dispositions:disposition_id(name, category), call_sub_dispositions:sub_disposition_id(name)", { count: "exact" })
      .eq("org_id", c.orgId).eq("caller_type", "human")
      .gte("started_at", `${c.from}T00:00:00+05:30`).lt("started_at", `${nextDay(c.to)}T00:00:00+05:30`)
      .order("started_at", { ascending: false }).order("id").range(first, last);
    if (c.agent) q = q.eq("agent_id", c.agent);
    if (missed) {
      const off = (catalog?.dispositions ?? []).filter((d) => d.name === "Unreachable" || d.name === "Not Connected").map((d) => d.id);
      const invalid = (catalog?.subs ?? []).filter((s) => s.name === "Invalid Number" && catalog?.dispositions.some((d) => d.id === s.disposition_id && d.name === "Wrong Contact")).map((s) => s.id);
      const parts = ["and(disposition_id.is.null,status.in.(no-answer,missed,failed,rejected))"];
      if (off.length) parts.push(`disposition_id.in.(${off.join(",")})`);
      if (invalid.length) parts.push(`sub_disposition_id.in.(${invalid.join(",")})`);
      q = q.or(parts.join(","));
    } else if (/^[0-9a-f-]{36}$/i.test(dispo)) q = q.eq("disposition_id", dispo);
    const { data, count, error } = await q;
    if (error) throw error;
    return { rows: (data ?? []) as unknown as CallRow[], count: count ?? 0 };
  };
  const list = useQuery({
    queryKey: ["gaming-report-calls", c.orgId, c.from, c.to, c.agent, dispo, !!missed, page],
    queryFn: () => run(page * PAGE, page * PAGE + PAGE - 1),
    enabled: !!catalog,
  });
  const player = (r: CallRow) => (r.contacts ? `${r.contacts.first_name ?? ""} ${r.contacts.last_name ?? ""}`.trim() : "") || "Unknown player";
  const exportRows = async () => {
    const out: CallRow[] = [];
    for (let i = 0; i < 100; i++) {
      const { rows, count } = await run(i * 1000, i * 1000 + 999);
      out.push(...rows);
      if (!rows.length || out.length >= count) break;
    }
    return out.map((r) => ({ at: when(r.started_at), caller: nameOf[r.agent_id ?? ""] ?? "", player: player(r), direction: r.direction === "inbound" ? "Incoming" : "Outgoing", outcome: r.call_dispositions?.name ?? "", sub: r.call_sub_dispositions?.name ?? "", talk: r.conversation_duration ? clock(r.conversation_duration) : "" }));
  };
  const count = list.data?.count ?? 0;

  return (
    <TableCard title={`${n(count)} calls`} action={
      <div className="flex flex-wrap items-center gap-2">
        {!missed && (
          <Select value={dispo} onValueChange={setDispo}>
            <SelectTrigger className="h-9 w-44" aria-label="Outcome"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All outcomes</SelectItem>{(catalog?.dispositions ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <ExportButton show={c.canExport} rows={exportRows} disabled={!count} name={`${missed ? "not-connected-calls" : "call-detail"}-${c.from}-to-${c.to}`}
          columns={[{ key: "at", label: "Date and time" }, { key: "caller", label: "Caller" }, { key: "player", label: "Player" }, { key: "direction", label: "Direction" }, { key: "outcome", label: "Outcome" }, { key: "sub", label: "Sub-option" }, { key: "talk", label: "Talk time" }]} />
      </div>
    }>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH>When</TH><TH>Caller</TH><TH>Player</TH><TH>Direction</TH><TH>Outcome</TH><TH>Sub-option</TH><TH right>Talk time</TH></TableRow></TableHeader>
        <TableBody>
          {(list.data?.rows ?? []).map((r) => (
            <TableRow key={r.id} className={ROW}>
              <TableCell className={`${CELL} whitespace-nowrap`}>{when(r.started_at)}</TableCell>
              <TableCell className={CELL}>{nameOf[r.agent_id ?? ""] ?? "Others"}</TableCell>
              <TableCell className={CELL}>{r.contact_id ? <Link className="text-primary underline" to={`/contacts/${r.contact_id}`}>{player(r)}</Link> : player(r)}</TableCell>
              <TableCell className={CELL}>{r.direction === "inbound" ? "Incoming" : "Outgoing"}</TableCell>
              <TableCell className={CELL}>{r.call_dispositions ? <StatusChip tone={CATEGORY_TONE[r.call_dispositions.category ?? "neutral"] ?? "neutral"}>{r.call_dispositions.name}</StatusChip> : <Fig v={0} />}</TableCell>
              <TableCell className={`${CELL} text-muted-foreground`}>{r.call_sub_dispositions?.name ?? ""}</TableCell>
              <TableCell className={NUM}>{r.conversation_duration ? clock(r.conversation_duration) : <Fig v={0} />}</TableCell>
            </TableRow>
          ))}
          {list.isSuccess && count === 0 && <Empty cols={7} text="No calls in these dates." />}
          {list.isLoading && <Empty cols={7} text="Loading…" />}
          {list.isError && <Empty cols={7} text="The calls could not be loaded." />}
        </TableBody>
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE))} onPage={setPage} />
    </TableCard>
  );
}

/* ------------------------------------------------------------------ peak hours */

function PeakHoursReport({ c }: { c: Ctx }) {
  const { data: phoneApp } = usePhoneAppStatus();
  const hourly = useHourlyCounts(c.orgId, c.from, c.to, c.agent);
  const stats = useDayStats(c.orgId, c.from, c.to, c.agent);
  const rows = useMemo(() => {
    const by = new Map<number, { calls: number; new_dials: number }>();
    for (const r of hourly.data ?? []) {
      const e = by.get(r.hour) ?? { calls: 0, new_dials: 0 };
      e.calls += r.calls; e.new_dials += r.new_dials;
      by.set(r.hour, e);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour: `${String(hour).padStart(2, "0")}:00 to ${String(hour).padStart(2, "0")}:59`, ...v }));
  }, [hourly.data]);
  const total = rows.reduce((t, r) => t + r.calls, 0);
  return (
    <div className="space-y-4">
      <TableCard title="Calls by hour" action={<ExportButton show={c.canExport} disabled={!rows.length} rows={() => rows.map((r) => ({ ...r, share: `${pct(r.calls, total)}%` }))} name={`peak-hours-${c.from}-to-${c.to}`}
        columns={[{ key: "hour", label: "Hour" }, { key: "calls", label: "Calls" }, { key: "new_dials", label: "New dials" }, { key: "share", label: "Share" }]} />}>
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TH>Hour</TH><TH right>Calls</TH><TH right>New dials</TH><TH right>Share</TH></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.hour} className={ROW}>
                <TableCell className={`${CELL} tabular-nums`}>{r.hour}</TableCell><TableCell className={NUM}><Fig v={r.calls} bold /></TableCell>
                <TableCell className={NUM}><Fig v={r.new_dials} /></TableCell><TableCell className={NUM}>{pct(r.calls, total)}%</TableCell>
              </TableRow>
            ))}
            {hourly.isSuccess && rows.length === 0 && <Empty cols={4} text="No calls in these dates." />}
          </TableBody>
        </Table>
      </TableCard>
      <CallsOverTime rows={stats.data ?? []} />
      <CallsByDateHour measures={phoneApp?.enabled ? ["calls", "new_dials", "phone_calls", "connected_calls"] : ["calls", "new_dials"]} rows={hourly.data ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------ new and returning players */

interface PlayerRow { contact_id: string; name: string; first_in: string; last_in: string; calls: number; type: "new" | "returning" }

function PlayersReport({ c }: { c: Ctx }) {
  const [type, setType] = useUrlState("ptype", "all");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [c.from, c.to, c.agent, type]);
  const run = async (limit: number, offset: number) => {
    const { data, error } = await supabase.rpc("ajimos_player_calls" as never, { _from: c.from, _to: c.to, _agent: c.agent, _type: type === "all" ? null : type, _limit: limit, _offset: offset } as never);
    if (error) throw error;
    return data as unknown as { new: number; returning: number; rows: PlayerRow[] };
  };
  const list = useQuery({ queryKey: ["gaming-report-players", c.from, c.to, c.agent, type, page], queryFn: () => run(PAGE, page * PAGE) });
  const d = list.data;
  const count = type === "new" ? d?.new ?? 0 : type === "returning" ? d?.returning ?? 0 : (d?.new ?? 0) + (d?.returning ?? 0);
  return (
    <TableCard title={`${n(d?.new ?? 0)} new, ${n(d?.returning ?? 0)} returning`} subtitle="New = called once, for the first time, in these dates. Returning = called before, or more than once." action={
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 w-40" aria-label="Player type"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All players</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="returning">Returning</SelectItem></SelectContent>
        </Select>
        <ExportButton show={c.canExport} disabled={!count} name={`players-${c.from}-to-${c.to}`} rows={async () => {
          const out: PlayerRow[] = [];
          while (out.length < count) { const r = (await run(5000, out.length)).rows; if (!r.length) break; out.push(...r); }
          return out.map((r) => ({ name: r.name, first: when(r.first_in), last: when(r.last_in), calls: r.calls, type: r.type === "new" ? "New" : "Returning" }));
        }} columns={[{ key: "name", label: "Player" }, { key: "first", label: "First call in these dates" }, { key: "last", label: "Last call" }, { key: "calls", label: "Calls" }, { key: "type", label: "Type" }]} />
      </div>
    }>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH>Player</TH><TH>First call in these dates</TH><TH>Last call</TH><TH right>Calls</TH><TH>Type</TH></TableRow></TableHeader>
        <TableBody>
          {(d?.rows ?? []).map((r) => (
            <TableRow key={r.contact_id} className={ROW}>
              <TableCell className={CELL}><Link className="text-primary underline" to={`/contacts/${r.contact_id}`}>{r.name || "Unknown player"}</Link></TableCell>
              <TableCell className={CELL}>{when(r.first_in)}</TableCell><TableCell className={CELL}>{when(r.last_in)}</TableCell>
              <TableCell className={NUM}><Fig v={r.calls} bold /></TableCell>
              <TableCell className={CELL}><StatusChip tone={r.type === "new" ? "good" : "neutral"}>{r.type === "new" ? "New" : "Returning"}</StatusChip></TableCell>
            </TableRow>
          ))}
          {list.isSuccess && count === 0 && <Empty cols={5} text="No players called in these dates." />}
          {list.isError && <Empty cols={5} text="The players could not be loaded." />}
        </TableBody>
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE))} onPage={setPage} />
    </TableCard>
  );
}

/* ------------------------------------------------------------------ caller reports */

function useAttendance(c: Ctx, enabled: boolean) {
  return useQuery({
    queryKey: ["gaming-attendance", c.orgId, c.from, c.to, c.agent],
    queryFn: async (): Promise<DayAttendance[]> => {
      let q = supabase.from("attendance_records").select("user_id, date, sign_in_time, sign_out_time, total_hours").eq("org_id", c.orgId).gte("date", c.from).lte("date", c.to);
      if (c.agent) q = q.eq("user_id", c.agent);
      const { data } = await q;
      return (data ?? []) as DayAttendance[];
    },
    enabled,
  });
}

function ProductivityReport({ c }: { c: Ctx }) {
  const { canAccessFeature } = useFeatureAccess();
  const showHours = canAccessFeature("attendance");
  const outcomes = useDayOutcomes(c.orgId, c.from, c.to);
  const stats = useDayStats(c.orgId, c.from, c.to, c.agent);
  const att = useAttendance(c, showHours);
  const rows = c.callers.filter((x) => !c.agent || x.id === c.agent).map((x) => {
    const o = sumOutcomes((outcomes.data ?? []).filter((r) => r.agent_id === x.id));
    const s = sumStats((stats.data ?? []).filter((r) => r.agent_id === x.id));
    const hours = (att.data ?? []).filter((r) => r.user_id === x.id).reduce((t, r) => t + (r.total_hours ?? 0) * 3600, 0);
    return { id: x.id, active: x.active, caller: x.name, total: o.total, connected: o.connected, rate: `${pct(o.connected, o.total)}%`, new_dials: s.new_dials, interested: o.interested, registered: o.registered, activated: o.activated, phone_calls: s.phone_calls, answered: s.connected_calls, clean: s.clean_calls, talk: s.talk_secs ? fmtHM(s.talk_secs) : "", hours: hours ? fmtHM(hours) : "" };
  }).filter((r) => r.active || r.total > 0).sort((a, b) => b.total - a.total);
  const reported = rows.some((r) => r.phone_calls > 0);
  const cols: ExportColumn[] = [
    { key: "caller", label: "Caller" }, { key: "total", label: "Calls" }, { key: "connected", label: "Connected" }, { key: "rate", label: "Connected %" }, { key: "new_dials", label: "New dials" },
    { key: "interested", label: "Interested" }, { key: "registered", label: "Registered" }, { key: "activated", label: "Activated" },
    // Only once the phone app or Dialixa has reported a call in these dates.
    ...(reported ? [{ key: "phone_calls", label: "Phone calls" }, { key: "answered", label: "Answered" }, { key: "clean", label: "Clean" }, { key: "talk", label: "Talk time" }] : []),
    ...(showHours ? [{ key: "hours", label: "Hours" }] : []),
  ];
  return (
    <TableCard title="Caller productivity" subtitle={`Counted from the outcomes saved.${reported ? " Phone calls, Answered, Clean (1 minute or longer) and Talk time come from calls the phone app or Dialixa reported." : ""}`}
      action={<ExportButton show={c.canExport} disabled={!rows.length} rows={() => rows} columns={cols} name={`caller-productivity-${c.from}-to-${c.to}`} />}>
      <Table className="[&_td:not(:first-child)]:px-2 [&_th:not(:first-child)]:px-2">
        <TableHeader><TableRow className="hover:bg-transparent">{cols.map((k, i) => <TH key={k.key} right={i > 0}>{k.label}</TH>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className={ROW}>
              <TableCell className={CELL}><Person name={r.caller} /></TableCell>
              {cols.slice(1).map((k) => <TableCell key={k.key} className={NUM}><Fig v={(r as Record<string, unknown>)[k.key] as number | string} bold={k.key === "total"} /></TableCell>)}
            </TableRow>
          ))}
          {outcomes.isSuccess && rows.length === 0 && <Empty cols={cols.length} text="No callers to show." />}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function DayWiseReport({ c, onFrom, onTo }: { c: Ctx; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { canAccessFeature } = useFeatureAccess();
  const showAttendance = canAccessFeature("attendance");
  const outcomes = useDayOutcomes(c.orgId, c.from, c.to);
  const stats = useDayStats(c.orgId, c.from, c.to, c.agent);
  const att = useAttendance(c, true);
  const callers = c.callers.filter((x) => (!c.agent || x.id === c.agent) && (x.active || (outcomes.data ?? []).some((o) => o.agent_id === x.id)));
  return (
    <CallerDayReport callers={callers} outcomes={outcomes.data ?? []} stats={stats.data ?? []} attendance={att.data ?? []} showAttendance={showAttendance}
      ready={outcomes.isSuccess && stats.isSuccess && att.isSuccess} canExport={c.manager} from={c.from} to={c.to} onFrom={onFrom} onTo={onTo} />
  );
}

function AttendanceReport({ c }: { c: Ctx }) {
  const att = useAttendance(c, true);
  const nameOf = Object.fromEntries(c.callers.map((x) => [x.id, x.name]));
  const rows = (att.data ?? []).filter((r) => nameOf[r.user_id]).sort((a, b) => b.date.localeCompare(a.date) || nameOf[a.user_id].localeCompare(nameOf[b.user_id]))
    .map((r) => ({ key: r.user_id + r.date, caller: nameOf[r.user_id], date: r.date, start: r.sign_in_time ? fmtClock(r.sign_in_time) : "", end: r.sign_out_time ? fmtClock(r.sign_out_time) : "", hours: r.total_hours ? fmtHM(r.total_hours * 3600) : "" }));
  return (
    <TableCard title="Attendance and hours" action={<ExportButton show={c.canExport} disabled={!rows.length} rows={() => rows} name={`attendance-${c.from}-to-${c.to}`}
      columns={[{ key: "caller", label: "Caller" }, { key: "date", label: "Date" }, { key: "start", label: "Start" }, { key: "end", label: "End" }, { key: "hours", label: "Hours" }]} />}>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH>Date</TH><TH>Caller</TH><TH>Start</TH><TH>End</TH><TH right>Hours</TH></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} className={ROW}>
              <TableCell className={CELL}>{format(parseISO(r.date), "EEE d MMM")}</TableCell><TableCell className={CELL}><Person name={r.caller} /></TableCell>
              <TableCell className={`${CELL} tabular-nums`}>{r.start || "—"}</TableCell><TableCell className={`${CELL} tabular-nums`}>{r.end || "—"}</TableCell><TableCell className={NUM}><Fig v={r.hours} /></TableCell>
            </TableRow>
          ))}
          {att.isSuccess && rows.length === 0 && <Empty cols={5} text="No attendance in these dates." />}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function isWorkingDay(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0) return false;
  if (dow === 6) { const week = Math.ceil(d.getDate() / 7); return week !== 2 && week !== 4; }
  return true;
}

/** A phone is silent when it has not checked in for at least one full working day. */
function phoneState(p: TeamPhone | undefined): { tone: Tone; label: string; silent: boolean } {
  if (!p) return { tone: "bad", label: "App not installed", silent: true };
  if (p.connected) return { tone: "good", label: "Connected now", silent: false };
  if (!p.call_log_allowed) return { tone: "bad", label: "Call history permission off", silent: true };
  if (!p.last_seen_at) return { tone: "bad", label: "Never checked in", silent: true };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(p.last_seen_at); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  let missed = 0;
  for (; d < today; d.setDate(d.getDate() + 1)) if (isWorkingDay(d)) missed++;
  return missed >= 1 ? { tone: "bad", label: `Silent for ${missed} working day${missed > 1 ? "s" : ""}`, silent: true } : { tone: "neutral", label: "Checked in today or last working day", silent: false };
}

function PhonesReport({ c }: { c: Ctx }) {
  const { data: phones } = useTeamPhones(true);
  const callers = c.callers.filter((x) => x.active);
  const of = (id: string) => (phones ?? []).find((p) => p.user_id === id);
  return (
    <TableCard title="Callers' phones" subtitle={`${callers.filter((x) => phoneState(of(x.id)).silent).length} of ${callers.length} phones are not reporting calls. A phone is flagged when the In-Sync Phone app has not checked in for a full working day.`}>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH>Caller</TH><TH>Phone</TH><TH>Status</TH><TH>Last checked in</TH><TH>Last calls sent</TH></TableRow></TableHeader>
        <TableBody>
          {callers.map((x) => {
            const p = of(x.id); const st = phoneState(p);
            return (
              <TableRow key={x.id} className={ROW}>
                <TableCell className={CELL}><Person name={x.name} /></TableCell><TableCell className={CELL}>{p?.device_name ?? "—"}</TableCell>
                <TableCell className={CELL}><StatusChip tone={st.tone}>{st.label}</StatusChip></TableCell>
                <TableCell className={`${CELL} tabular-nums`}>{when(p?.last_seen_at)}</TableCell><TableCell className={`${CELL} tabular-nums`}>{when(p?.last_sync_at)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function TeamReport({ c }: { c: Ctx }) {
  const outcomes = useDayOutcomes(c.orgId, c.from, c.to);
  const rows = c.callers.map((x) => ({ ...x, calls: sumOutcomes((outcomes.data ?? []).filter((r) => r.agent_id === x.id)).total })).filter((x) => x.active).sort((a, b) => b.calls - a.calls);
  return (
    <TableCard title="Team ranking" subtitle="Calls (outcomes saved)">
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH className="w-10">#</TH><TH>Caller</TH><TH right>Calls</TH></TableRow></TableHeader>
        <TableBody>{rows.map((r, i) => (
          <TableRow key={r.id} className={`${ROW} ${r.id === c.agent ? "bg-primary/5" : ""}`}>
            <TableCell className={`${CELL} tabular-nums text-muted-foreground`}>{i + 1}</TableCell><TableCell className={CELL}><Person name={r.name} sub={r.id === c.agent ? "You" : undefined} /></TableCell><TableCell className={NUM}><Fig v={r.calls} bold /></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </TableCard>
  );
}

/* ------------------------------------------------------------------ outcome reports */

function OutcomesReport({ c }: { c: Ctx }) {
  const counts = useDispoCounts(c.orgId, c.from, c.to, c.agent);
  const { data: catalog } = useDispositionCatalog(c.orgId);
  const callers = c.callers.filter((x) => (!c.agent || x.id === c.agent) && (x.active || (counts.data ?? []).some((r) => r.agent_id === x.id)));
  const sum = (f: (r: { agent_id: string; disposition_id: string | null; sub_disposition_id: string | null }) => boolean) => (counts.data ?? []).filter(f).reduce((t, r) => t + r.calls, 0);
  const lines = (catalog?.dispositions ?? []).flatMap((d) => [
    { key: d.id, sub: false, label: d.name, category: d.category, total: sum((r) => r.disposition_id === d.id), by: callers.map((x) => sum((r) => r.disposition_id === d.id && r.agent_id === x.id)) },
    ...(catalog?.subs ?? []).filter((s) => s.disposition_id === d.id).map((s) => ({ key: s.id, sub: true, label: s.name, category: null, total: sum((r) => r.sub_disposition_id === s.id), by: callers.map((x) => sum((r) => r.sub_disposition_id === s.id && r.agent_id === x.id)) })),
  ]);
  const total = lines.filter((l) => !l.sub).reduce((t, l) => t + l.total, 0);
  return (
    <TableCard title="Outcomes by caller" subtitle={c.manager ? <>Outcomes exactly as callers picked them. <Link to="/admin/call-dispositions" className="text-primary underline">Edit the list</Link></> : "Outcomes exactly as you picked them."}
      action={<ExportButton show={c.canExport} disabled={!lines.length} name={`outcomes-${c.from}-to-${c.to}`} rows={() => lines.map((l) => ({ label: l.sub ? `   ${l.label}` : l.label, total: l.total, share: `${pct(l.total, total)}%`, ...Object.fromEntries(callers.map((x, i) => [x.id, l.by[i]])) }))}
        columns={[{ key: "label", label: "Outcome" }, { key: "total", label: "Calls" }, { key: "share", label: "Share" }, ...callers.map((x) => ({ key: x.id, label: x.name }))]} />}>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH>Outcome</TH><TH right>Calls</TH><TH right>Share</TH>{callers.map((x) => <TH key={x.id} right>{x.name.split(" ")[0]}</TH>)}</TableRow></TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.key} className={l.sub ? "hover:bg-muted/40" : "bg-muted/40 font-semibold hover:bg-muted/60"}>
              <TableCell className={l.sub ? "py-2 pl-9 text-muted-foreground" : CELL}>{l.label}</TableCell>
              <TableCell className={NUM}><Fig v={l.total} /></TableCell><TableCell className={NUM}>{pct(l.total, total)}%</TableCell>
              {l.by.map((v, i) => <TableCell key={callers[i].id} className={NUM}><Fig v={v} /></TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

function StagesReport({ c }: { c: Ctx }) {
  const stages = useQuery({
    queryKey: ["gaming-stage-counts", c.orgId, c.manager ? "all" : c.agent],
    queryFn: async () => {
      const { data: st } = await supabase.from("pipeline_stages").select("id, name, stage_order").eq("org_id", c.orgId).order("stage_order");
      return Promise.all((st ?? []).map(async (s) => {
        let q = supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", c.orgId).eq("pipeline_stage_id", s.id);
        if (!c.manager && c.agent) q = q.eq("assigned_to", c.agent);
        return { id: s.id, name: s.name, count: (await q).count ?? 0 };
      }));
    },
  });
  const rows = stages.data ?? [];
  const total = rows.reduce((t, r) => t + r.count, 0);
  return (
    <TableCard title={`${n(total)} players`} action={<ExportButton show={c.canExport} disabled={!rows.length} rows={() => rows.map((r) => ({ ...r, share: `${pct(r.count, total)}%` }))} name="leads-by-stage" columns={[{ key: "name", label: "Stage" }, { key: "count", label: "Players" }, { key: "share", label: "Share" }]} />}>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TH>Stage</TH><TH right>Players</TH><TH right>Share</TH></TableRow></TableHeader>
        <TableBody>{rows.map((r) => <TableRow key={r.id} className={ROW}><TableCell className={CELL}>{r.name}</TableCell><TableCell className={NUM}><Fig v={r.count} bold /></TableCell><TableCell className={NUM}>{pct(r.count, total)}%</TableCell></TableRow>)}</TableBody>
      </Table>
    </TableCard>
  );
}

/* ------------------------------------------------------------------ the page */

/** Ajimos Reports: cards that each open one report. Callers see only their own figures. */
export default function GamingReports({ orgId }: { orgId: string }) {
  const { isAdmin, isSuperAdmin, isSalesManager, loading } = useUserRole();
  const gaming = useGamingAccess();
  const { data: dialixa } = useDialixaStatus();
  const { data: phoneApp } = usePhoneAppStatus();
  const { canAccessFeature } = useFeatureAccess();
  const manager = isAdmin || isSuperAdmin || isSalesManager;
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);
  const { data: callers = [] } = useCallersWithHistory(orgId);

  const [open, setOpen] = useUrlState("report", "", { push: true });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [fromParam, setFrom] = useUrlState("from", "");
  const [toParam, setTo] = useUrlState("to", "");
  const [caller, setCaller] = useUrlState("caller", "all");
  const last = toParam || today;
  const first = fromParam || format(addDays(parseISO(last), -6), "yyyy-MM-dd");
  const [from, to] = first <= last ? [first, last] : [last, first];

  const shown = REPORTS.filter((r) => (!r.who || (r.who === "manager") === manager)
    && (r.key !== "dialixa" || !!dialixa?.reports) && (r.key !== "phones" || !!phoneApp?.enabled) && (r.key !== "attendance" || canAccessFeature("attendance")));
  const def = shown.find((r) => r.key === open);

  if (loading || !userId) return <DashboardLayout><p className="p-6 text-sm text-muted-foreground">Loading reports…</p></DashboardLayout>;

  const agent = manager ? (def?.callerFilter && caller !== "all" ? caller : null) : userId;
  const c: Ctx = { orgId, from, to, agent, manager, canExport: gaming.canExport, callers };

  const body: Record<string, () => ReactNode> = {
    calls: () => <CallsReport c={c} />, "not-connected": () => <CallsReport c={c} missed />, "peak-hours": () => <PeakHoursReport c={c} />, players: () => <PlayersReport c={c} />,
    dialixa: () => <DialixaCallReport from={from} to={to} />, productivity: () => <ProductivityReport c={c} />, "day-wise": () => <DayWiseReport c={c} onFrom={setFrom} onTo={setTo} />,
    attendance: () => <AttendanceReport c={c} />, phones: () => <PhonesReport c={c} />, team: () => <TeamReport c={c} />, outcomes: () => <OutcomesReport c={c} />, stages: () => <StagesReport c={c} />,
  };

  return (
    <DashboardLayout>
      {def ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={() => setOpen("")} aria-label="Back to reports"><ArrowLeft className="h-4 w-4" /></Button>
              <div><p className="text-xs text-muted-foreground">Reports › {def.group}</p><h1 className="text-xl font-semibold text-foreground">{def.title}</h1></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {def.callerFilter && manager && (
                <Select value={caller} onValueChange={setCaller}>
                  <SelectTrigger className="h-9 w-48" aria-label="Caller"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All callers</SelectItem>{callers.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {def.dates && (
                <>
                  <Input aria-label="From" type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input aria-label="To" type="date" className="h-9 w-40" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
                </>
              )}
            </div>
          </div>
          {body[def.key]()}
        </div>
      ) : (
        <div className="space-y-6">
          <h1 className="text-xl font-semibold text-foreground">Reports</h1>
          {(["Call reports", "Caller reports", "Outcome reports"] as const).map((g) => (
            <section key={g} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {shown.filter((r) => r.group === g).map((r) => (
                  <button key={r.key} type="button" onClick={() => setOpen(r.key)} className="text-left">
                    <Card className="flex h-full items-center gap-4 rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><r.icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block font-medium text-foreground">{r.title}</span><span className="block text-xs text-muted-foreground">{r.about}</span></span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Card>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
