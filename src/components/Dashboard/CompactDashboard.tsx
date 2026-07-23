import { useMemo, useState } from "react";
import { RiyaTodaySnapshot } from "@/components/Dashboard/RiyaTodaySnapshot";
import { AiAgentsPanel } from "@/components/Dashboard/AiAgentsPanel";
import { RiyaDailyLearnings } from "@/components/Dashboard/RiyaDailyLearnings";
import { RiyaScriptProposal } from "@/components/Dashboard/RiyaScriptProposal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/common/LoadingState";
import DateRangeFilter, { DateRangePreset, getDateRangeFromPreset } from "@/components/common/DateRangeFilter";
import { CallRecordingPlayer } from "@/components/Contact/CallRecordingPlayer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useNotification } from "@/hooks/useNotification";
import { Users, Target, Phone, Mail, MessageCircle, TrendingUp, RefreshCw, Sparkles, ArrowRight, Search, GraduationCap, Award, AlertCircle, Dumbbell, Drama, Bot, PlayCircle, PauseCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { format, eachDayOfInterval } from "date-fns";
import { EChart } from "@/components/charts/EChart";
import type { EChartsOption } from "echarts";

interface Props {
  orgId: string;
}

const DISPO_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

// Rich stacked-area ECharts option: soft vertical gradients, smooth curves and
// a hover crosshair — the same visual language as the ROI/analytics pages.
function stackedAreaOption(
  rows: Array<Record<string, any>>,
  seriesNames: string[],
  colors: string[],
  opts: { smallText?: boolean } = {},
): EChartsOption {
  const f = opts.smallText ? 9 : 11;
  const alpha = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  return {
    grid: { top: 28, left: 8, right: 12, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "rgba(148,163,184,.55)", width: 1, type: "dashed" } },
      backgroundColor: "rgba(15,23,42,.94)",
      borderWidth: 0,
      textStyle: { color: "#e2e8f0", fontSize: 11 },
      padding: [8, 12],
    },
    legend: {
      show: true, top: 0, right: 0, icon: "roundRect",
      itemWidth: 9, itemHeight: 9, itemGap: 12,
      textStyle: { fontSize: f, color: "#64748b" },
    },
    xAxis: {
      type: "category",
      data: rows.map((r) => r.date),
      boundaryGap: false,
      axisLine: { lineStyle: { color: "rgba(148,163,184,.25)" } },
      axisTick: { show: false },
      axisLabel: { fontSize: f, color: "#94a3b8", hideOverlap: true },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: "rgba(148,163,184,.16)", type: "dashed" } },
      axisLabel: { fontSize: f, color: "#94a3b8" },
    },
    series: seriesNames.map((name, i) => {
      const c = colors[i % colors.length];
      return {
        name, type: "line", stack: "total", smooth: 0.42, showSymbol: false,
        symbol: "circle", symbolSize: 7,
        lineStyle: { width: 2, color: c },
        itemStyle: { color: c, borderWidth: 2, borderColor: "#fff" },
        emphasis: { focus: "series", scale: true },
        areaStyle: {
          opacity: 1,
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: alpha(c, 0.5) },
              { offset: 1, color: alpha(c, 0.02) },
            ],
          },
        },
        data: rows.map((r) => r[name] ?? 0),
      };
    }),
  } as EChartsOption;
}

