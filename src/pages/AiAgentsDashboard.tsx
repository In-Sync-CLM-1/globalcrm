import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Phone, PhoneCall, UserCheck, CalendarCheck, Clock, TrendingUp, Voicemail } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { RiyaDailyLearnings } from "@/components/Dashboard/RiyaDailyLearnings";

// One row per product (= one AI agent), straight from get_ai_agent_analytics.
interface AgentRow {
  product: string;
  total_dialed: number;
  picked_up: number;
  reached: number;
  no_answer: number;
  busy: number;
  failed: number;
  not_connected: number;
  in_flight: number;
  avg_talk_sec: number | null;
  demos: number;
  callbacks: number;
  interested: number;
  decision_maker: number;
  not_interested: number;
  not_qualified: number;
  dnc: number;
}

// Friendly labels. New products fall back to the raw name + "—" agent, so the
// page keeps working as the 7 new agents come online without code changes.
const PRODUCT_META: Record<string, { label: string; agent: string }> = {
  worksync: { label: "WorkSync", agent: "Riya" },
  vendorverification: { label: "Vendor Verification", agent: "Anushree" },
  globalcrm: { label: "GlobalCRM", agent: "—" },
  whatsapp: { label: "WhatsApp", agent: "—" },
  email: { label: "Email", agent: "—" },
  fieldsync: { label: "FieldSync", agent: "—" },
  event: { label: "Event", agent: "—" },
  expense: { label: "Expense", agent: "—" },
  ats: { label: "ATS", agent: "—" },
};
const metaFor = (p: string) => PRODUCT_META[p.toLowerCase().replace(/\s+/g, "")] ?? { label: p, agent: "—" };

type Verdict = { label: string; tone: "good" | "warn" | "bad" | "muted"; note: string };

