import { Fragment } from "react";
import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useUrlState } from "@/hooks/useUrlState";
import { CELL, Fig, NUM, Person, ROW, TH, TableCard } from "./GamingTable";
import { fmtClock, fmtHM, type Caller, type DayOutcomes, type DayStat } from "./gamingStats";

export interface DayAttendance { user_id: string; date: string; sign_in_time: string | null; sign_out_time: string | null; total_hours: number | null }

const MEASURES = [
  { key: "total", label: "Total" },
  { key: "new_dials", label: "New dials" },
  { key: "connected", label: "Connected" },
  { key: "interested", label: "Interested" },
  { key: "follow_up", label: "Follow-up" },
  { key: "registered", label: "Registered" },
  { key: "activated", label: "Activated" },
  { key: "not_interested", label: "Not interested" },
] as const;
type Figures = Record<(typeof MEASURES)[number]["key"], number>;
interface Line { day: string; figures: Figures; att?: DayAttendance }

const sumLines = (lines: Line[]): Figures =>
  Object.fromEntries(MEASURES.map((m) => [m.key, lines.reduce((t, l) => t + l.figures[m.key], 0)])) as Figures;
const attSecs = (lines: Line[]) => lines.reduce((t, l) => t + (l.att?.total_hours ?? 0) * 3600, 0);

/** Each caller's days in the chosen dates: attendance, then calls by the outcome the caller saved. */
export function CallerDayReport({ callers, outcomes, stats, attendance, showAttendance, from, to, onFrom, onTo }: {
  callers: Caller[]; outcomes: DayOutcomes[]; stats: DayStat[]; attendance: DayAttendance[]; showAttendance: boolean;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  const [callerParam, setCallerParam] = useUrlState("caller", "all");
  const shown = callers.filter((c) => callerParam === "all" || c.id === callerParam);

  const groups = shown.map((c) => {
    const mine = outcomes.filter((o) => o.agent_id === c.id);
    const att = showAttendance ? attendance.filter((a) => a.user_id === c.id) : [];
    const days = [...new Set([...mine.map((o) => o.day), ...att.map((a) => a.date)])].sort().reverse();
    const lines: Line[] = days.map((day) => {
      const o = mine.find((x) => x.day === day);
      const s = stats.find((x) => x.agent_id === c.id && x.day === day);
      return {
        day,
        att: att.find((a) => a.date === day),
        figures: {
          total: o?.total ?? 0, new_dials: s?.new_dials ?? 0, connected: o?.connected ?? 0, interested: o?.interested ?? 0,
          follow_up: o?.follow_up ?? 0, registered: o?.registered ?? 0, activated: o?.activated ?? 0, not_interested: o?.not_interested ?? 0,
        },
      };
    });
    return { caller: c, lines, totals: sumLines(lines) };
  });
  const all = groups.flatMap((g) => g.lines);
  const team = sumLines(all);

  const hours = (secs: number) => (secs > 0 ? fmtHM(secs) : <Fig v={0} />);
  const figureCells = (f: Figures, bold?: boolean) => MEASURES.map((m) => <TableCell key={m.key} className={NUM}><Fig v={f[m.key]} bold={bold} /></TableCell>);

  return (
    <TableCard
      title="Day-wise calling report"
      subtitle={`Counted from the outcomes callers saved. Connected = every outcome except Unreachable and Invalid Number. Registered = Registration Completed or ID Created. Activated = Deposit Completed.${showAttendance ? " Check-in, check-out and hours come from Attendance." : ""}`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={callerParam} onValueChange={setCallerParam}>
            <SelectTrigger className="h-9 w-48" aria-label="Caller"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All callers</SelectItem>
              {callers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <label htmlFor="report-from" className="text-sm text-muted-foreground">From</label>
          <Input id="report-from" type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && onFrom(e.target.value)} />
          <label htmlFor="report-to" className="text-sm text-muted-foreground">To</label>
          <Input id="report-to" type="date" className="h-9 w-40" value={to} min={from} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => e.target.value && onTo(e.target.value)} />
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TH>Caller / date</TH>
            {showAttendance && <><TH>Check-in</TH><TH>Check-out</TH><TH right>Hours</TH></>}
            {MEASURES.map((m) => <TH key={m.key} right>{m.label}</TH>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ caller, lines, totals }) => (
            <Fragment key={caller.id}>
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/60">
                <TableCell className={CELL}><Person name={caller.name} sub={lines.length ? undefined : "No calls in these dates"} /></TableCell>
                {showAttendance && <><TableCell /><TableCell /><TableCell className={NUM}>{hours(attSecs(lines))}</TableCell></>}
                {figureCells(totals, true)}
              </TableRow>
              {lines.map((l) => (
                <TableRow key={l.day} className={ROW}>
                  <TableCell className={`${CELL} whitespace-nowrap pl-14 text-muted-foreground`}>{format(parseISO(l.day), "EEE d MMM")}</TableCell>
                  {showAttendance && <>
                    <TableCell className={`${CELL} tabular-nums`}>{fmtClock(l.att?.sign_in_time ?? null)}</TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{fmtClock(l.att?.sign_out_time ?? null)}</TableCell>
                    <TableCell className={NUM}>{hours((l.att?.total_hours ?? 0) * 3600)}</TableCell>
                  </>}
                  {figureCells(l.figures)}
                </TableRow>
              ))}
            </Fragment>
          ))}
          <TableRow className="border-t-2 bg-muted/50 font-semibold hover:bg-muted/50">
            <TableCell className={CELL}>Grand total</TableCell>
            {showAttendance && <><TableCell /><TableCell /><TableCell className={NUM}>{hours(attSecs(all))}</TableCell></>}
            {figureCells(team, true)}
          </TableRow>
        </TableBody>
      </Table>
    </TableCard>
  );
}
