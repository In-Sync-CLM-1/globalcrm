import { useMemo, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { useOrgContext } from "@/hooks/useOrgContext";
import { LoadingState } from "@/components/common/LoadingState";
import { useCallbackReminders } from "@/hooks/useCallbackReminders";
import DateRangeFilter, { DateRangePreset, getDateRangeFromPreset } from "@/components/common/DateRangeFilter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { TrendingUp, PhoneCall, RefreshCw } from "lucide-react";

// Sales pipeline dashboard components
import { SalesKPICards } from "@/components/Dashboard/SalesKPICards";
import { PipelineFunnelChart } from "@/components/Dashboard/PipelineFunnelChart";
import { SalesActivityTrend } from "@/components/Dashboard/SalesActivityTrend";
import { SalesLeaderboard } from "@/components/Dashboard/SalesLeaderboard";
import { DueTodayCard } from "@/components/Dashboard/DueTodayCard";
import { CompactDashboard } from "@/components/Dashboard/CompactDashboard";
import { SDRDashboard } from "@/components/Dashboard/SDRDashboard";
import { useUserRole } from "@/hooks/useUserRole";
import IedupDashboard from "@/pages/IedupDashboard";
import { IEDUP_ORG_ID } from "@/hooks/useIsIedup";

const INSYNC_DEMO_ORG_ID = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";

export default function Dashboard() {
  const { effectiveOrgId, isLoading: orgLoading } = useOrgContext();
  const { isAdmin, isSuperAdmin, loading: roleLoading } = useUserRole();

  const queryClient = useQueryClient();
  const { triggerEdgeFunctionCheck, checkReminders } = useCallbackReminders();
  const hasCheckedReminders = useRef(false);

  // Date range filter state - default to This Month
  const [datePreset, setDatePreset] = useState<DateRangePreset>("this_month");
  const [dateRange, setDateRange] = useState(() => getDateRangeFromPreset("this_month"));
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Only the standard sales dashboard runs the heavy queries below.
  // IEDUP and In-Sync Demo render their own dashboards and don't need this data.
  const isStandardDashboardOrg =
    !!effectiveOrgId &&
    effectiveOrgId !== IEDUP_ORG_ID &&
    effectiveOrgId !== INSYNC_DEMO_ORG_ID;

  // Trigger reminder check on dashboard load
  useEffect(() => {
    if (effectiveOrgId && !hasCheckedReminders.current) {
      hasCheckedReminders.current = true;
      triggerEdgeFunctionCheck();
      checkReminders();
    }
  }, [effectiveOrgId, triggerEdgeFunctionCheck, checkReminders]);

  // Fetch optimized dashboard stats using database function
  const { data: rawStats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["dashboard-stats", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) throw new Error("No organization context");
      const { data, error } = await supabase.rpc("get_dashboard_stats", {
        p_org_id: effectiveOrgId,
      });
      if (error) throw error;
      return data;
    },
    enabled: isStandardDashboardOrg,
  });

  // Fetch ordered pipeline stages with colors for funnel chart
  const { data: pipelineStagesOrdered = [], isLoading: pipelineFunnelLoading } = useQuery({
    queryKey: ["pipeline-performance", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) throw new Error("No organization context");
      const { data, error } = await supabase.rpc("get_pipeline_performance_report", {
        p_org_id: effectiveOrgId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: isStandardDashboardOrg,
  });

  // Fetch sales rep performance
  const { data: salesReps = [], isLoading: salesRepsLoading } = useQuery({
    queryKey: ["sales-rep-performance", effectiveOrgId, format(dateRange.from, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!effectiveOrgId) throw new Error("No organization context");
      const { data, error } = await supabase.rpc("get_sales_performance_report", {
        p_org_id: effectiveOrgId,
        p_start_date: dateRange.from.toISOString(),
      });
      if (error) throw error;
      return data || [];
    },
    enabled: isStandardDashboardOrg,
  });

  // Fetch activity trends
  const { data: activityTrendsRaw = [], isLoading: activityTrendsLoading } = useQuery({
    queryKey: ["sales-activity-trends", effectiveOrgId, format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!effectiveOrgId) throw new Error("No organization context");
      const daysDiff = Math.max(1, Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)));
      const { data, error } = await supabase.rpc("get_activity_trends", {
        p_org_id: effectiveOrgId,
        p_days: Math.min(daysDiff, 90),
      });
      if (error) throw error;
      return data || [];
    },
    enabled: isStandardDashboardOrg,
  });

  // Fetch new contacts added in this period (for KPI)
  const { data: newLeadsData } = useQuery({
    queryKey: ["new-leads-period", effectiveOrgId, format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!effectiveOrgId) throw new Error("No organization context");
      const { count, error } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", effectiveOrgId)
        .gte("created_at", dateRange.from.toISOString())
        .lte("created_at", dateRange.to.toISOString());
      if (error) throw error;
      return count || 0;
    },
    enabled: isStandardDashboardOrg,
  });

  // Fetch contacts in won/lost stages for win rate
  const { data: wonLostData } = useQuery({
    queryKey: ["won-lost-counts", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) throw new Error("No organization context");
      const { data: stages, error: stagesErr } = await supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("org_id", effectiveOrgId);
      if (stagesErr) throw stagesErr;

      const wonStage = stages?.find((s) => s.name?.toLowerCase() === "won");
      const lostStage = stages?.find((s) => s.name?.toLowerCase() === "lost");

      const [wonRes, lostRes] = await Promise.all([
        wonStage
          ? supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", effectiveOrgId).eq("pipeline_stage_id", wonStage.id)
          : Promise.resolve({ count: 0 }),
        lostStage
          ? supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", effectiveOrgId).eq("pipeline_stage_id", lostStage.id)
          : Promise.resolve({ count: 0 }),
      ]);

      return { won: wonRes.count || 0, lost: lostRes.count || 0 };
    },
    enabled: isStandardDashboardOrg,
  });

  // Process activity trends into per-day { date, calls, emails, meetings }
  const activityTrendData = useMemo(() => {
    if (!activityTrendsRaw || activityTrendsRaw.length === 0) return [];
    const map: Record<string, { date: string; calls: number; emails: number; meetings: number }> = {};
    activityTrendsRaw.forEach((row: any) => {
      const d = format(new Date(row.activity_date), "MMM d");
      if (!map[d]) map[d] = { date: d, calls: 0, emails: 0, meetings: 0 };
      const type = row.activity_type as string;
      const count = Number(row.activity_count);
      if (type === "call") map[d].calls += count;
      else if (type === "email") map[d].emails += count;
      else if (type === "meeting") map[d].meetings += count;
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [activityTrendsRaw]);

  // Compute KPI values for the sales section
  const salesKPIs = useMemo(() => {
    const rawStatsObj = typeof rawStats === "string" ? JSON.parse(rawStats) : rawStats;
    const activePipeline = rawStatsObj?.active_deals ?? 0;
    const dealsWon = wonLostData?.won ?? 0;
    const dealsLost = wonLostData?.lost ?? 0;
    const winRate = dealsWon + dealsLost > 0 ? Math.round((dealsWon / (dealsWon + dealsLost)) * 100) : 0;
    const newLeads = newLeadsData ?? 0;
    const totalActivities = activityTrendData.reduce((s, d) => s + d.calls + d.emails + d.meetings, 0);
    return { activePipeline, dealsWon, winRate, newLeads, totalActivities };
  }, [rawStats, wonLostData, newLeadsData, activityTrendData]);

  const loading = orgLoading || statsLoading || pipelineFunnelLoading;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    await queryClient.invalidateQueries({ queryKey: ["pipeline-performance"] });
    await queryClient.invalidateQueries({ queryKey: ["sales-rep-performance"] });
    await queryClient.invalidateQueries({ queryKey: ["sales-activity-trends"] });
    await queryClient.invalidateQueries({ queryKey: ["new-leads-period"] });
    await queryClient.invalidateQueries({ queryKey: ["won-lost-counts"] });
    setIsRefreshing(false);
  };

  // EARLY RETURN - All hooks are above this point

  // IEDUP org: render the dedicated minimal dashboard
  if (effectiveOrgId === IEDUP_ORG_ID) {
    return <IedupDashboard />;
  }

  // In-Sync Demo: admins see team-level compact dashboard; SDRs see their own dashboard
  if (effectiveOrgId === INSYNC_DEMO_ORG_ID) {
    if (roleLoading) {
      return (
        <DashboardLayout>
          <LoadingState message="Loading dashboard..." />
        </DashboardLayout>
      );
    }
    return (
      <DashboardLayout>
        {isAdmin || isSuperAdmin ? (
          <CompactDashboard orgId={effectiveOrgId} />
        ) : (
          <SDRDashboard orgId={effectiveOrgId} />
        )}
      </DashboardLayout>
    );
  }

  if (!effectiveOrgId || loading) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading dashboard data..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-xs text-muted-foreground">Real-time insights into your sales performance</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/reports" className="gap-1.5">
                <TrendingUp className="h-4 w-4" />
                Analytics
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/calling-dashboard" className="gap-1.5">
                <PhoneCall className="h-4 w-4" />
                Calling
              </Link>
            </Button>
            <DateRangeFilter
              value={dateRange}
              onChange={setDateRange}
              preset={datePreset}
              onPresetChange={setDatePreset}
            />
          </div>
        </div>

        {/* Due Today */}
        <DueTodayCard />

        {/* Sales KPI Cards */}
        <SalesKPICards
          newLeads={salesKPIs.newLeads}
          newLeadsDelta={0}
          activePipeline={salesKPIs.activePipeline}
          dealsWon={salesKPIs.dealsWon}
          winRate={salesKPIs.winRate}
          totalActivities={salesKPIs.totalActivities}
          activitiesDelta={0}
        />

        {/* Pipeline Funnel + Activity Trend */}
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <PipelineFunnelChart stages={pipelineStagesOrdered} />
          </div>
          <div className="lg:col-span-2">
            <SalesActivityTrend data={activityTrendData} isLoading={activityTrendsLoading} />
          </div>
        </div>

        {/* Sales Rep Leaderboard */}
        <SalesLeaderboard reps={salesReps} isLoading={salesRepsLoading} />
      </div>
    </DashboardLayout>
  );
}
