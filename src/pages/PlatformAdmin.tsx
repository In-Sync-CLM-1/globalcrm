import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { useNotification } from "@/hooks/useNotification";
import { PlatformSummaryStats } from "@/components/platform/PlatformSummaryStats";
import { PlatformUserActivityChart } from "@/components/platform/PlatformUserActivityChart";
import { PlatformOrgHealth } from "@/components/platform/PlatformOrgHealth";
import { PlatformOrgsTable } from "@/components/platform/PlatformOrgsTable";
import { PlatformErrorLogs } from "@/components/platform/PlatformErrorLogs";
import { PlatformActivityFeed } from "@/components/platform/PlatformActivityFeed";
import { PlatformAiInsights } from "@/components/platform/PlatformAiInsights";

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  settings: any;
  usage_limits: any;
  primary_color: string;
  userCount?: number;
  contactCount?: number;
  is_active?: boolean;
  usersActive1Day?: number;
  usersActive7Days?: number;
  usersActive30Days?: number;
  callVolume?: number;
  emailVolume?: number;
  whatsappVolume?: number;
}

interface OrgStats {
  totalOrgs: number;
  activeOrgs: number;
  totalUsers: number;
  totalContacts: number;
  usersLast1Day: number;
  usersLast7Days: number;
  usersLast30Days: number;
  callVolume: number;
  emailVolume: number;
  whatsappVolume: number;
}

const EMPTY_STATS: OrgStats = {
  totalOrgs: 0, activeOrgs: 0, totalUsers: 0, totalContacts: 0,
  usersLast1Day: 0, usersLast7Days: 0, usersLast30Days: 0,
  callVolume: 0, emailVolume: 0, whatsappVolume: 0,
};

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function SectionSkeleton({ height = "h-48" }: { height?: string }) {
  return <Skeleton className={`w-full rounded-lg ${height}`} />;
}

export default function PlatformAdmin() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [stats, setStats] = useState<OrgStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const notify = useNotification();
  const navigate = useNavigate();

  const checkAccess = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_platform_admin")
        .eq("id", user.id)
        .single();

      if (!profile?.is_platform_admin) {
        notify.error("Access Denied", "You don't have platform admin privileges");
        navigate("/dashboard");
        return;
      }

      setAuthorized(true);
    } catch (error: any) {
      notify.error("Error", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    try {
      const [{ data: orgs, error: orgsError }, { data: platformStats }] = await Promise.all([
        supabase.from("organizations").select("*").order("created_at", { ascending: false }),
        supabase.rpc("get_platform_admin_stats"),
      ]);

      if (orgsError) throw orgsError;

      const orgsWithStats = await Promise.all(
        (orgs || []).map(async (org) => {
          const { data: orgStats } = await supabase.rpc("get_org_statistics", { p_org_id: org.id });
          return {
            ...org,
            is_active: (org.settings as any)?.is_active !== false,
            userCount: (orgStats as any)?.user_count || 0,
            contactCount: (orgStats as any)?.contact_count || 0,
            usersActive1Day: (orgStats as any)?.active_users_1d || 0,
            usersActive7Days: (orgStats as any)?.active_users_7d || 0,
            usersActive30Days: (orgStats as any)?.active_users_30d || 0,
            callVolume: (orgStats as any)?.call_volume || 0,
            emailVolume: (orgStats as any)?.email_volume || 0,
            whatsappVolume: (orgStats as any)?.whatsapp_volume || 0,
          };
        })
      );

      setOrganizations(orgsWithStats);

      if (platformStats) {
        setStats({
          totalOrgs: (platformStats as any).total_organizations || 0,
          activeOrgs: orgs?.filter((o) => (o.settings as any)?.is_active !== false).length || 0,
          totalUsers: (platformStats as any).total_users || 0,
          totalContacts: (platformStats as any).total_contacts || 0,
          usersLast1Day: (platformStats as any).active_users_1d || 0,
          usersLast7Days: (platformStats as any).active_users_7d || 0,
          usersLast30Days: (platformStats as any).active_users_30d || 0,
          callVolume: (platformStats as any).call_volume || 0,
          emailVolume: (platformStats as any).email_volume || 0,
          whatsappVolume: (platformStats as any).whatsapp_volume || 0,
        });
      }
    } catch (error: any) {
      notify.error("Error loading platform data", error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  useEffect(() => { checkAccess(); }, [checkAccess]);
  useEffect(() => { fetchData(); }, [fetchData]);

  if (!authorized) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Platform Command Center</h1>
          <p className="mt-1 text-muted-foreground">Platform-wide monitoring across all organizations</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="space-y-6">
        {/* Row 1: Summary Stats */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0 }}>
          {loading ? <SectionSkeleton height="h-32" /> : <PlatformSummaryStats stats={stats} />}
        </motion.div>

        {/* Row 2: User Activity Chart + Org Health */}
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.1 }}
          className="grid gap-6 lg:grid-cols-3"
        >
          <div className="lg:col-span-2">
            {loading ? <SectionSkeleton height="h-[380px]" /> : <PlatformUserActivityChart organizations={organizations} />}
          </div>
          <div>
            {loading ? <SectionSkeleton height="h-[380px]" /> : <PlatformOrgHealth organizations={organizations} />}
          </div>
        </motion.div>

        {/* Row 3: AI Insights */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.15 }}>
          <PlatformAiInsights />
        </motion.div>

        {/* Row 4: Organizations Table */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.2 }}>
          {loading ? <SectionSkeleton height="h-64" /> : <PlatformOrgsTable organizations={organizations} />}
        </motion.div>

        {/* Row 5: Error Logs + Activity Feed */}
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.3 }}
          className="grid gap-6 lg:grid-cols-2"
        >
          {loading ? (
            <>
              <SectionSkeleton height="h-[400px]" />
              <SectionSkeleton height="h-[400px]" />
            </>
          ) : (
            <>
              <PlatformErrorLogs />
              <PlatformActivityFeed organizations={organizations} />
            </>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