// Derived metrics + my read on each product.
function enrich(r: AgentRow) {
  const dialed = r.total_dialed || 0;
  const positive = r.demos + r.callbacks + r.interested + r.decision_maker; // showed real interest
  const pickupRate = dialed ? r.picked_up / dialed : 0;
  const reachRate = dialed ? r.reached / dialed : 0;
  const demoRate = r.reached ? r.demos / r.reached : 0;
  const interestRate = r.reached ? positive / r.reached : 0;
  const score = Math.round(100 * (0.5 * demoRate + 0.3 * interestRate + 0.2 * reachRate));

  let verdict: Verdict;
  if (dialed < 20) {
    verdict = { label: "Too early", tone: "muted", note: "Not enough calls yet to judge — let it run." };
  } else if (r.reached === 0) {
    verdict = {
      label: "No conversations yet",
      tone: "muted",
      note: "Calls are connecting but no live conversation has been recorded yet — normal early in the process. This fills in as more calls land.",
    };
  } else if (demoRate >= 0.15) {
    verdict = { label: "Strong", tone: "good", note: "Booking demos at a healthy rate — prioritise scaling this product." };
  } else if (interestRate >= 0.3) {
    verdict = { label: "Promising", tone: "good", note: "Good interest from people reached; tighten the close to turn more into demos." };
  } else if (interestRate >= 0.1) {
    verdict = { label: "Mixed", tone: "warn", note: "Some interest — refine the script or sharpen the target list." };
  } else {
    verdict = { label: "Weak response", tone: "warn", note: "Low interest from people reached — revisit script or audience." };
  }
  return { ...r, positive, pickupRate, reachRate, demoRate, interestRate, score, verdict };
}
type EnrichedRow = ReturnType<typeof enrich>;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const talk = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`.replace(/^0m /, ""));

const toneClass: Record<Verdict["tone"], string> = {
  good: "bg-green-100 text-green-800 border-green-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  bad: "bg-red-100 text-red-800 border-red-200",
  muted: "bg-muted text-muted-foreground border-border",
};

const WINDOWS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

export default function AiAgentsDashboard() {
  const notify = useNotification();
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("1");
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_ai_agent_analytics", { p_days: Number(days) });
    if (error) {
      notify.error("Couldn't load agent analytics", error.message);
      setRows([]);
    } else {
      const enriched = (data as AgentRow[]).map(enrich);
      setRows(enriched);
      setSelected((prev) => prev && enriched.some((r) => r.product === prev) ? prev : enriched[0]?.product ?? null);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

  const ranked = useMemo(
    () => [...rows].sort((a, b) => {
      // too-early rows sink to the bottom; otherwise by score then reached
      const aEarly = a.total_dialed < 20, bEarly = b.total_dialed < 20;
      if (aEarly !== bEarly) return aEarly ? 1 : -1;
      return b.score - a.score || b.reached - a.reached;
    }),
    [rows],
  );

  const current = rows.find((r) => r.product === selected) || null;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">AI Agents</h1>
            <p className="text-sm text-muted-foreground">Per-agent performance and a side-by-side product comparison.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {rows.length === 0 && !loading && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">No AI calls in this window yet.</CardContent></Card>
        )}

        <Tabs defaultValue="comparison">
          <TabsList>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
            <TabsTrigger value="agent">By agent</TabsTrigger>
          </TabsList>

          {/* ---------------- COMPARISON ---------------- */}
          <TabsContent value="comparison" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Which product is likely to do well</CardTitle>
                <CardDescription>
                  Ranked by an overall score (weighted: demo rate 50%, interest rate 30%, reach rate 20%).
                  <strong> Reached</strong> = real conversations with a person (voicemail / no-answer excluded).
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent / Product</TableHead>
                      <TableHead className="text-right">Dialed</TableHead>
                      <TableHead className="text-right">Picked up</TableHead>
                      <TableHead className="text-right">Reached</TableHead>
                      <TableHead className="text-right">Reach %</TableHead>
                      <TableHead className="text-right">Avg talk</TableHead>
                      <TableHead className="text-right">Interested</TableHead>
                      <TableHead className="text-right">Demos</TableHead>
                      <TableHead className="text-right">Demo %</TableHead>
                      <TableHead className="text-right">Not int.</TableHead>
                      <TableHead className="text-right">DNC</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead>Verdict</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((r) => {
                      const m = metaFor(r.product);
                      return (
                        <TableRow key={r.product}>
                          <TableCell>
                            <div className="font-medium">{m.agent !== "—" ? m.agent : m.label}</div>
                            <div className="text-xs text-muted-foreground">{m.label}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.total_dialed}{r.in_flight ? <span className="text-xs text-muted-foreground"> (+{r.in_flight})</span> : null}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.picked_up} <span className="text-xs text-muted-foreground">{pct(r.pickupRate)}</span></TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{r.reached}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(r.reachRate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{talk(r.avg_talk_sec)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.positive}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{r.demos}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.reached ? pct(r.demoRate) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.not_interested}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.dnc}</TableCell>
                          <TableCell className="text-center tabular-nums font-semibold">{r.total_dialed < 20 ? "—" : r.score}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={toneClass[r.verdict.tone]}>{r.verdict.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- BY AGENT ---------------- */}
          <TabsContent value="agent" className="mt-4 space-y-4">
            <Select value={selected ?? undefined} onValueChange={setSelected}>
              <SelectTrigger className="w-[280px]"><SelectValue placeholder="Pick an agent" /></SelectTrigger>
              <SelectContent>
                {rows.map((r) => {
                  const m = metaFor(r.product);
                  return <SelectItem key={r.product} value={r.product}>{m.agent !== "—" ? `${m.agent} — ${m.label}` : m.label}</SelectItem>;
                })}
              </SelectContent>
            </Select>

            {current && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                  <Kpi icon={<Phone className="h-4 w-4" />} label="Dialed" value={current.total_dialed} sub={current.in_flight ? `${current.in_flight} in flight` : undefined} />
                  <Kpi icon={<PhoneCall className="h-4 w-4" />} label="Picked up" value={current.picked_up} sub={pct(current.pickupRate)} />
                  <Kpi icon={<UserCheck className="h-4 w-4" />} label="Reached a person" value={current.reached} sub={pct(current.reachRate)} />
                  <Kpi icon={<CalendarCheck className="h-4 w-4" />} label="Demos booked" value={current.demos} sub={current.reached ? pct(current.demoRate) : undefined} />
                  <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Interested" value={current.positive} sub={current.reached ? pct(current.interestRate) : undefined} />
                  <Kpi icon={<Clock className="h-4 w-4" />} label="Avg talk time" value={talk(current.avg_talk_sec)} />
                </div>

                <Card className={current.verdict.tone === "bad" ? "border-red-200" : undefined}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      {current.verdict.tone === "bad" && <Voicemail className="h-4 w-4 text-red-600" />}
                      <CardTitle className="text-base">Read: <Badge variant="outline" className={toneClass[current.verdict.tone]}>{current.verdict.label}</Badge></CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{current.verdict.note}</CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">Outcome breakdown</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
                      <Stat label="Demo booked" value={current.demos} />
                      <Stat label="Callback requested" value={current.callbacks} />
                      <Stat label="Interested" value={current.interested} />
                      <Stat label="Decision-maker follow-up" value={current.decision_maker} />
                      <Stat label="Not interested" value={current.not_interested} />
                      <Stat label="Not qualified" value={current.not_qualified} />
                      <Stat label="Do-not-call / wrong no." value={current.dnc} />
                      <Stat label="Voicemail / not connected" value={current.not_connected} />
                      <Stat label="No answer" value={current.no_answer} />
                      <Stat label="Busy" value={current.busy} />
                      <Stat label="Failed" value={current.failed} />
                    </div>
                  </CardContent>
                </Card>

                {/* This agent's own AI learnings (Key Learnings / objections / script tweaks). */}
                <RiyaDailyLearnings product={current.product} />
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
