import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { Headphones, Loader2, Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUrlState } from "@/hooks/useUrlState";
import { useUserRole } from "@/hooks/useUserRole";
import { CELL, Fig, NUM, Person, ROW, StatusChip, TH, TableCard, type Tone } from "./GamingTable";
import { useCallers, useDispositionCatalog } from "./gamingStats";

const PAGE = 25;
const CATEGORY_TONE: Record<string, Tone> = { positive: "good", follow_up: "warn", negative: "bad", neutral: "neutral" };
const scoreTone = (n: number): Tone => (n >= 8 ? "good" : n >= 6 ? "warn" : "bad");
const dur = (s: number | null) => (s && s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : null);

interface LogRow {
  id: string; started_at: string | null; agent_id: string | null; caller_type: string; status: string;
  call_duration: number | null; conversation_duration: number | null; r2_key: string | null; recording_url: string | null;
  analysis_status: string | null; analysis_quality_score: number | null; contact_id: string | null;
  contacts: { first_name: string; last_name: string | null; phone: string | null } | null;
  call_dispositions: { name: string; category: string | null } | null;
  call_sub_dispositions: { name: string } | null;
}

interface LogDetail {
  id: string; transcript: string | null; analysis_summary: string | null; analysis_tone: string | null; analysis_script_adherence: string | null;
  analysis_objections: string[] | null; analysis_next_step: string | null; analysis_quality_score: number | null; notes: string | null;
  r2_key: string | null; recording_url: string | null; recording_duration: number | null;
}

