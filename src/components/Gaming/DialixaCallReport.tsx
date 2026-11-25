import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useUrlState } from "@/hooks/useUrlState";
import { CELL, Fig, NUM, Person, ROW, StatusChip, TH, TableCard, type Tone } from "./GamingTable";
import { fmtHM } from "./gamingStats";

interface CallerRow { user_id: string | null; name: string; calls: number; outbound: number; inbound: number; connected: number; clean: number; talk_secs: number }
interface CallRow {
  id: string; user_id: string | null; caller: string; contact_id: string | null; player: string; direction: string; status: string | null;
  started_at: string; talk_secs: number; disconnected_by: string | null; hangup_cause: string | null; recording_url: string | null; outcome: string | null;
}
interface Report { enabled: boolean; last_ok_at?: string | null; callers?: CallerRow[]; total?: number; calls?: CallRow[] }

const PAGE = 25;
const STATUS: Record<string, { tone: Tone; label: string }> = {
  completed: { tone: "good", label: "Connected" }, "no-answer": { tone: "warn", label: "Not answered" },
  missed: { tone: "warn", label: "Missed" }, failed: { tone: "bad", label: "Failed" },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** Ajimos: calls as Dialixa recorded them. Shown to the calling manager and admins once Dialixa reports are on. */
export function DialixaCallReport({ from, to }: { from: string; to: string }) {
  const [caller, setCaller] = useUrlState("dxcaller", "all");
  const [page, setPage] = useState(0);
  const { data } = useQuery({
    queryKey: ["dialixa-call-report", from, to],
    queryFn: async (): Promise<Report> => {
      const { data: r, error } = await supabase.rpc("dialixa_call_report" as never, { _from: from, _to: to } as never);
      if (error) throw error;
      return (r ?? { enabled: false }) as unknown as Report;
    },
    refetchInterval: 5 * 60_000,
  });
  if (!data?.enabled) return null;

  const callers = data.callers ?? [];
  const calls = (data.calls ?? []).filter((c) => caller === "all" || (c.user_id ?? "none") === caller);
  const pages = Math.max(1, Math.ceil(calls.length / PAGE));
  const at = Math.min(page, pages - 1);
  const stale = !data.last_ok_at || Date.now() - new Date(data.last_ok_at).getTime() > 30 * 60_000;
  const capped = (data.total ?? 0) > (data.calls ?? []).length;

  return (
    <TableCard
      title="Dialixa calls"
      subtitle={<>Calls as Dialixa recorded them in these dates, a few minutes after each call. Clean means 1 minute or longer. {data.last_ok_at ? `Last updated ${when(data.last_ok_at)}.` : "Not updated yet."}</>}
      action={
        <div className="flex items-center gap-2">
          {stale && <StatusChip tone="bad">Not updating</StatusChip>}
          <Select value={caller} onValueChange={(v) => { setCaller(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-40" aria-label="Caller"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All callers</SelectItem>
              {callers.map((c) => <SelectItem key={c.user_id ?? "none"} value={c.user_id ?? "none"}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TH>Caller</TH><TH right>Calls</TH><TH right>Outgoing</TH><TH right>Incoming</TH><TH right>Connected</TH><TH right>Clean</TH><TH right>Talk time</TH><TH right>Average talk</TH>
          </TableRow>
        </TableHeader>
        <TableBody>
          {callers.filter((c) => caller === "all" || (c.user_id ?? "none") === caller).map((c) => (
            <TableRow key={c.user_id ?? "none"} className={ROW}>
              <TableCell className={CELL}><Person name={c.name} /></TableCell>
              <TableCell className={NUM}><Fig v={c.calls} bold /></TableCell>
              <TableCell className={NUM}><Fig v={c.outbound} /></TableCell>
              <TableCell className={NUM}><Fig v={c.inbound} /></TableCell>
              <TableCell className={NUM}><Fig v={c.connected} /></TableCell>
              <TableCell className={NUM}><Fig v={c.clean} /></TableCell>
              <TableCell className={NUM}>{c.talk_secs ? fmtHM(c.talk_secs) : <Fig v={0} />}</TableCell>
              <TableCell className={NUM}>{c.connected ? clock(Math.round(c.talk_secs / c.connected)) : <Fig v={0} />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TH>When</TH><TH>Caller</TH><TH>Player</TH><TH>Direction</TH><TH>Result</TH><TH right>Talk time</TH><TH>Ended by</TH><TH>Outcome saved</TH><TH>Recording</TH>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.slice(at * PAGE, at * PAGE + PAGE).map((c) => {
            const st = STATUS[c.status ?? ""] ?? { tone: "neutral" as Tone, label: c.status ?? "Unknown" };
            return (
              <TableRow key={c.id} className={ROW}>
                <TableCell className={`${CELL} whitespace-nowrap`}>{when(c.started_at)}</TableCell>
                <TableCell className={CELL}>{c.caller}</TableCell>
                <TableCell className={CELL}>{c.contact_id ? <Link className="text-primary underline" to={`/contacts/${c.contact_id}`}>{c.player}</Link> : c.player}</TableCell>
                <TableCell className={CELL}>{c.direction === "inbound" ? "Incoming" : "Outgoing"}</TableCell>
                <TableCell className={CELL} title={c.hangup_cause ?? undefined}><StatusChip tone={st.tone}>{st.label}</StatusChip></TableCell>
                <TableCell className={NUM}>{c.talk_secs ? clock(c.talk_secs) : <Fig v={0} />}</TableCell>
                <TableCell className={CELL}>{c.disconnected_by === "user" ? "Caller" : c.disconnected_by ? "Player" : <Fig v={0} />}</TableCell>
                <TableCell className={CELL}>{c.outcome ?? <Fig v={0} />}</TableCell>
                <TableCell className={CELL}>{c.recording_url?.startsWith("https://") ? <a className="text-primary underline" href={c.recording_url} target="_blank" rel="noreferrer">Open</a> : <Fig v={0} />}</TableCell>
              </TableRow>
            );
          })}
          {calls.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No Dialixa calls in these dates.</TableCell></TableRow>}
        </TableBody>
      </Table>
      {(pages > 1 || capped) && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
          <span>Page {at + 1} of {pages}{capped ? ". The list shows the latest 500 calls; pick fewer days for the rest." : ""}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={at + 1 >= pages} onClick={() => setPage(at + 1)}>Next</Button>
          </div>
        </div>
      )}
    </TableCard>
  );
}
