import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Phone, PhoneCall, Star, UserCheck } from "lucide-react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, Fig, NUM, Person, ROW, TH, TableCard } from "./GamingTable";
import { sumOutcomes, useCallersWithHistory, useDayOutcomes, useHourlyCounts } from "./gamingStats";
import { PeriodSwitch, StatCard, VolumeCard, connectRate, usePeriod } from "./simpleDashboard";

/** Ajimos calling manager and admins: one row of figures, one chart, one table. The detail is under Reports. */
export function GamingManagerDashboard({ orgId }: { orgId: string }) {
  const { period, setPeriod, from, to, prevFrom, prevTo, versus } = usePeriod();
  const { data: callers = [] } = useCallersWithHistory(orgId);
  const now = useDayOutcomes(orgId, from, to);
  const before = useDayOutcomes(orgId, prevFrom, prevTo);
  const hourly = useHourlyCounts(orgId, from, to);
  const t = sumOutcomes(now.data ?? []);
  const p = before.data ? sumOutcomes(before.data) : undefined;

  const rows = callers
    .map((c) => ({ ...c, ...sumOutcomes((now.data ?? []).filter((r) => r.agent_id === c.id)) }))
    .filter((c) => c.active || c.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  // Outcomes saved by someone who is not a caller (the manager or an admin), so the table adds up to the figures above.
  const known = new Set(callers.map((c) => c.id));
  const others = sumOutcomes((now.data ?? []).filter((r) => !known.has(r.agent_id)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Overview</h1>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total calls" value={t.total} prev={p?.total} versus={versus} icon={Phone} />
        <StatCard label="Connected" value={t.connected} prev={p?.connected} versus={versus} icon={PhoneCall} hint={`${connectRate(t.connected, t.total)} of calls`} />
        <StatCard label="Interested" value={t.interested} prev={p?.interested} versus={versus} icon={Star} />
        <StatCard label="Registered" value={t.registered} prev={p?.registered} versus={versus} icon={UserCheck} />
        <StatCard label="Activated" value={t.activated} prev={p?.activated} versus={versus} icon={BadgeCheck} />
      </div>

      <VolumeCard period={period} from={from} to={to} hourly={hourly.data ?? []} days={now.data ?? []} />

      <TableCard title="Callers">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent"><TH>Caller</TH><TH right>Calls</TH><TH right>Connected</TH><TH right>Registered</TH><TH right>Activated</TH></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} className={ROW}>
                <TableCell className={CELL}><Person name={c.name} /></TableCell>
                <TableCell className={NUM}><Fig v={c.total} bold /></TableCell>
                <TableCell className={NUM}>{c.total ? connectRate(c.connected, c.total) : <Fig v={0} />}</TableCell>
                <TableCell className={NUM}><Fig v={c.registered} /></TableCell>
                <TableCell className={NUM}><Fig v={c.activated} /></TableCell>
              </TableRow>
            ))}
            {others.total > 0 && (
              <TableRow className={ROW}>
                <TableCell className={CELL}><Person name="Others" /></TableCell>
                <TableCell className={NUM}><Fig v={others.total} bold /></TableCell>
                <TableCell className={NUM}>{connectRate(others.connected, others.total)}</TableCell>
                <TableCell className={NUM}><Fig v={others.registered} /></TableCell>
                <TableCell className={NUM}><Fig v={others.activated} /></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-2.5">
          <Link to={`/reports?report=productivity&from=${from}&to=${to}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">View detailed report <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </TableCard>
    </div>
  );
}
