import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { TopUpWalletDialog } from "@/components/Subscription/TopUpWalletDialog";
import DateRangeFilter, { DateRangePreset, getDateRangeFromPreset } from "@/components/common/DateRangeFilter";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import { format, eachDayOfInterval, startOfDay, differenceInCalendarDays, startOfWeek } from "date-fns";
import {
  Users as UsersIcon, PhoneCall, MessageSquare, IndianRupee, Clock,
  AlertTriangle, CheckCircle2, XCircle, Eye, Send,
} from "lucide-react";
import { useIsIedup, IEDUP_ORG_ID } from "@/hooks/useIsIedup";

const REFRESH_MS = 30_000;

const TEMPLATE_LABELS: Record<string, string> = {
  iedup_cmyuva_certificate_ready_v1: "Certificate ready",
  iedup_cmyuva_registration_steps_v1: "Registration steps",
  iedup_cmyuva_payment_failed_v1: "Payment failed",
  iedup_cmyuva_training_helpdesk_v1: "Help desk",
  iedup_cmyuva_photo_reupload_v1: "Photo re-upload",
  iedup_cmyuva_training_link_v2: "Training link",
  iedup_cmyuva_training_link_v3: "Training link",
};
const templateLabel = (n: string | null) =>
  n ? (TEMPLATE_LABELS[n] || n.replace(/^iedup_cmyuva_/, "").replace(/_v\d+$/, "").replace(/_/g, " ")) : "—";

const C = { sent: "#3b82f6", delivered: "#10b981", opened: "#8b5cf6", placed: "#6366f1", connected: "#10b981" };

