import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { LoadingState } from "@/components/common/LoadingState";
import DateRangeFilter, { DateRangePreset, getDateRangeFromPreset } from "@/components/common/DateRangeFilter";
import { CallRecordingPlayer } from "@/components/Contact/CallRecordingPlayer";
import { useNotification } from "@/hooks/useNotification";
import { Phone, Mail, MessageCircle, TrendingUp, RefreshCw, Sparkles, ArrowRight, Award, AlertCircle, Dumbbell, Drama, Clock, CalendarDays, CheckCircle2, XCircle } from "lucide-react";
import { format, eachDayOfInterval, differenceInCalendarDays, addDays, startOfMonth, endOfMonth, subDays } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { UrlTabs } from "@/components/UrlTabs";
import { useUrlDateRange } from "@/hooks/useUrlDateRange";

interface Props {
  orgId: string;
}

const DISPO_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

export function SDRDashboard({ orgId }: Props) {
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [datePreset, setDatePreset, dateRange, setDateRange] = useUrlDateRange("this_month");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedAnalysisLog, setSelectedAnalysisLog] = useState<any | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const fromISO = dateRange.from.toISOString();
  const toISO = dateRange.to.toISOString();
  const fromKey = format(dateRange.from, "yyyy-MM-dd");
  const toKey = format(dateRange.to, "yyyy-MM-dd");
  const todayKey = format(new Date(), "yyyy-MM-dd");

  // Profile (for name + created_at = start date)
  const { data: profile } = useQuery({
    queryKey: ["sdr-profile", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, created_at")
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  // My calls
  const { data: callLogs = [] } = useQuery({
    queryKey: ["sdr-calls", userId, fromKey, toKey],
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
        .eq("agent_id", userId)
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!userId,
  });

  // My emails sent
  const { data: emailCount = 0 } = useQuery({
    queryKey: ["sdr-emails", userId, fromKey, toKey],
    queryFn: async () => {
      const { count } = await supabase
        .from("email_conversations")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("sent_by", userId)
        .eq("direction", "outbound")
        .gte("sent_at", fromISO)
        .lte("sent_at", toISO);
      return count || 0;
    },
    enabled: !!userId,
  });

  // My WhatsApp sent
  const { data: waCount = 0 } = useQuery({
    queryKey: ["sdr-whatsapp", userId, fromKey, toKey],
    queryFn: async () => {
      const { count } = await supabase
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("sent_by", userId)
        .gte("sent_at", fromISO)
        .lte("sent_at", toISO);
      return count || 0;
    },
    enabled: !!userId,
  });

  // My coaching plan
  const { data: coachingPlan } = useQuery({
    queryKey: ["sdr-coaching-plan", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_coaching_plans")
        .select("*")
        .eq("org_id", orgId)
        .eq("agent_id", userId)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  // Last 7 days attendance
  const { data: attendance = [] } = useQuery({
    queryKey: ["sdr-attendance", userId],
    queryFn: async () => {
      const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
      const { data } = await supabase
        .from("attendance_records")
        .select("date, sign_in_time, sign_out_time, total_hours, status")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .gte("date", since)
        .order("date", { ascending: false });
      return data || [];
    },
    enabled: !!userId,
  });

  // Days present this month
  const { data: daysPresentThisMonth = 0 } = useQuery({
    queryKey: ["sdr-days-present", userId],
    queryFn: async () => {
      const from = format(startOfMonth(new Date()), "yyyy-MM-dd");
      const to = format(endOfMonth(new Date()), "yyyy-MM-dd");
      const { count } = await supabase
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .gte("date", from)
        .lte("date", to)
        .in("status", ["present", "half_day"]);
      return count || 0;
    },
    enabled: !!userId,
  });

  // Leave balance (current year)
  const currentYear = new Date().getFullYear();
  const { data: leaveBalance } = useQuery({
    queryKey: ["sdr-leave-balance", userId, currentYear],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_balances")
        .select("*")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("year", currentYear)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
  });

  // Recent leave applications
  const { data: leaveApplications = [] } = useQuery({
    queryKey: ["sdr-leave-applications", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_applications")
        .select("id, leave_type, start_date, end_date, total_days, status, applied_at")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .order("applied_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!userId,
  });

  // Build day list
  const dayList = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.from, end: dateRange.to })
      .map((d) => format(d, "yyyy-MM-dd"));
  }, [dateRange.from, dateRange.to]);

  // Disposition stacked area chart data
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
      names.forEach((n) => { row[n] = perDay[d]?.[n] || 0; });
      return row;
    });
    return { dispoChartData: data, dispoNames: names };
  }, [callLogs, dayList]);

  const totalCalls = callLogs.length;
  const analyzedCalls = (callLogs as any[]).filter((c) => c.analysis_status === "ok");
  const avgScore = analyzedCalls.length > 0
    ? analyzedCalls.reduce((s, c) => s + (c.analysis_quality_score || 0), 0) / analyzedCalls.length
    : 0;

  // Today's attendance
  const todayAttendance = (attendance as any[]).find((a) => a.date === todayKey);

  // Leave eligibility — month 2 onwards (30 days from start)
  const startDate = profile?.created_at ? new Date(profile.created_at) : null;
  const leaveEligibleDate = startDate ? addDays(startDate, 30) : null;
  const isLeaveEligible = leaveEligibleDate ? new Date() >= leaveEligibleDate : false;
  const daysToEligible = leaveEligibleDate
    ? Math.max(0, differenceInCalendarDays(leaveEligibleDate, new Date()))
    : 0;

  // SDR-specific leave balance: 7 SL + 7 CL = 14/yr, 0 EL until 1yr
  const sdrSL = leaveBalance ? Math.min(Number(leaveBalance.sick_leave_balance ?? 0), 7) : 7;
  const sdrCL = leaveBalance ? Math.min(Number(leaveBalance.casual_leave_balance ?? 0), 7) : 7;
  const totalLeaveLeft = sdrSL + sdrCL;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sdr-calls"] }),
      queryClient.invalidateQueries({ queryKey: ["sdr-emails"] }),
      queryClient.invalidateQueries({ queryKey: ["sdr-whatsapp"] }),
      queryClient.invalidateQueries({ queryKey: ["sdr-attendance"] }),
      queryClient.invalidateQueries({ queryKey: ["sdr-leave-balance"] }),
      queryClient.invalidateQueries({ queryKey: ["sdr-coaching-plan"] }),
    ]);
    setIsRefreshing(false);
  };

  const handleRegenerate = async () => {
    if (!userId) return;
    setRegenerating(true);
    try {
      const { error } = await supabase.functions.invoke("generate-coaching-plans", {
        body: { agent_id: userId },
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["sdr-coaching-plan"] });
      notify.success("Coaching plan refreshed");
    } catch (err: any) {
      notify.error("Failed to refresh", err?.message || String(err));
    } finally {
      setRegenerating(false);
    }
  };

  if (!userId || !profile) {
    return <LoadingState message="Loading your dashboard..." />;
  }

  const firstName = profile.first_name || "there";
  const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();

  const kpis: Array<{ label: string; value: number | string; sub?: string; icon: any; color: string; bg: string }> = [
    { label: "My Calls", value: totalCalls, icon: Phone, color: "text-emerald-500", bg: "from-emerald-500/10 to-emerald-600/5" },
    { label: "My Emails", value: emailCount, icon: Mail, color: "text-amber-500", bg: "from-amber-500/10 to-amber-600/5" },
    { label: "My WhatsApp", value: waCount, icon: MessageCircle, color: "text-green-600", bg: "from-green-500/10 to-green-600/5" },
    {
      label: "Avg Score",
      value: avgScore > 0 ? avgScore.toFixed(1) : "—",
      sub: `${analyzedCalls.length} analyzed`,
      icon: TrendingUp,
      color: "text-violet-500",
      bg: "from-violet-500/10 to-violet-600/5",
    },
    {
      label: "Leave Balance",
      value: isLeaveEligible ? `${totalLeaveLeft}` : "—",
      sub: isLeaveEligible ? `of 14 days left` : `eligible in ${daysToEligible}d`,
      icon: CalendarDays,
      color: "text-blue-500",
      bg: "from-blue-500/10 to-blue-600/5",
    },
    {
      label: "Days Present",
      value: daysPresentThisMonth,
      sub: format(new Date(), "MMMM"),
      icon: CheckCircle2,
      color: "text-primary",
      bg: "from-primary/10 to-primary/5",
    },
  ];

  return (
    <div className="space-y-3">
      {/* Top strip */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Hi {firstName} 👋</h1>
          <p className="text-xs text-muted-foreground">
            {todayAttendance?.sign_in_time
              ? `Signed in today at ${format(new Date(todayAttendance.sign_in_time), "h:mm a")}`
              : "Not signed in yet today"}
          </p>
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
              {k.sub && <div className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</div>}
            </Card>
          );
        })}
      </div>

      <UrlTabs param="sdrdashboard_tab" defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">My Performance</TabsTrigger>
          <TabsTrigger value="coaching">My Coaching</TabsTrigger>
          <TabsTrigger value="attendance">Attendance & Leaves</TabsTrigger>
        </TabsList>

        {/* MY PERFORMANCE */}
        <TabsContent value="overview" className="mt-3 space-y-3">
          {/* Calls by disposition */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold">My Calls by Disposition</h3>
                <p className="text-[11px] text-muted-foreground">Daily total stacked by call outcome</p>
              </div>
              <Badge variant="outline" className="text-[10px]">{totalCalls} calls</Badge>
            </div>
            <div className="h-[260px]">
              {dispoNames.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No calls in this period
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dispoChartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {dispoNames.map((name, idx) => (
                      <Area
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stackId="1"
                        stroke={DISPO_COLORS[idx % DISPO_COLORS.length]}
                        fill={DISPO_COLORS[idx % DISPO_COLORS.length]}
                        fillOpacity={0.55}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* Recent calls */}
          <Card className="p-3">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">My Recent Calls</h3>
              <p className="text-[11px] text-muted-foreground">Click any score to see the AI breakdown</p>
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="py-2 text-xs">Date</TableHead>
                    <TableHead className="py-2 text-xs">Contact</TableHead>
                    <TableHead className="py-2 text-xs">Duration</TableHead>
                    <TableHead className="py-2 text-xs">Disposition</TableHead>
                    <TableHead className="py-2 text-xs">Recording</TableHead>
                    <TableHead className="py-2 text-xs">AI Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(callLogs as any[]).slice(0, 15).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                        No calls in this period
                      </TableCell>
                    </TableRow>
                  ) : (
                    (callLogs as any[]).slice(0, 15).map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="py-1.5 text-xs">
                          {log.started_at ? format(new Date(log.started_at), "MMM d, h:mm a") : "—"}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs font-medium">
                          {log.contacts ? `${log.contacts.first_name} ${log.contacts.last_name || ""}`.trim() : "Unknown"}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs">
                          {(() => {
                            const sec = log.conversation_duration ?? log.call_duration ?? 0;
                            if (!sec) return "—";
                            const m = Math.floor(sec / 60);
                            const s = sec % 60;
                            return `${m}:${s.toString().padStart(2, "0")}`;
                          })()}
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

        {/* MY COACHING */}
        <TabsContent value="coaching" className="mt-3">
          {!coachingPlan ? (
            <Card className="p-6 text-center">
              <Sparkles className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">No coaching plan yet</p>
              <p className="text-[11px] text-muted-foreground">
                Your plan is generated once you've made 5+ analyzed calls. Plans refresh daily at 6:40 PM.
              </p>
            </Card>
          ) : coachingPlan.generation_error ? (
            <Card className="p-4">
              <div className="text-xs text-red-600">Plan generation failed: {coachingPlan.generation_error}</div>
            </Card>
          ) : (
            <Card className="p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold">Your Coaching Plan</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Based on {coachingPlan.calls_analyzed} of your recent calls · dominant tone: <span className="capitalize">{coachingPlan.dominant_tone}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className={
                      "text-2xl font-bold leading-none " +
                      (Number(coachingPlan.avg_quality_score) >= 7 ? "text-emerald-600" : Number(coachingPlan.avg_quality_score) >= 5 ? "text-amber-600" : "text-red-600")
                    }>
                      {Number(coachingPlan.avg_quality_score).toFixed(1)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">avg score</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={regenerating}
                    onClick={handleRegenerate}
                    title="Regenerate now"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>

              {Array.isArray(coachingPlan.top_objections) && coachingPlan.top_objections.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Top objections you face
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {coachingPlan.top_objections.map((o: any, i: number) => (
                      <Badge key={i} variant="secondary" className="text-[10px] h-5">
                        {o.objection} <span className="ml-1 opacity-60">×{o.count}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                {Array.isArray(coachingPlan.strengths) && coachingPlan.strengths.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <Award className="h-3 w-3" /> What you're doing well
                    </div>
                    <ul className="text-xs space-y-1 list-disc list-inside text-foreground/90">
                      {coachingPlan.strengths.map((s: string, i: number) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(coachingPlan.drills) && coachingPlan.drills.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <Dumbbell className="h-3 w-3" /> Drills this week
                    </div>
                    <ul className="text-xs space-y-1 list-disc list-inside text-foreground/90">
                      {coachingPlan.drills.map((d: string, i: number) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {Array.isArray(coachingPlan.weaknesses) && coachingPlan.weaknesses.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Areas to improve
                  </div>
                  <div className="space-y-2">
                    {coachingPlan.weaknesses.map((w: any, i: number) => (
                      <div key={i} className="text-xs border-l-2 border-red-400/50 pl-2.5 space-y-0.5">
                        <p className="font-medium">{w.pattern}</p>
                        <p className="text-muted-foreground text-[11px]"><span className="font-medium">Evidence:</span> {w.evidence}</p>
                        <p className="text-[11px]"><span className="font-medium text-emerald-700">Fix:</span> {w.fix}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(coachingPlan.role_play_scenarios) && coachingPlan.role_play_scenarios.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Drama className="h-3 w-3" /> Role-play scenarios to practice
                  </div>
                  <div className="grid md:grid-cols-3 gap-2">
                    {coachingPlan.role_play_scenarios.map((r: any, i: number) => (
                      <div key={i} className="text-xs bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/50 rounded p-2 space-y-1">
                        <p>{r.scenario}</p>
                        <p className="text-[11px] text-muted-foreground"><span className="font-medium">Why:</span> {r.why}</p>
                        <p className="text-[11px] text-emerald-700"><span className="font-medium">Win when:</span> {r.success_criteria}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground pt-1 border-t">
                Generated {coachingPlan.generated_at ? format(new Date(coachingPlan.generated_at), "MMM d, h:mm a") : ""}
              </p>
            </Card>
          )}
        </TabsContent>

        {/* ATTENDANCE & LEAVES */}
        <TabsContent value="attendance" className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {/* Last 7 days attendance */}
            <Card className="p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold">Last 7 days</h3>
                <p className="text-[11px] text-muted-foreground">Your sign-in and sign-out activity</p>
              </div>
              <div className="space-y-1">
                {(() => {
                  const last7 = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(), i), "yyyy-MM-dd"));
                  return last7.map((d) => {
                    const rec = (attendance as any[]).find((a) => a.date === d);
                    const isToday = d === todayKey;
                    return (
                      <div
                        key={d}
                        className={`flex items-center justify-between text-xs border rounded p-2 ${isToday ? "bg-primary/5 border-primary/30" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{format(new Date(d), "EEE, MMM d")}{isToday && " · Today"}</span>
                        </div>
                        {rec ? (
                          <div className="flex items-center gap-3 text-[11px]">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3 text-emerald-500" />
                              In: {rec.sign_in_time ? format(new Date(rec.sign_in_time), "h:mm a") : "—"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3 text-red-500" />
                              Out: {rec.sign_out_time ? format(new Date(rec.sign_out_time), "h:mm a") : "—"}
                            </span>
                            {rec.total_hours && (
                              <Badge variant="outline" className="text-[10px] h-5">{Number(rec.total_hours).toFixed(1)}h</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">No record</span>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </Card>

            {/* Leave balance */}
            <Card className="p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold">Leave balance ({currentYear})</h3>
                <p className="text-[11px] text-muted-foreground">
                  {isLeaveEligible
                    ? "SDR policy: 7 sick + 7 casual = 14 days/year"
                    : `Eligible from ${leaveEligibleDate ? format(leaveEligibleDate, "MMM d, yyyy") : "—"} (${daysToEligible} day${daysToEligible === 1 ? "" : "s"} away)`}
                </p>
              </div>

              {!isLeaveEligible ? (
                <div className="text-xs text-muted-foreground bg-muted/30 rounded p-3 text-center">
                  Leave eligibility starts in month 2 of joining. Hang in there!
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-medium">Sick Leave</span>
                      <span className="text-muted-foreground">{sdrSL} of 7 left</span>
                    </div>
                    <Progress value={(sdrSL / 7) * 100} className="h-1.5" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-medium">Casual Leave</span>
                      <span className="text-muted-foreground">{sdrCL} of 7 left</span>
                    </div>
                    <Progress value={(sdrCL / 7) * 100} className="h-1.5" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-medium text-muted-foreground">Earned Leave</span>
                      <span className="text-muted-foreground">Unlocks after 1 year</span>
                    </div>
                    <Progress value={0} className="h-1.5 opacity-40" />
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Recent applications
                </div>
                {leaveApplications.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No applications yet</p>
                ) : (
                  <div className="space-y-1">
                    {(leaveApplications as any[]).map((la) => (
                      <div key={la.id} className="flex items-center justify-between text-[11px] border-b border-border/40 pb-1 last:border-0">
                        <span>
                          <span className="capitalize">{la.leave_type}</span> · {format(new Date(la.start_date), "MMM d")}
                          {la.start_date !== la.end_date && ` – ${format(new Date(la.end_date), "MMM d")}`}
                          <span className="text-muted-foreground"> ({la.total_days}d)</span>
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            la.status === "approved"
                              ? "text-[9px] h-4 border-emerald-500/40 text-emerald-600 bg-emerald-500/5"
                              : la.status === "rejected"
                              ? "text-[9px] h-4 border-red-500/40 text-red-600 bg-red-500/5"
                              : "text-[9px] h-4 border-amber-500/40 text-amber-600 bg-amber-500/5"
                          }
                        >
                          {la.status === "approved" ? <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> : la.status === "rejected" ? <XCircle className="h-2.5 w-2.5 mr-0.5" /> : null}
                          {la.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </TabsContent>
      </UrlTabs>

      {/* Per-call analysis dialog */}
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
                  <div className="text-[11px] text-muted-foreground">Your tone</div>
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
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Objections you faced</div>
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
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Suggested next step</div>
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