export default function GamingCallLogs() {
  const { effectiveOrgId } = useOrgContext();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const admin = isAdmin || isSuperAdmin;
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useUrlState("from", format(addDays(new Date(), -14), "yyyy-MM-dd"));
  const [to, setTo] = useUrlState("to", today);
  const [caller, setCaller] = useUrlState("caller", "all");
  const [dispo, setDispo] = useUrlState("dispo", "all");
  const [type, setType] = useUrlState("type", "all");
  const [recorded, setRecorded] = useUrlState("rec", "all");
  const [q, setQ] = useUrlState("q", "");
  const [page, setPage] = useUrlState("page", 0);
  const [openId, setOpenId] = useUrlState("call", "");

  const { data: callers = [] } = useCallers(effectiveOrgId ?? "");
  const nameOf = useMemo(() => Object.fromEntries(callers.map((c) => [c.id, c.name])), [callers]);
  const catalog = useDispositionCatalog(effectiveOrgId ?? "");

  // Callers only ever see their own calls; admins can look at everyone.
  const agentFilter = admin ? (caller === "all" ? null : caller) : userId;

  const list = useQuery({
    queryKey: ["gaming-call-logs", effectiveOrgId, from, to, agentFilter, dispo, type, recorded, q, page, admin],
    enabled: !!effectiveOrgId && (admin || !!userId),
    queryFn: async () => {
      let query = supabase.from("call_logs")
        .select(`id, started_at, agent_id, caller_type, status, call_duration, conversation_duration, r2_key, recording_url, analysis_status, analysis_quality_score, contact_id,
          contacts:contact_id${q ? "!inner" : ""}(first_name, last_name, phone), call_dispositions:disposition_id(name, category), call_sub_dispositions:sub_disposition_id(name)`, { count: "exact" })
        .eq("org_id", effectiveOrgId!)
        .gte("started_at", `${from}T00:00:00+05:30`).lt("started_at", `${format(addDays(parseISO(to), 1), "yyyy-MM-dd")}T00:00:00+05:30`)
        .order("started_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (agentFilter) query = query.eq("agent_id", agentFilter);
      if (/^[0-9a-f-]{36}$/i.test(dispo)) query = query.eq("disposition_id", dispo);
      if (type !== "all") query = query.eq("caller_type", type);
      if (recorded === "1") query = query.not("r2_key", "is", null);
      if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`, { referencedTable: "contacts" });
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as LogRow[], count: count ?? 0 };
    },
  });
  const totals = useQuery({
    queryKey: ["gaming-call-logs-recorded", effectiveOrgId, from, to, agentFilter],
    enabled: !!effectiveOrgId && (admin || !!userId),
    queryFn: async () => {
      let query = supabase.from("call_logs").select("id", { count: "exact", head: true }).eq("org_id", effectiveOrgId!).not("r2_key", "is", null)
        .gte("started_at", `${from}T00:00:00+05:30`).lt("started_at", `${format(addDays(parseISO(to), 1), "yyyy-MM-dd")}T00:00:00+05:30`);
      if (agentFilter) query = query.eq("agent_id", agentFilter);
      return (await query).count ?? 0;
    },
  });

  const rows = list.data?.rows ?? [];
  const count = list.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0); };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Call Logs</h1>
          <p className="mt-1 max-w-3xl text-base text-foreground">
            {count.toLocaleString("en-IN")} calls between {format(parseISO(from), "d MMM")} and {format(parseISO(to), "d MMM")}.
            {" "}{(totals.data ?? 0).toLocaleString("en-IN")} have a recording with an AI review of the call.
          </p>
        </div>

        <Card className="flex flex-wrap items-end gap-3 rounded-xl p-3 shadow-sm">
          <div className="space-y-1"><label className="text-xs text-muted-foreground" htmlFor="cl-from">From</label><Input id="cl-from" type="date" className="h-9 w-40" value={from} onChange={(e) => e.target.value && setFilter(setFrom)(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs text-muted-foreground" htmlFor="cl-to">To</label><Input id="cl-to" type="date" className="h-9 w-40" value={to} onChange={(e) => e.target.value && setFilter(setTo)(e.target.value)} /></div>
          {admin && (
            <div className="space-y-1"><span className="text-xs text-muted-foreground">Caller</span>
              <Select value={caller} onValueChange={setFilter(setCaller)}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All callers</SelectItem>{callers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
          )}
          <div className="space-y-1"><span className="text-xs text-muted-foreground">Outcome</span>
            <Select value={dispo} onValueChange={setFilter(setDispo)}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All outcomes</SelectItem>{(catalog.data?.dispositions ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
          {admin && (
            <div className="space-y-1"><span className="text-xs text-muted-foreground">Made by</span>
              <Select value={type} onValueChange={setFilter(setType)}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Humans and AI</SelectItem><SelectItem value="human">Human callers</SelectItem><SelectItem value="ai">AI assistant</SelectItem></SelectContent></Select></div>
          )}
          <div className="space-y-1"><span className="text-xs text-muted-foreground">Recording</span>
            <Select value={recorded} onValueChange={setFilter(setRecorded)}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All calls</SelectItem><SelectItem value="1">With a recording</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><label className="text-xs text-muted-foreground" htmlFor="cl-q">Lead name</label><Input id="cl-q" className="h-9 w-44" placeholder="Search" value={q} onChange={(e) => setFilter(setQ)(e.target.value)} /></div>
        </Card>

        <TableCard title="Calls" subtitle="Select a row to hear the recording, read the transcript and see the AI review.">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TH>When</TH><TH>Caller</TH><TH>Lead</TH><TH>Outcome</TH><TH>Sub-disposition</TH><TH right>Talk time</TH><TH className="text-center">Recording</TH><TH className="text-center">AI review</TH>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading && <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading calls...</TableCell></TableRow>}
              {rows.map((r) => {
                const lead = r.contacts ? `${r.contacts.first_name} ${r.contacts.last_name ?? ""}`.trim() : "Unknown lead";
                const cat = r.call_dispositions?.category ?? "neutral";
                return (
                  <TableRow key={r.id} className={`${ROW} cursor-pointer`} onClick={() => setOpenId(r.id)}>
                    <TableCell className={`${CELL} whitespace-nowrap`}>
                      <p className="font-medium text-foreground">{r.started_at ? format(new Date(r.started_at), "d MMM") : "-"}</p>
                      <p className="text-xs text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : ""}</p>
                    </TableCell>
                    <TableCell className={CELL}>{r.caller_type === "ai" ? <Person name="AI assistant" sub="Automated" /> : <Person name={nameOf[r.agent_id ?? ""] ?? "Caller"} />}</TableCell>
                    <TableCell className={CELL}><p className="font-medium text-foreground">{lead}</p><p className="text-xs tabular-nums text-muted-foreground">{r.contacts?.phone ?? ""}</p></TableCell>
                    <TableCell className={CELL}>{r.call_dispositions ? <StatusChip tone={CATEGORY_TONE[cat] ?? "neutral"}>{r.call_dispositions.name}</StatusChip> : <Fig v={0} />}</TableCell>
                    <TableCell className={`${CELL} text-muted-foreground`}>{r.call_sub_dispositions?.name ?? ""}</TableCell>
                    <TableCell className={NUM}>{dur(r.conversation_duration) ?? <Fig v={0} />}</TableCell>
                    <TableCell className={`${CELL} text-center`}>{r.r2_key || r.recording_url ? <Headphones className="mx-auto h-4 w-4 text-primary" aria-label="Has a recording" /> : <Fig v={0} />}</TableCell>
                    <TableCell className={`${CELL} text-center`}>{r.analysis_status === "ok" && r.analysis_quality_score != null ? <StatusChip tone={scoreTone(r.analysis_quality_score)}>{r.analysis_quality_score}/10</StatusChip> : <Fig v={0} />}</TableCell>
                  </TableRow>
                );
              })}
              {!list.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No calls match these filters.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </TableCard>
      </div>

      <CallDetail id={openId} row={rows.find((r) => r.id === openId) ?? null} nameOf={nameOf} restrictTo={admin ? null : userId} onClose={() => setOpenId("")} />
    </DashboardLayout>
  );
}

function CallDetail({ id, row, nameOf, restrictTo, onClose }: { id: string; row: LogRow | null; nameOf: Record<string, string>; restrictTo: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["gaming-call-detail", id, restrictTo],
    enabled: !!id,
    queryFn: async () => {
      // a caller can only open a call they made
      let query = supabase.from("call_logs")
        .select("id, transcript, analysis_summary, analysis_tone, analysis_script_adherence, analysis_objections, analysis_next_step, analysis_quality_score, notes, r2_key, recording_url, recording_duration")
        .eq("id", id);
      if (restrictTo) query = query.eq("agent_id", restrictTo);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as unknown as LogDetail | null;
    },
  });
  const d = detail.data;
  const [audio, setAudio] = useState<{ state: "idle" | "loading" | "ready" | "error"; url?: string }>({ state: "idle" });

  useEffect(() => {
    setAudio({ state: "idle" });
    if (!id || !d || !(d.r2_key || d.recording_url)) return;
    let cancelled = false; let objectUrl: string | undefined;
    (async () => {
      setAudio({ state: "loading" });
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exotel-get-recording?callLogId=${id}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
        if (!res.ok) throw new Error(String(res.status));
        objectUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setAudio({ state: "ready", url: objectUrl });
      } catch { if (!cancelled) setAudio({ state: "error" }); }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, d?.r2_key, d?.recording_url]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAi = row?.caller_type === "ai";
  const lead = row?.contacts ? `${row.contacts.first_name} ${row.contacts.last_name ?? ""}`.trim() : "Lead";
  const lines = (d?.transcript ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(agent|user):\s*(.*)$/i);
    return m ? { who: m[1].toLowerCase() as "agent" | "user", text: m[2] } : { who: "agent" as const, text: l };
  });
  const score = d?.analysis_quality_score;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{lead}</SheetTitle>
          <SheetDescription>
            {row?.started_at ? format(new Date(row.started_at), "EEE d MMM, HH:mm") : ""} · {isAi ? "AI assistant" : (nameOf[row?.agent_id ?? ""] ?? "Caller")}
            {row?.call_dispositions ? ` · ${row.call_dispositions.name}${row.call_sub_dispositions ? `: ${row.call_sub_dispositions.name}` : ""}` : ""}
          </SheetDescription>
        </SheetHeader>

        {!detail.isLoading && !d && <p className="mt-6 text-sm text-muted-foreground">This call is not available to you.</p>}
        {detail.isLoading && <p className="mt-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading...</p>}
        {d && (
          <div className="mt-5 space-y-5">
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Mic className="h-3.5 w-3.5" />Recording</h3>
              {!(d.r2_key || d.recording_url) && <p className="text-sm text-muted-foreground">This call was not recorded.</p>}
              {audio.state === "loading" && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading the recording...</p>}
              {audio.state === "error" && <p className="text-sm text-rose-700">The recording could not be loaded. Try again in a moment.</p>}
              {audio.state === "ready" && <audio controls preload="metadata" src={audio.url} className="w-full" />}
              {(row?.conversation_duration ?? 0) > 0 && <p className="mt-1 text-xs text-muted-foreground">Talk time {dur(row!.conversation_duration)}</p>}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI review</h3>
              {score == null && !d.analysis_summary ? <p className="text-sm text-muted-foreground">No AI review for this call.</p> : (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-3">
                    <div className="text-center"><p className="text-3xl font-bold tabular-nums text-foreground">{score ?? "-"}</p><p className="text-[10px] text-muted-foreground">out of 10</p></div>
                    <div><p className="text-xs text-muted-foreground">Tone</p><Badge variant="outline" className="capitalize">{d.analysis_tone ?? "-"}</Badge></div>
                  </div>
                  <div><p className="mb-0.5 text-xs font-medium text-muted-foreground">Summary</p><p className="text-sm leading-relaxed">{d.analysis_summary}</p></div>
                  <div><p className="mb-0.5 text-xs font-medium text-muted-foreground">Script adherence</p><p className="text-sm leading-relaxed">{d.analysis_script_adherence}</p></div>
                  <div><p className="mb-1 text-xs font-medium text-muted-foreground">Objections raised</p>
                    {Array.isArray(d.analysis_objections) && d.analysis_objections.length > 0
                      ? <div className="flex flex-wrap gap-1.5">{d.analysis_objections.map((o, i) => <Badge key={i} variant="secondary" className="text-[11px]">{o}</Badge>)}</div>
                      : <p className="text-sm text-muted-foreground">None</p>}
                  </div>
                  <div><p className="mb-0.5 text-xs font-medium text-muted-foreground">Suggested next step</p><p className="text-sm leading-relaxed">{d.analysis_next_step}</p></div>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transcript</h3>
              {lines.length === 0 ? <p className="text-sm text-muted-foreground">No transcript for this call.</p> : (
                <div className="space-y-2">
                  {lines.map((l, i) => (
                    <div key={i} className={`flex ${l.who === "agent" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${l.who === "agent" ? "bg-muted text-foreground" : "border bg-background"}`}>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{l.who === "agent" ? (isAi ? "AI assistant" : "Caller") : "Lead"}</p>
                        {l.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