export default function IedupDashboard() {
  const { isLoading: orgLoading } = useIsIedup();
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DateRangePreset>("this_month");
  const [dateRange, setDateRange] = useState(() => getDateRangeFromPreset("this_month"));

  const fromIso = dateRange.from.toISOString();
  const toIso = dateRange.to.toISOString();
  const rangeKey = `${format(dateRange.from, "yyyy-MM-dd")}_${format(dateRange.to, "yyyy-MM-dd")}`;

  // Beneficiary totals (all-time — this is a stock, not a flow)
  const { data: dataCounts } = useQuery({
    queryKey: ["iedup-data-counts"],
    queryFn: async () => {
      const [total, dnc, calledRows] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", IEDUP_ORG_ID),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", IEDUP_ORG_ID).eq("do_not_call", true),
        supabase.from("call_logs").select("contact_id").eq("org_id", IEDUP_ORG_ID).not("contact_id", "is", null).not("started_at", "is", null),
      ]);
      const totalN = total.count || 0;
      const dncN = dnc.count || 0;
      const calledN = new Set((calledRows.data || []).map((r: any) => r.contact_id)).size;
      return { total: totalN, called: calledN, pending: Math.max(0, totalN - calledN - dncN), dnc: dncN };
    },
    refetchInterval: REFRESH_MS,
  });

  // Calls within the selected period
  const { data: callRows } = useQuery({
    queryKey: ["iedup-calls", rangeKey],
    queryFn: async () => {
      const { data } = await supabase
        .from("call_logs")
        .select("status, conversation_duration, started_at, created_at")
        .eq("org_id", IEDUP_ORG_ID).eq("caller_type", "ai")
        .gte("created_at", fromIso).lte("created_at", toIso);
      return data || [];
    },
    refetchInterval: REFRESH_MS,
  });

  // WhatsApp within the selected period
  const { data: waRows } = useQuery({
    queryKey: ["iedup-wa", rangeKey],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_logs")
        .select("status, template_name, sent_at, delivered_at, read_at, created_at, cost_charged")
        .eq("org_id", IEDUP_ORG_ID)
        .gte("created_at", fromIso).lte("created_at", toIso);
      return data || [];
    },
    refetchInterval: REFRESH_MS,
  });

  const { data: sub } = useQuery({
    queryKey: ["iedup-subscription"],
    queryFn: async () => (await supabase.from("organization_subscriptions").select("*").eq("org_id", IEDUP_ORG_ID).maybeSingle()).data,
    refetchInterval: REFRESH_MS,
  });

  const { data: settings } = useQuery({
    queryKey: ["iedup-org-settings"],
    queryFn: async () => (await supabase.from("organization_settings").select("dialing_active, calling_windows, updated_at").eq("org_id", IEDUP_ORG_ID).maybeSingle()).data,
    refetchInterval: REFRESH_MS,
  });

  // ---- Derived metrics ------------------------------------------------------
  const calls = useMemo(() => {
    const all = callRows || [];
    const placed = all.length;
    const connected = all.filter((r: any) => Number(r.conversation_duration || 0) >= 5).length;
    const noAnswer = all.filter((r: any) => ["no-answer", "busy", "canceled"].includes(String(r.status))).length;
    const failed = all.filter((r: any) => ["failed", "error"].includes(String(r.status))).length;
    const totalSec = all.reduce((a: number, r: any) => a + Number(r.conversation_duration || 0), 0);
    return { placed, connected, noAnswer, failed, avgSec: placed ? Math.round(totalSec / placed) : 0, costRupees: Math.ceil(totalSec / 60) * 3 };
  }, [callRows]);

  const wa = useMemo(() => {
    const all = waRows || [];
    const sent = all.filter((r: any) => ["sent", "delivered", "read"].includes(String(r.status))).length;
    const delivered = all.filter((r: any) => ["delivered", "read"].includes(String(r.status)) || r.delivered_at).length;
    const opened = all.filter((r: any) => String(r.status) === "read" || r.read_at).length;
    const failed = all.filter((r: any) => String(r.status) === "failed").length;
    const cost = all.reduce((a: number, r: any) => a + Number(r.cost_charged || 0), 0);
    const openRate = sent ? Math.round((opened / sent) * 100) : 0;
    const deliveryRate = sent ? Math.round((delivered / sent) * 100) : 0;
    return { sent, delivered, opened, failed, cost, openRate, deliveryRate };
  }, [waRows]);

  // Per-bucket time series (daily, or weekly for long ranges)
  const trend = useMemo(() => {
    const spanDays = Math.max(1, differenceInCalendarDays(dateRange.to, dateRange.from) + 1);
    const weekly = spanDays > 45;
    const keyOf = (d: Date) => (weekly ? startOfWeek(d, { weekStartsOn: 1 }) : startOfDay(d));
    const labelFmt = weekly ? "MMM d" : "MMM d";

    const buckets = new Map<string, any>();
    const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
    const seeds = weekly
      ? [...new Set(days.map((d) => keyOf(d).toISOString()))].map((s) => new Date(s))
      : days;
    for (const d of seeds) {
      const k = keyOf(d).toISOString();
      buckets.set(k, { key: k, label: format(new Date(k), labelFmt), sent: 0, delivered: 0, opened: 0, placed: 0, connected: 0 });
    }
    const bump = (iso: string | null, fn: (b: any) => void) => {
      if (!iso) return;
      const k = keyOf(new Date(iso)).toISOString();
      const b = buckets.get(k);
      if (b) fn(b);
    };
    (waRows || []).forEach((r: any) => {
      const status = String(r.status);
      if (["sent", "delivered", "read"].includes(status)) bump(r.sent_at || r.created_at, (b) => b.sent++);
      if (["delivered", "read"].includes(status) || r.delivered_at) bump(r.delivered_at || r.sent_at || r.created_at, (b) => b.delivered++);
      if (status === "read" || r.read_at) bump(r.read_at || r.sent_at || r.created_at, (b) => b.opened++);
    });
    (callRows || []).forEach((r: any) => {
      bump(r.started_at || r.created_at, (b) => b.placed++);
      if (Number(r.conversation_duration || 0) >= 5) bump(r.started_at || r.created_at, (b) => b.connected++);
    });
    return Array.from(buckets.values());
  }, [waRows, callRows, dateRange]);

  const byTemplate = useMemo(() => {
    const m = new Map<string, { name: string; sent: number; opened: number }>();
    (waRows || []).forEach((r: any) => {
      const label = templateLabel(r.template_name);
      if (!m.has(label)) m.set(label, { name: label, sent: 0, opened: 0 });
      const e = m.get(label)!;
      if (["sent", "delivered", "read"].includes(String(r.status))) e.sent++;
      if (String(r.status) === "read" || r.read_at) e.opened++;
    });
    return Array.from(m.values()).sort((a, b) => b.sent - a.sent);
  }, [waRows]);

  useEffect(() => {}, []); // refetch handled by react-query intervals

  if (orgLoading) return <DashboardLayout><div className="p-6">Loading…</div></DashboardLayout>;

  const trialDaysLeft = sub?.billing_cycle_start ? daysBetween(new Date(), new Date(sub.next_billing_date)) : null;
  const hasWaData = (waRows || []).length > 0;
  const hasCallData = (callRows || []).length > 0;

  return (
    <DashboardLayout>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">IEDUP Dashboard</h1>
            <p className="text-sm text-muted-foreground">CM YUVA training notifications — calls & WhatsApp at a glance.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={settings?.dialing_active ? "default" : "secondary"} className="text-xs">
              {settings?.dialing_active ? "Dialing ON" : "Dialing OFF"}
            </Badge>
            <DateRangeFilter value={dateRange} onChange={setDateRange} preset={datePreset} onPresetChange={setDatePreset} />
          </div>
        </div>

        {/* Headline KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard icon={<UsersIcon size={16} />} label="Beneficiaries" value={dataCounts?.total ?? "—"} tone="slate" />
          <KpiCard icon={<Clock size={16} />} label="Pending" value={dataCounts?.pending ?? "—"} tone="amber" />
          <KpiCard icon={<Send size={16} />} label="Messages sent" value={wa.sent} tone="blue" />
          <KpiCard icon={<CheckCircle2 size={16} />} label="Delivery rate" value={`${wa.deliveryRate}%`} tone="emerald" />
          <KpiCard icon={<Eye size={16} />} label="Open rate" value={`${wa.openRate}%`} tone="violet" />
          <KpiCard icon={<PhoneCall size={16} />} label="Calls placed" value={calls.placed} tone="indigo" />
        </div>

        {/* Primary trend + funnel */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard className="lg:col-span-2" title="WhatsApp outreach over time" subtitle="Sent → Delivered → Opened">
            {hasWaData ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    {(["sent", "delivered", "opened"] as const).map((k) => (
                      <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C[k]} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={C[k]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} formatter={(v) => <span className="capitalize text-muted-foreground">{v}</span>} />
                  <Area type="monotone" dataKey="sent" stroke={C.sent} strokeWidth={2} fill="url(#g-sent)" />
                  <Area type="monotone" dataKey="delivered" stroke={C.delivered} strokeWidth={2} fill="url(#g-delivered)" />
                  <Area type="monotone" dataKey="opened" stroke={C.opened} strokeWidth={2} fill="url(#g-opened)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Empty>No WhatsApp activity in this period</Empty>}
          </ChartCard>

          <ChartCard title="Delivery funnel" subtitle="This period">
            <div className="flex h-[200px] flex-col justify-center gap-3 px-1">
              <FunnelBar label="Sent" value={wa.sent} total={wa.sent} color={C.sent} />
              <FunnelBar label="Delivered" value={wa.delivered} total={wa.sent} color={C.delivered} />
              <FunnelBar label="Opened" value={wa.opened} total={wa.sent} color={C.opened} />
            </div>
          </ChartCard>
        </div>

        {/* Calls trend + by-template */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ChartCard title="Calls over time" subtitle="Placed vs Connected">
            {hasCallData ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-placed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.placed} stopOpacity={0.35} /><stop offset="95%" stopColor={C.placed} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g-connected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.connected} stopOpacity={0.35} /><stop offset="95%" stopColor={C.connected} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} formatter={(v) => <span className="capitalize text-muted-foreground">{v}</span>} />
                  <Area type="monotone" dataKey="placed" stroke={C.placed} strokeWidth={2} fill="url(#g-placed)" />
                  <Area type="monotone" dataKey="connected" stroke={C.connected} strokeWidth={2} fill="url(#g-connected)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Empty>No calls in this period</Empty>}
          </ChartCard>

          <ChartCard title="By message type" subtitle="Sent vs Opened">
            {byTemplate.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byTemplate} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} formatter={(v) => <span className="capitalize text-muted-foreground">{v}</span>} />
                  <Bar dataKey="sent" fill={C.sent} radius={[0, 4, 4, 0]} barSize={9} />
                  <Bar dataKey="opened" fill={C.opened} radius={[0, 4, 4, 0]} barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty>No WhatsApp activity in this period</Empty>}
          </ChartCard>
        </div>

        {/* Wallet strip */}
        <Card className="border-0 bg-gradient-to-r from-muted/60 to-muted/20">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div><p className="text-muted-foreground">Wallet balance</p><p className="text-lg font-semibold">₹{Number(sub?.wallet_balance ?? 0).toFixed(2)}</p></div>
              <div><p className="text-muted-foreground">Trial / next billing</p><p className="text-lg font-semibold">{sub?.next_billing_date ? `${trialDaysLeft != null ? `${trialDaysLeft} days` : "—"} (${sub.next_billing_date})` : "—"}</p></div>
              <div><p className="text-muted-foreground">Status</p><p className="text-lg font-semibold capitalize">{sub?.subscription_status || "—"}</p></div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm"><Link to="/pipeline">Manage queue</Link></Button>
              <Button size="sm" onClick={() => setTopUpOpen(true)}>Top up wallet</Button>
            </div>
          </CardContent>
        </Card>

        <TopUpWalletDialog open={topUpOpen} onOpenChange={setTopUpOpen} orgId={IEDUP_ORG_ID} />
      </div>
    </DashboardLayout>
  );
}

// ---- Presentational helpers -------------------------------------------------
const TONES: Record<string, string> = {
  slate: "text-slate-600 bg-slate-100 dark:bg-slate-800/50",
  amber: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
  blue: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
  emerald: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
  violet: "text-violet-600 bg-violet-100 dark:bg-violet-900/30",
  indigo: "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30",
};

function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: string }) {
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONES[tone] || TONES.slate}`}>{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
    </section>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</div>
        <div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>
      </CardContent>
    </Card>
  );
}

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{value}{total > 0 && label !== "Sent" ? ` · ${pct}%` : ""}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${total > 0 ? Math.max(pct, value > 0 ? 4 : 0) : 0}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="space-y-1 rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="capitalize text-muted-foreground">{p.dataKey}:</span>
          <span className="font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">{children}</div>;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}
