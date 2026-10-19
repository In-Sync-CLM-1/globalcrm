import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { AlertTriangle, CheckCircle2, Phone, Plus, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { UrlTabs } from "@/components/UrlTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNotification } from "@/hooks/useNotification";
import { useOrgContext } from "@/hooks/useOrgContext";
import { CallsByDateHour } from "@/components/Gaming/CallsByDateHour";
import { CallsOverTime, type DayCounts } from "@/components/Gaming/CallsOverTime";
import { CELL, Fig, NUM, Person, ROW, StatusChip, TH, TableCard, type Tone } from "@/components/Gaming/GamingTable";
import type { HourlyRow } from "@/components/Gaming/gamingStats";

interface AiConfig {
  enabled: boolean; mode: "test" | "live"; test_numbers: string[]; windows: { start_min: number; end_min: number }[];
  max_attempts: number; max_concurrent: number; retry_gap_hours: number; exotel_app_id: string | null; caller_id: string | null; default_script_id: string | null;
}
const DEFAULT_CFG: AiConfig = { enabled: false, mode: "test", test_numbers: [], windows: [{ start_min: 600, end_min: 1200 }], max_attempts: 3, max_concurrent: 3, retry_gap_hours: 3, exotel_app_id: null, caller_id: null, default_script_id: null };

interface Script {
  id: string; name: string; objective: string; opening: string; key_points: string[] | null; objection_handling: Record<string, string> | null;
  closing: string | null; product_name: string | null; product_notes: string | null; behavioral_guidelines: string | null; language: string | null;
  max_duration_seconds: number | null; is_active: boolean;
}

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (v: string) => { const [h, m] = v.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

const QUEUE_TONE: Record<string, Tone> = { pending: "neutral", calling: "info", done: "good", skipped: "warn", failed: "bad", cancelled: "neutral" };
const OUTCOME_TONE: Record<string, Tone> = { Interested: "good", "Callback Requested": "warn", "Not Interested": "bad", "Do Not Call": "bad" };
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700", calling: "bg-blue-100 text-blue-800", done: "bg-emerald-100 text-emerald-800",
  skipped: "bg-amber-100 text-amber-800", failed: "bg-rose-100 text-rose-800", cancelled: "bg-slate-100 text-slate-500",
};

export default function AiCalling() {
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const qc = useQueryClient();
  const [scriptId, setScriptId] = useState("");
  const [stageId, setStageId] = useState("");
  const [limit, setLimit] = useState("50");
  const [testName, setTestName] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [editing, setEditing] = useState<Script | null>(null);
  const [liveConfirm, setLiveConfirm] = useState(false);

  const orgQ = useQuery({
    queryKey: ["ai-calling-org", effectiveOrgId],
    queryFn: async () => (await supabase.from("organizations").select("settings").eq("id", effectiveOrgId!).maybeSingle()).data?.settings as { ai_calling?: Partial<AiConfig> } | null,
    enabled: !!effectiveOrgId,
  });
  const cfg: AiConfig = { ...DEFAULT_CFG, ...(orgQ.data?.ai_calling ?? {}) };
  const [draft, setDraft] = useState<AiConfig | null>(null);
  const settings = draft ?? cfg;

  const scriptsQ = useQuery({
    queryKey: ["ai-calling-scripts", effectiveOrgId],
    queryFn: async () => ((await supabase.from("ai_call_scripts").select("*").eq("org_id", effectiveOrgId!).order("created_at")).data ?? []) as unknown as Script[],
    enabled: !!effectiveOrgId,
  });
  const stagesQ = useQuery({
    queryKey: ["ai-calling-stages", effectiveOrgId],
    queryFn: async () => (await supabase.from("pipeline_stages").select("id, name, stage_order").eq("org_id", effectiveOrgId!).order("stage_order")).data ?? [],
    enabled: !!effectiveOrgId,
  });
  const queueQ = useQuery({
    queryKey: ["ai-calling-queue", effectiveOrgId],
    queryFn: async () => (await supabase.from("ai_call_queue").select("id, status, attempts, last_error, next_attempt_at, updated_at, contacts:contact_id(first_name, last_name)").eq("org_id", effectiveOrgId!).order("updated_at", { ascending: false }).limit(60)).data ?? [],
    enabled: !!effectiveOrgId, refetchInterval: 15000,
  });
  const queueCounts = useQuery({
    queryKey: ["ai-calling-queue-counts", effectiveOrgId],
    queryFn: async () => {
      const out: Record<string, number> = {};
      for (const s of ["pending", "calling", "done", "skipped", "failed"]) {
        const { count } = await supabase.from("ai_call_queue").select("id", { count: "exact", head: true }).eq("org_id", effectiveOrgId!).eq("status", s);
        out[s] = count ?? 0;
      }
      return out;
    },
    enabled: !!effectiveOrgId, refetchInterval: 15000,
  });
  const callsQ = useQuery({
    queryKey: ["ai-calling-calls", effectiveOrgId],
    queryFn: async () => (await supabase.from("call_logs")
      .select("id, started_at, status, conversation_duration, call_duration, analysis_summary, call_dispositions:disposition_id(name), call_sub_dispositions:sub_disposition_id(name), contacts:contact_id(first_name, last_name)")
      .eq("org_id", effectiveOrgId!).eq("caller_type", "ai").gte("started_at", subDays(new Date(), 30).toISOString()).order("started_at", { ascending: false }).limit(1000)).data ?? [],
    enabled: !!effectiveOrgId,
  });

  const call = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("ai-call-enqueue", { body });
      if (error) throw error;
      if (data && data.success === false) throw new Error(data.error);
      return data;
    },
    onSuccess: (d, v) => {
      if (v.action === "save_settings") { notify.success("Settings saved"); setDraft(null); setLiveConfirm(false); }
      else if (v.action === "cancel") notify.success(`${d.cancelled} queued calls cancelled`);
      else notify.success(`${d.queued} lead(s) queued${d.already_queued ? `, ${d.already_queued} already in the queue` : ""}`);
      qc.invalidateQueries({ queryKey: ["ai-calling-org"] }); qc.invalidateQueries({ queryKey: ["ai-calling-queue"] }); qc.invalidateQueries({ queryKey: ["ai-calling-queue-counts"] });
    },
    onError: (e: Error) => notify.error("Could not complete that", e.message),
  });

  const saveScript = useMutation({
    mutationFn: async (s: Script) => {
      const row = { name: s.name, objective: s.objective, opening: s.opening, key_points: s.key_points ?? [], objection_handling: s.objection_handling ?? {}, closing: s.closing, product_name: s.product_name, product_notes: s.product_notes, behavioral_guidelines: s.behavioral_guidelines, language: s.language, max_duration_seconds: s.max_duration_seconds, is_active: s.is_active };
      const { error } = s.id ? await supabase.from("ai_call_scripts").update(row).eq("id", s.id) : await supabase.from("ai_call_scripts").insert({ ...row, org_id: effectiveOrgId! });
      if (error) throw error;
    },
    onSuccess: () => { notify.success("Script saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["ai-calling-scripts"] }); },
    onError: (e: Error) => notify.error("Could not save the script", e.message),
  });

  const scripts = scriptsQ.data ?? [];
  const activeScriptId = scriptId || cfg.default_script_id || scripts.find((s) => s.is_active)?.id || "";
  const calls = callsQ.data ?? [];

  const stats = useMemo(() => {
    const connected = calls.filter((c) => (c.conversation_duration ?? 0) > 0).length;
    const name = (c: (typeof calls)[number]) => (c.call_dispositions as { name: string } | null)?.name ?? "";
    return { total: calls.length, connected, interested: calls.filter((c) => name(c) === "Interested").length, callbacks: calls.filter((c) => name(c) === "Callback Requested").length };
  }, [calls]);

  const outcomes = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of calls) { const n = (c.call_dispositions as { name: string } | null)?.name ?? "Unclassified"; m.set(n, (m.get(n) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [calls]);

  // AI calls as date x hour rows for the one graph (IST)
  const hourlyRows = useMemo<HourlyRow[]>(() => {
    const by = new Map<string, HourlyRow>();
    for (const c of calls) {
      const at = new Date(c.started_at as string);
      const day = at.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const hour = Number(at.toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).slice(0, 2));
      const e = by.get(`${day}|${hour}`) ?? { day, hour, calls: 0, new_dials: 0, connected_calls: 0, clean_calls: 0 };
      e.calls++;
      if ((c.conversation_duration ?? 0) > 0) e.connected_calls++;
      if ((c.conversation_duration ?? 0) >= 60) e.clean_calls++;
      by.set(`${day}|${hour}`, e);
    }
    return [...by.values()];
  }, [calls]);

  // AI calls per date (IST) for the line chart
  const dayRows = useMemo<DayCounts[]>(() => {
    const by = new Map<string, DayCounts>();
    for (const c of calls) {
      const day = new Date(c.started_at as string).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const e = by.get(day) ?? { day, calls: 0, connected_calls: 0, clean_calls: 0 };
      e.calls++;
      if ((c.conversation_duration ?? 0) > 0) e.connected_calls++;
      if ((c.conversation_duration ?? 0) >= 60) e.clean_calls++;
      by.set(day, e);
    }
    return [...by.values()];
  }, [calls]);

  const lineReady = !!cfg.exotel_app_id;
  const set = (patch: Partial<AiConfig>) => setDraft({ ...settings, ...patch });

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground"><Sparkles className="h-5 w-5" /> AI Calling</h1>
            <p className="text-sm text-muted-foreground">An AI assistant phones leads, pitches registration, and records the outcome as a disposition.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={cfg.enabled ? "default" : "secondary"}>{cfg.enabled ? "Switched on" : "Switched off"}</Badge>
            <Badge variant="outline" className={cfg.mode === "live" ? "border-rose-300 text-rose-700" : "border-amber-300 text-amber-700"}>{cfg.mode === "live" ? "Live: any lead" : "Test mode: approved numbers only"}</Badge>
          </div>
        </div>

        {!lineReady && (
          <Card className="flex items-start gap-3 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>The AI phone line is not connected yet, so no call can be placed. Add the Exotel Voicebot app number in Settings once it is set up. Queued leads wait until then.</span>
          </Card>
        )}

        <UrlTabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="launch">Launch calls</TabsTrigger>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[["AI calls (30 days)", stats.total], ["Connected", stats.connected], ["Interested", stats.interested], ["Callbacks", stats.callbacks], ["Waiting in queue", queueCounts.data?.pending ?? 0]].map(([label, value]) => (
                <Card key={label as string} className="p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{(value as number).toLocaleString("en-IN")}</p>
                </Card>
              ))}
            </div>
            <CallsOverTime rows={dayRows} note="AI calls, last 30 days." />
            <CallsByDateHour rows={hourlyRows} measures={["calls", "connected_calls", "clean_calls"]} note="AI calls, last 30 days." />
            <TableCard title="How AI calls ended" subtitle="Last 30 days, by disposition">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TH>Outcome</TH><TH right>Calls</TH><TH right>Share</TH></TableRow></TableHeader>
                <TableBody>
                  {outcomes.map(([name, n]) => (
                    <TableRow key={name} className={ROW}>
                      <TableCell className={CELL}><StatusChip tone={OUTCOME_TONE[name] ?? "neutral"}>{name}</StatusChip></TableCell>
                      <TableCell className={NUM}><Fig v={n} bold /></TableCell>
                      <TableCell className={`${NUM} text-muted-foreground`}>{stats.total ? Math.round((100 * n) / stats.total) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
            <TableCard title="Recent AI calls" subtitle="The 12 most recent">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TH>When</TH><TH>Lead</TH><TH>Outcome</TH><TH>Detail</TH><TH right>Talk time</TH><TH>Summary</TH></TableRow></TableHeader>
                <TableBody>
                  {calls.slice(0, 12).map((c) => {
                    const ct = c.contacts as { first_name: string; last_name: string | null } | null;
                    const outcome = (c.call_dispositions as { name: string } | null)?.name;
                    return (
                      <TableRow key={c.id} className={ROW}>
                        <TableCell className={`${CELL} whitespace-nowrap text-xs text-muted-foreground`}>{format(new Date(c.started_at as string), "d MMM, HH:mm")}</TableCell>
                        <TableCell className={CELL}>{ct ? <Person name={`${ct.first_name} ${ct.last_name ?? ""}`.trim()} /> : "—"}</TableCell>
                        <TableCell className={CELL}>{outcome ? <StatusChip tone={OUTCOME_TONE[outcome] ?? "neutral"}>{outcome}</StatusChip> : "—"}</TableCell>
                        <TableCell className={`${CELL} text-muted-foreground`}>{(c.call_sub_dispositions as { name: string } | null)?.name ?? ""}</TableCell>
                        <TableCell className={NUM}>{c.conversation_duration ? `${Math.floor(c.conversation_duration / 60)}m ${String(c.conversation_duration % 60).padStart(2, "0")}s` : <Fig v={0} />}</TableCell>
                        <TableCell className={`${CELL} max-w-xs truncate text-xs text-muted-foreground`}>{c.analysis_summary ?? ""}</TableCell>
                      </TableRow>
                    );
                  })}
                  {calls.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No AI calls yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableCard>
          </TabsContent>

          <TabsContent value="launch" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold">Queue leads for AI calls</h2>
                <div className="space-y-1.5">
                  <Label>Script</Label>
                  <Select value={activeScriptId} onValueChange={setScriptId}>
                    <SelectTrigger><SelectValue placeholder="Choose a script" /></SelectTrigger>
                    <SelectContent>{scripts.filter((s) => s.is_active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label>Leads in stage</Label>
                    <Select value={stageId} onValueChange={setStageId}>
                      <SelectTrigger><SelectValue placeholder="Choose a stage" /></SelectTrigger>
                      <SelectContent>{(stagesQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>How many</Label><Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
                </div>
                <Button disabled={!activeScriptId || !stageId || call.isPending} onClick={() => call.mutate({ action: "enqueue", script_id: activeScriptId, stage_id: stageId, limit: Number(limit) })}>
                  <Plus className="mr-2 h-4 w-4" />Queue calls
                </Button>
                <p className="text-xs text-muted-foreground">Calls are placed one minute at a time inside the calling hours, with a retry for no answer. In test mode, leads whose number is not approved are skipped.</p>
              </Card>
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold">Place a test call</h2>
                <p className="text-xs text-muted-foreground">Creates a test lead on a number you own, approves that number, and queues one call to it.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Name</Label><Input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="Your name" /></div>
                  <div className="space-y-1.5"><Label>Mobile number</Label><Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="10-digit number" /></div>
                </div>
                <Button variant="outline" disabled={!activeScriptId || !testPhone || call.isPending} onClick={() => call.mutate({ action: "test", script_id: activeScriptId, first_name: testName, phone: testPhone })}>
                  <Phone className="mr-2 h-4 w-4" />Queue test call
                </Button>
              </Card>
            </div>
            <TableCard
              title="Queue"
              subtitle="Leads waiting for, or already given, an AI call"
              action={
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {Object.entries(queueCounts.data ?? {}).map(([k, v]) => <StatusChip key={k} tone={QUEUE_TONE[k] ?? "neutral"}>{k} {v}</StatusChip>)}
                  <Button size="sm" variant="outline" disabled={!(queueCounts.data?.pending)} onClick={() => call.mutate({ action: "cancel" })}>Cancel pending</Button>
                </div>
              }
            >
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TH>Lead</TH><TH>Status</TH><TH right>Attempts</TH><TH>Next try</TH><TH>Note</TH></TableRow></TableHeader>
                <TableBody>
                  {(queueQ.data ?? []).map((q) => {
                    const ct = q.contacts as unknown as { first_name: string; last_name: string | null } | null;
                    return (
                      <TableRow key={q.id} className={ROW}>
                        <TableCell className={CELL}>{ct ? <Person name={`${ct.first_name} ${ct.last_name ?? ""}`.trim()} /> : "—"}</TableCell>
                        <TableCell className={CELL}><StatusChip tone={QUEUE_TONE[q.status] ?? "neutral"}>{q.status}</StatusChip></TableCell>
                        <TableCell className={NUM}><Fig v={q.attempts} /></TableCell>
                        <TableCell className={`${CELL} whitespace-nowrap text-xs text-muted-foreground`}>{q.status === "pending" ? format(new Date(q.next_attempt_at), "d MMM, HH:mm") : ""}</TableCell>
                        <TableCell className={`${CELL} text-xs text-muted-foreground`}>{q.last_error ?? ""}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(queueQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">The queue is empty.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableCard>
          </TabsContent>

          <TabsContent value="scripts" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEditing({ id: "", name: "", objective: "", opening: "", key_points: [], objection_handling: {}, closing: "", product_name: "", product_notes: "", behavioral_guidelines: "", language: "en", max_duration_seconds: 240, is_active: true })}><Plus className="mr-2 h-4 w-4" />New script</Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {scripts.map((s) => (
                <Card key={s.id} className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{s.name}</h2>
                    <div className="flex items-center gap-2"><Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Active" : "Off"}</Badge><Button size="sm" variant="outline" onClick={() => setEditing(s)}>Edit</Button></div>
                  </div>
                  <p className="text-sm text-muted-foreground">{s.objective}</p>
                  <p className="text-xs"><span className="font-medium">Opens with:</span> {s.opening}</p>
                  <p className="text-xs text-muted-foreground">{(s.key_points ?? []).length} key points · {Object.keys(s.objection_handling ?? {}).length} objection answers · up to {Math.round((s.max_duration_seconds ?? 240) / 60)} min</p>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <div><Label className="text-sm font-semibold">AI calling</Label><p className="text-xs text-muted-foreground">Master switch for this organisation.</p></div>
                <Switch checked={settings.enabled} onCheckedChange={(v) => set({ enabled: v })} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Mode</Label>
                  <Select value={settings.mode} onValueChange={(v) => set({ mode: v as "test" | "live" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="test">Test: approved numbers only</SelectItem><SelectItem value="live">Live: any lead</SelectItem></SelectContent>
                  </Select>
                  {settings.mode === "live" && cfg.mode !== "live" && (
                    <label className="flex items-start gap-2 text-xs text-rose-700"><input type="checkbox" className="mt-0.5" checked={liveConfirm} onChange={(e) => setLiveConfirm(e.target.checked)} />I understand live mode phones real leads and uses call minutes.</label>
                  )}
                </div>
                <div className="space-y-1.5"><Label>Approved test numbers (comma separated)</Label><Input value={settings.test_numbers.join(", ")} onChange={(e) => set({ test_numbers: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></div>
                <div className="space-y-1.5"><Label>Calling hours (IST, Mon to Sat)</Label>
                  <div className="flex items-center gap-2">
                    <Input type="time" value={hm(settings.windows[0]?.start_min ?? 600)} onChange={(e) => set({ windows: [{ start_min: toMin(e.target.value), end_min: settings.windows[0]?.end_min ?? 1200 }] })} />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input type="time" value={hm(settings.windows[0]?.end_min ?? 1200)} onChange={(e) => set({ windows: [{ start_min: settings.windows[0]?.start_min ?? 600, end_min: toMin(e.target.value) }] })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5"><Label>Attempts per lead</Label><Input type="number" min={1} max={5} value={settings.max_attempts} onChange={(e) => set({ max_attempts: Number(e.target.value) })} /></div>
                  <div className="space-y-1.5"><Label>Calls at once</Label><Input type="number" min={1} max={5} value={settings.max_concurrent} onChange={(e) => set({ max_concurrent: Number(e.target.value) })} /></div>
                  <div className="space-y-1.5"><Label>Retry gap (hours)</Label><Input type="number" min={1} max={48} value={settings.retry_gap_hours} onChange={(e) => set({ retry_gap_hours: Number(e.target.value) })} /></div>
                </div>
                <div className="space-y-1.5"><Label>Exotel Voicebot app number</Label><Input value={settings.exotel_app_id ?? ""} onChange={(e) => set({ exotel_app_id: e.target.value || null })} placeholder="From the Exotel dashboard" /></div>
                <div className="space-y-1.5"><Label>Caller ID wired to that app</Label><Input value={settings.caller_id ?? ""} onChange={(e) => set({ caller_id: e.target.value || null })} placeholder="e.g. 01169960919" /></div>
              </div>
              <div className="flex items-center gap-3">
                <Button disabled={!draft || call.isPending || (settings.mode === "live" && cfg.mode !== "live" && !liveConfirm)} onClick={() => call.mutate({ action: "save_settings", settings: { ...settings, default_script_id: activeScriptId || null }, confirm_live: liveConfirm })}>Save settings</Button>
                {lineReady ? <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />AI phone line connected</span> : <span className="text-xs text-amber-700">AI phone line not connected</span>}
              </div>
            </Card>
          </TabsContent>
        </UrlTabs>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit script" : "New script"}</DialogTitle><DialogDescription>What the AI says and how it handles the conversation. It always follows the safety rules built into the platform.</DialogDescription></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Objective</Label><Textarea rows={2} value={editing.objective} onChange={(e) => setEditing({ ...editing, objective: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Opening line (use {"{first_name}"} and {"{greeting}"})</Label><Textarea rows={2} value={editing.opening} onChange={(e) => setEditing({ ...editing, opening: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Key points (one per line)</Label><Textarea rows={4} value={(editing.key_points ?? []).join("\n")} onChange={(e) => setEditing({ ...editing, key_points: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></div>
              <div className="space-y-1.5"><Label>Objection answers (one per line as: objection | answer)</Label>
                <Textarea rows={4} value={Object.entries(editing.objection_handling ?? {}).map(([k, v]) => `${k} | ${v}`).join("\n")} onChange={(e) => setEditing({ ...editing, objection_handling: Object.fromEntries(e.target.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0] && p[1]).map((p) => [p[0], p[1]])) })} /></div>
              <div className="space-y-1.5"><Label>Closing</Label><Textarea rows={2} value={editing.closing ?? ""} onChange={(e) => setEditing({ ...editing, closing: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Platform name</Label><Input value={editing.product_name ?? ""} onChange={(e) => setEditing({ ...editing, product_name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Language</Label>
                  <Select value={editing.language ?? "en"} onValueChange={(v) => setEditing({ ...editing, language: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="hi">Hindi</SelectItem><SelectItem value="hinglish">Hinglish</SelectItem></SelectContent></Select></div>
              </div>
              <div className="space-y-1.5"><Label>Platform reference (facts the AI may use; nothing else is promised)</Label><Textarea rows={4} value={editing.product_notes ?? ""} onChange={(e) => setEditing({ ...editing, product_notes: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Behaviour guidelines</Label><Textarea rows={3} value={editing.behavioral_guidelines ?? ""} onChange={(e) => setEditing({ ...editing, behavioral_guidelines: e.target.value })} /></div>
              <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Label>Longest call (seconds)</Label><Input className="w-24" type="number" value={editing.max_duration_seconds ?? 240} onChange={(e) => setEditing({ ...editing, max_duration_seconds: Number(e.target.value) })} /></div>
                <div className="flex items-center gap-2"><Label>Active</Label><Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} /></div></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!editing?.name || !editing?.objective || !editing?.opening || saveScript.isPending} onClick={() => editing && saveScript.mutate(editing)}>Save script</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