export function CompactDashboard({ orgId }: Props) {
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [datePreset, setDatePreset] = useState<DateRangePreset>("this_month");
  const [dateRange, setDateRange] = useState(() => getDateRangeFromPreset("this_month"));
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fromISO = dateRange.from.toISOString();
  const toISO = dateRange.to.toISOString();
  const fromKey = format(dateRange.from, "yyyy-MM-dd");
  const toKey = format(dateRange.to, "yyyy-MM-dd");

  // New leads in range
  const { data: newLeads = 0 } = useQuery({
    queryKey: ["cd-new-leads", orgId, fromKey, toKey],
    queryFn: async () => {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("created_at", fromISO)
        .lte("created_at", toISO);
      return count || 0;
    },
  });

  // Active pipeline (contacts in any stage that isn't Won/Lost)
  const { data: pipelineCounts } = useQuery({
    queryKey: ["cd-pipeline", orgId],
    queryFn: async () => {
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("org_id", orgId);
      const wonId = stages?.find((s) => s.name?.toLowerCase() === "won")?.id;
      const lostId = stages?.find((s) => s.name?.toLowerCase() === "lost")?.id;
      const terminalIds = [wonId, lostId].filter(Boolean) as string[];

      const [active, won, lost] = await Promise.all([
        terminalIds.length > 0
          ? supabase
              .from("contacts")
              .select("id", { count: "exact", head: true })
              .eq("org_id", orgId)
              .not("pipeline_stage_id", "in", `(${terminalIds.join(",")})`)
          : supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        wonId
          ? supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("pipeline_stage_id", wonId)
          : Promise.resolve({ count: 0 } as any),
        lostId
          ? supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("pipeline_stage_id", lostId)
          : Promise.resolve({ count: 0 } as any),
      ]);
      return {
        active: active.count || 0,
        won: won.count || 0,
        lost: lost.count || 0,
      };
    },
  });

  // Call logs in range (for chart + leaderboard + total + table)
  const { data: callLogs = [] } = useQuery({
    queryKey: ["cd-calls", orgId, fromKey, toKey],
    queryFn: async () => {
      const { data } = await supabase
        .from("call_logs")
        .select(`
          id, agent_id, disposition_id, started_at, created_at,
          call_type, from_number, to_number, status,
          call_duration, conversation_duration, recording_url,
          transcript, analysis_summary, analysis_tone,
          analysis_script_adherence, analysis_objections,
          analysis_next_step, analysis_quality_score, analysis_status,
          contacts:contact_id (first_name, last_name),
          call_dispositions:disposition_id (name, category)
        `)
        .eq("org_id", orgId)
        .eq("caller_type", "human")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const [callSearch, setCallSearch] = useState("");
  const [selectedAnalysisLog, setSelectedAnalysisLog] = useState<any | null>(null);
  const filteredCallLogs = useMemo(() => {
    if (!callSearch.trim()) return callLogs;
    const q = callSearch.toLowerCase();
    return callLogs.filter((log: any) => {
      const name = log.contacts ? `${log.contacts.first_name} ${log.contacts.last_name || ""}`.toLowerCase() : "";
      return (
        name.includes(q) ||
        (log.from_number || "").includes(q) ||
        (log.to_number || "").includes(q)
      );
    });
  }, [callLogs, callSearch]);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Emails sent in range
  const { data: emailLogs = [] } = useQuery({
    queryKey: ["cd-emails", orgId, fromKey, toKey],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_conversations")
        .select("id, sent_by, sent_at")
        .eq("org_id", orgId)
        .eq("direction", "outbound")
        .gte("sent_at", fromISO)
        .lte("sent_at", toISO);
      return data || [];
    },
  });

  // WhatsApp sent in range
  const { data: waLogs = [] } = useQuery({
    queryKey: ["cd-whatsapp", orgId, fromKey, toKey],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("id, sent_by, sent_at, status")
        .eq("org_id", orgId)
        .gte("sent_at", fromISO)
        .lte("sent_at", toISO);
      return data || [];
    },
  });

  // ===== AI Caller =====
  const { data: aiScript } = useQuery({
    queryKey: ["cd-ai-script", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_call_scripts")
        .select("*")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: aiCallStats } = useQuery({
    queryKey: ["cd-ai-stats", orgId],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayISO = todayStart.toISOString();

      const [{ count: dialed }, { count: connected }, { count: inFlight }, { count: queued }] = await Promise.all([
        supabase.from("call_logs").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).eq("caller_type", "ai").gte("created_at", todayISO),
        supabase.from("call_logs").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).eq("caller_type", "ai")
          .gte("created_at", todayISO).gte("conversation_duration", 5),
        supabase.from("call_logs").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).eq("caller_type", "ai").eq("status", "in_progress"),
        supabase.from("call_logs").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).eq("caller_type", "ai").eq("status", "queued"),
      ]);

      return {
        dialed: dialed || 0,
        connected: connected || 0,
        inFlight: inFlight || 0,
        queued: queued || 0,
      };
    },
    refetchInterval: 30000,
  });

  const { data: aiRecentCalls = [] } = useQuery({
    queryKey: ["cd-ai-recent", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("call_logs")
        .select(`
          id, status, started_at, ended_at, conversation_duration, call_duration, to_number,
          analysis_quality_score, analysis_status,
          analysis_summary, analysis_tone, analysis_objections, analysis_next_step,
          analysis_script_adherence, transcript, recording_url,
          contacts:contact_id (first_name, last_name)
        `)
        .eq("org_id", orgId)
        .eq("caller_type", "ai")
        .order("created_at", { ascending: false })
        .limit(30);
      return data || [];
    },
    refetchInterval: 30000,
  });

  // Working window status (client-side check)
  const aiWindowStatus = (() => {
    const now = new Date();
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMin = (utcMin + 5 * 60 + 30) % (24 * 60);
    if (istMin >= 660 && istMin < 810) return { active: true, label: "Calling (11:00 – 13:30)" };
    if (istMin >= 810 && istMin < 900) return { active: false, label: "Lunch break (13:30 – 15:00)" };
    if (istMin >= 900 && istMin < 1020) return { active: true, label: "Calling (15:00 – 17:00)" };
    return { active: false, label: "Outside calling hours (11:00 – 17:00 IST)" };
  })();

  // Coaching plans per agent
  const { data: coachingPlans = [] } = useQuery({
    queryKey: ["cd-coaching-plans", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_coaching_plans")
        .select("*")
        .eq("org_id", orgId)
        .order("avg_quality_score", { ascending: true });
      return data || [];
    },
  });

  const [regeneratingAgentId, setRegeneratingAgentId] = useState<string | null>(null);
  const handleRegenerate = async (agentId: string) => {
    setRegeneratingAgentId(agentId);
    try {
      const { error } = await supabase.functions.invoke("generate-coaching-plans", {
        body: { agent_id: agentId },
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["cd-coaching-plans"] });
      notify.success("Coaching plan refreshed");
    } catch (err: any) {
      notify.error("Failed to refresh", err?.message || String(err));
    } finally {
      setRegeneratingAgentId(null);
    }
  };

  // AI insights — top 3 high priority active
  const { data: aiInsights = [] } = useQuery({
    queryKey: ["cd-ai-insights", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_insights")
        .select("id, title, description, priority, insight_type, suggested_action, created_at")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(3);
      return data || [];
    },
  });

  // Profiles for leaderboard names
  const { data: profilesMap = {} } = useQuery({
    queryKey: ["cd-profiles", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .eq("org_id", orgId);
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => {
        m[p.id] = `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unknown";
      });
      return m;
    },
  });

  // Build day list for chart x-axis
  const dayList = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
    return days.map((d) => format(d, "yyyy-MM-dd"));
  }, [dateRange.from, dateRange.to]);

  // Disposition area chart data: [{ date, "Demo Booked": 2, "Not Interested": 1, ... }]
  const { dispoChartData, dispoNames } = useMemo(() => {
    const dispoSet = new Set<string>();
    const perDay: Record<string, Record<string, number>> = {};
    dayList.forEach((d) => (perDay[d] = {}));

    callLogs.forEach((row: any) => {
      const day = format(new Date(row.created_at), "yyyy-MM-dd");
      const dispoName = row.call_dispositions?.name || "Not Set";
      dispoSet.add(dispoName);
      if (!perDay[day]) perDay[day] = {};
      perDay[day][dispoName] = (perDay[day][dispoName] || 0) + 1;
    });

    const names = Array.from(dispoSet);
    const data = dayList.map((d) => {
      const row: any = { date: format(new Date(d), "MMM d") };
      names.forEach((n) => {
        row[n] = perDay[d]?.[n] || 0;
      });
      return row;
    });
    return { dispoChartData: data, dispoNames: names };
  }, [callLogs, dayList]);

  // Email + WhatsApp timeline
  const commsChartData = useMemo(() => {
    const perDay: Record<string, { emails: number; whatsapp: number }> = {};
    dayList.forEach((d) => (perDay[d] = { emails: 0, whatsapp: 0 }));
    emailLogs.forEach((row: any) => {
      const day = format(new Date(row.sent_at), "yyyy-MM-dd");
      if (perDay[day]) perDay[day].emails += 1;
    });
    waLogs.forEach((row: any) => {
      const day = format(new Date(row.sent_at), "yyyy-MM-dd");
      if (perDay[day]) perDay[day].whatsapp += 1;
    });
    return dayList.map((d) => ({
      date: format(new Date(d), "MMM d"),
      Emails: perDay[d].emails,
      WhatsApp: perDay[d].whatsapp,
    }));
  }, [emailLogs, waLogs, dayList]);

  // Leaderboard: combine calls + emails + WA per agent
  const leaderboard = useMemo(() => {
    const m: Record<string, { id: string; calls: number; emails: number; whatsapp: number }> = {};
    const add = (id: string | null, key: "calls" | "emails" | "whatsapp") => {
      if (!id) return;
      if (!m[id]) m[id] = { id, calls: 0, emails: 0, whatsapp: 0 };
      m[id][key] += 1;
    };
    callLogs.forEach((r: any) => add(r.agent_id, "calls"));
    emailLogs.forEach((r: any) => add(r.sent_by, "emails"));
    waLogs.forEach((r: any) => add(r.sent_by, "whatsapp"));
    return Object.values(m)
      .map((r) => ({
        ...r,
        name: profilesMap[r.id] || "Unknown",
        total: r.calls + r.emails + r.whatsapp,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [callLogs, emailLogs, waLogs, profilesMap]);

  const totalCalls = callLogs.length;
  const totalEmails = emailLogs.length;
  const totalWa = waLogs.length;
  const activePipeline = pipelineCounts?.active ?? 0;
  const dealsWon = pipelineCounts?.won ?? 0;
  const dealsLost = pipelineCounts?.lost ?? 0;
  const winRate = dealsWon + dealsLost > 0 ? Math.round((dealsWon / (dealsWon + dealsLost)) * 100) : 0;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["cd-new-leads"] });
    await queryClient.invalidateQueries({ queryKey: ["cd-pipeline"] });
    await queryClient.invalidateQueries({ queryKey: ["cd-calls"] });
    await queryClient.invalidateQueries({ queryKey: ["cd-emails"] });
    await queryClient.invalidateQueries({ queryKey: ["cd-whatsapp"] });
    await queryClient.invalidateQueries({ queryKey: ["cd-ai-insights"] });
    setIsRefreshing(false);
  };

  const kpis: Array<{ label: string; value: number | string; icon: any; color: string; bg: string }> = [
    { label: "New Leads", value: newLeads, icon: Users, color: "text-blue-500", bg: "from-blue-500/10 to-blue-600/5" },
    { label: "Active Pipeline", value: activePipeline, icon: Target, color: "text-violet-500", bg: "from-violet-500/10 to-violet-600/5" },
    { label: "Calls", value: totalCalls, icon: Phone, color: "text-emerald-500", bg: "from-emerald-500/10 to-emerald-600/5" },
    { label: "Emails", value: totalEmails, icon: Mail, color: "text-amber-500", bg: "from-amber-500/10 to-amber-600/5" },
    { label: "WhatsApp", value: totalWa, icon: MessageCircle, color: "text-green-600", bg: "from-green-500/10 to-green-600/5" },
    { label: "Win Rate", value: `${winRate}%`, icon: TrendingUp, color: "text-primary", bg: "from-primary/10 to-primary/5" },
  ];

  return (
    <div className="space-y-3">
      {/* Top strip */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">Compact overview · In-Sync Demo</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing" : "Refresh"}
          </Button>
          <DateRangeFilter
            value={dateRange}
            onChange={setDateRange}
            preset={datePreset}
            onPresetChange={setDatePreset}
          />
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="call-logs">Call Logs</TabsTrigger>
          <TabsTrigger value="coaching">Agent Coaching</TabsTrigger>
          <TabsTrigger value="ai-caller">AI Caller</TabsTrigger>
          <TabsTrigger value="ai-agents">AI Agents</TabsTrigger>
        </TabsList>

        <TabsContent value="ai-agents" className="mt-3">
          <AiAgentsPanel />
        </TabsContent>

        <TabsContent value="overview" className="space-y-3 mt-3">
      {/* KPI cards */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className={`p-3 bg-gradient-to-br ${k.bg} border-border/50`}>
              <div className="flex items-start justify-between mb-2">
                <span className="text-[11px] font-medium text-muted-foreground">{k.label}</span>
                <div className="p-1 rounded bg-background/60">
                  <Icon className={`h-3 w-3 ${k.color}`} />
                </div>
              </div>
              <div className="text-xl font-bold tracking-tight">{k.value}</div>
            </Card>
          );
        })}
      </div>

      {/* Calling timeline by disposition */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">Calls by Disposition</h3>
            <p className="text-[11px] text-muted-foreground">Daily total stacked by call outcome</p>
          </div>
          <Badge variant="outline" className="text-[10px]">{totalCalls} calls</Badge>
        </div>
        <div className="h-[280px]">
          {dispoNames.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              No calls in this period
            </div>
          ) : (
            <EChart
              option={stackedAreaOption(dispoChartData as any, dispoNames as string[], DISPO_COLORS)}
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </div>
      </Card>

      {/* All-agents AI learnings — the lump. No human agents, so the Overview carries it.
          Per-agent learnings live on the AI Agents page. */}
      <RiyaDailyLearnings product="__all__" />

      {/* Bottom row: Email/WA timeline · AI insights */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
        {/* Email + WhatsApp timeline */}
        <Card className="p-3">
          <div className="mb-2">
            <h3 className="text-sm font-semibold">Email & WhatsApp</h3>
            <p className="text-[11px] text-muted-foreground">{totalEmails} emails · {totalWa} WhatsApp sent</p>
          </div>
          <div className="h-[200px]">
            <EChart
              option={stackedAreaOption(commsChartData as any, ["Emails", "WhatsApp"], ["#f59e0b", "#22c55e"], { smallText: true })}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </Card>

        {/* AI Insights */}
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                AI Insights
              </h3>
              <p className="text-[11px] text-muted-foreground">Top priority signals</p>
            </div>
            <Button variant="ghost" size="sm" asChild className="h-7 text-[11px]">
              <Link to="/campaigns/ai-insights" className="gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
          <div className="space-y-2 max-h-[200px] overflow-auto pr-1">
            {aiInsights.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">No active insights</div>
            ) : (
              aiInsights.map((insight: any) => (
                <div key={insight.id} className="border border-border/50 rounded-md p-2 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium leading-snug">{insight.title}</p>
                    <Badge
                      variant="outline"
                      className={
                        insight.priority === "high"
                          ? "text-[9px] h-4 border-red-500/40 text-red-600 bg-red-500/5"
                          : insight.priority === "medium"
                          ? "text-[9px] h-4 border-amber-500/40 text-amber-600 bg-amber-500/5"
                          : "text-[9px] h-4 border-muted-foreground/30 text-muted-foreground"
                      }
                    >
                      {insight.priority}
                    </Badge>
                  </div>
                  {insight.description && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{insight.description}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="call-logs" className="mt-3">
          <Card className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold">Call Logs</h3>
                <p className="text-[11px] text-muted-foreground">{filteredCallLogs.length} call{filteredCallLogs.length === 1 ? "" : "s"} in selected date range</p>
              </div>
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name or phone"
                  value={callSearch}
                  onChange={(e) => setCallSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
            <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="py-2 text-xs">Date & Time</TableHead>
                    <TableHead className="py-2 text-xs">Contact</TableHead>
                    <TableHead className="py-2 text-xs">Phone</TableHead>
                    <TableHead className="py-2 text-xs">Agent</TableHead>
                    <TableHead className="py-2 text-xs">Type</TableHead>
                    <TableHead className="py-2 text-xs">Duration</TableHead>
                    <TableHead className="py-2 text-xs">Disposition</TableHead>
                    <TableHead className="py-2 text-xs">Recording</TableHead>
                    <TableHead className="py-2 text-xs">AI Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCallLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                        No calls match the current filter
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCallLogs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="py-1.5 text-xs">
                          {log.started_at ? format(new Date(log.started_at), "MMM d, h:mm a") : "—"}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs font-medium">
                          {log.contacts ? `${log.contacts.first_name} ${log.contacts.last_name || ""}`.trim() : "Unknown"}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs font-mono">
                          {log.call_type === "outbound" ? log.to_number : log.from_number}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs">
                          {profilesMap[log.agent_id] || "—"}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Badge variant={log.call_type === "inbound" ? "default" : "secondary"} className="text-[10px] h-5">
                            {log.call_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1.5 text-xs">
                          {formatDuration(log.conversation_duration ?? log.call_duration)}
                        </TableCell>
                        <TableCell className="py-1.5">
                          {log.call_dispositions ? (
                            <Badge variant="outline" className="text-[10px] h-5">{log.call_dispositions.name}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] h-5 opacity-50">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          {log.recording_url ? (
                            <CallRecordingPlayer callLogId={log.id} />
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          {log.analysis_status === "ok" && typeof log.analysis_quality_score === "number" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 gap-1 text-[11px]"
                              onClick={() => setSelectedAnalysisLog(log)}
                            >
                              <Sparkles className="h-3 w-3 text-violet-500" />
                              <span className={
                                log.analysis_quality_score >= 7
                                  ? "text-emerald-600 font-semibold"
                                  : log.analysis_quality_score >= 5
                                  ? "text-amber-600 font-semibold"
                                  : "text-red-600 font-semibold"
                              }>
                                {log.analysis_quality_score}/10
                              </span>
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="coaching" className="mt-3 space-y-3">
          {coachingPlans.length === 0 ? (
            <Card className="p-6 text-center">
              <GraduationCap className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">No coaching plans yet</p>
              <p className="text-[11px] text-muted-foreground">
                Plans are generated daily at 6:40 PM for SDRs with at least 5 analyzed calls.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              {coachingPlans.map((plan: any) => {
                const name = profilesMap[plan.agent_id] || "Unknown agent";
                const score = Number(plan.avg_quality_score || 0);
                const lowestScoreCalls = (callLogs as any[])
                  .filter((c) => c.agent_id === plan.agent_id && c.analysis_status === "ok" && typeof c.analysis_quality_score === "number")
                  .sort((a, b) => a.analysis_quality_score - b.analysis_quality_score)
                  .slice(0, 3);

                return (
                  <Card key={plan.id} className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold">{name}</h3>
                        <p className="text-[11px] text-muted-foreground">
                          {plan.calls_analyzed} calls analyzed · dominant tone: <span className="capitalize">{plan.dominant_tone}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className={
                            "text-2xl font-bold leading-none " +
                            (score >= 7 ? "text-emerald-600" : score >= 5 ? "text-amber-600" : "text-red-600")
                          }>
                            {score.toFixed(1)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">avg score</div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={regeneratingAgentId === plan.agent_id}
                          onClick={() => handleRegenerate(plan.agent_id)}
                          title="Regenerate plan now"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${regeneratingAgentId === plan.agent_id ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </div>

                    {plan.generation_error ? (
                      <div className="text-xs text-red-600 bg-red-50 rounded p-2">
                        Plan generation failed: {plan.generation_error}
                      </div>
                    ) : (
                      <>
                        {/* Top objections */}
                        {Array.isArray(plan.top_objections) && plan.top_objections.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                              Top objections raised against this SDR
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {plan.top_objections.map((o: any, i: number) => (
                                <Badge key={i} variant="secondary" className="text-[10px] h-5">
                                  {o.objection} <span className="ml-1 opacity-60">×{o.count}</span>
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Strengths */}
                        {Array.isArray(plan.strengths) && plan.strengths.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <Award className="h-3 w-3" /> Strengths
                            </div>
                            <ul className="text-xs space-y-1 list-disc list-inside text-foreground/90">
                              {plan.strengths.map((s: string, i: number) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Weaknesses */}
                        {Array.isArray(plan.weaknesses) && plan.weaknesses.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> Areas to improve
                            </div>
                            <div className="space-y-2">
                              {plan.weaknesses.map((w: any, i: number) => (
                                <div key={i} className="text-xs border-l-2 border-red-400/50 pl-2.5 space-y-0.5">
                                  <p className="font-medium">{w.pattern}</p>
                                  <p className="text-muted-foreground text-[11px]"><span className="font-medium">Evidence:</span> {w.evidence}</p>
                                  <p className="text-[11px]"><span className="font-medium text-emerald-700">Fix:</span> {w.fix}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Drills */}
                        {Array.isArray(plan.drills) && plan.drills.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <Dumbbell className="h-3 w-3" /> Drills this week
                            </div>
                            <ul className="text-xs space-y-1 list-disc list-inside text-foreground/90">
                              {plan.drills.map((d: string, i: number) => (
                                <li key={i}>{d}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Role-plays */}
                        {Array.isArray(plan.role_play_scenarios) && plan.role_play_scenarios.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <Drama className="h-3 w-3" /> Role-play scenarios
                            </div>
                            <div className="space-y-2">
                              {plan.role_play_scenarios.map((r: any, i: number) => (
                                <div key={i} className="text-xs bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/50 rounded p-2 space-y-1">
                                  <p>{r.scenario}</p>
                                  <p className="text-[11px] text-muted-foreground"><span className="font-medium">Why:</span> {r.why}</p>
                                  <p className="text-[11px] text-emerald-700"><span className="font-medium">Win when:</span> {r.success_criteria}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Lowest-scoring calls to review */}
                        {lowestScoreCalls.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                              Lowest-scoring calls to review
                            </div>
                            <div className="space-y-1">
                              {lowestScoreCalls.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => setSelectedAnalysisLog(c)}
                                  className="w-full text-left text-xs border rounded p-1.5 hover:bg-muted/50 transition flex items-center gap-2"
                                >
                                  <span className={
                                    "font-bold text-xs " +
                                    (c.analysis_quality_score >= 5 ? "text-amber-600" : "text-red-600")
                                  }>
                                    {c.analysis_quality_score}/10
                                  </span>
                                  <span className="truncate flex-1 text-muted-foreground">
                                    {c.contacts ? `${c.contacts.first_name} ${c.contacts.last_name || ""}`.trim() : "Unknown"} · {c.started_at ? format(new Date(c.started_at), "MMM d") : ""}
                                  </span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground pt-1 border-t">
                          Generated {plan.generated_at ? format(new Date(plan.generated_at), "MMM d, h:mm a") : ""}
                        </p>
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* AI CALLER */}
        <TabsContent value="ai-caller" className="mt-3 space-y-3">
          <RiyaTodaySnapshot />
          <RiyaDailyLearnings />

          {/* Status bar */}
          <Card className="p-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-full bg-violet-500/10">
                  <Bot className="h-4 w-4 text-violet-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">AI Caller</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {aiScript ? `Active script: ${aiScript.name}` : "No active script"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {aiWindowStatus.active ? (
                  <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                    <PlayCircle className="h-3 w-3 mr-1" /> {aiWindowStatus.label}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    <PauseCircle className="h-3 w-3 mr-1" /> {aiWindowStatus.label}
                  </Badge>
                )}
                {(aiCallStats?.inFlight || 0) > 0 && (
                  <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/30">
                    <Phone className="h-3 w-3 mr-1 animate-pulse" /> On a call
                  </Badge>
                )}
              </div>
            </div>
          </Card>

          <RiyaScriptProposal orgId={orgId} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedAnalysisLog} onOpenChange={(o) => !o && setSelectedAnalysisLog(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Call Analysis
            </DialogTitle>
            <DialogDescription>
              {selectedAnalysisLog?.contacts
                ? `${selectedAnalysisLog.contacts.first_name} ${selectedAnalysisLog.contacts.last_name || ""}`.trim()
                : "Unknown contact"}
              {selectedAnalysisLog?.started_at && (
                <span className="ml-2">· {format(new Date(selectedAnalysisLog.started_at), "MMM d, yyyy h:mm a")}</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedAnalysisLog && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <div className="flex flex-col items-center justify-center min-w-[64px]">
                  <div className={
                    "text-3xl font-bold " +
                    (selectedAnalysisLog.analysis_quality_score >= 7
                      ? "text-emerald-600"
                      : selectedAnalysisLog.analysis_quality_score >= 5
                      ? "text-amber-600"
                      : "text-red-600")
                  }>
                    {selectedAnalysisLog.analysis_quality_score}
                  </div>
                  <div className="text-[10px] text-muted-foreground">out of 10</div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="text-[11px] text-muted-foreground">Agent tone</div>
                  <Badge variant="outline" className="capitalize">
                    {selectedAnalysisLog.analysis_tone || "—"}
                  </Badge>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Summary</div>
                <p className="text-sm leading-relaxed">{selectedAnalysisLog.analysis_summary}</p>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Script adherence</div>
                <p className="text-sm leading-relaxed">{selectedAnalysisLog.analysis_script_adherence}</p>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Top objections</div>
                {Array.isArray(selectedAnalysisLog.analysis_objections) && selectedAnalysisLog.analysis_objections.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAnalysisLog.analysis_objections.map((obj: string, idx: number) => (
                      <Badge key={idx} variant="secondary" className="text-[11px]">{obj}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No objections raised</p>
                )}
              </div>

              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Next step</div>
                <p className="text-sm leading-relaxed">{selectedAnalysisLog.analysis_next_step}</p>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Transcript</div>
                <div className="text-xs bg-muted/40 rounded-md p-3 max-h-[260px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {selectedAnalysisLog.transcript || "(empty transcript)"}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
