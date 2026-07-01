import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { format, startOfMonth, subMonths } from "date-fns";
import { Database, Building2, Mail, Phone, TrendingUp, ArrowRight } from "lucide-react";
import { useIsFervent, FERVENT_ORG_ID } from "@/hooks/useIsFervent";

const COLORS = ["#01B8AA", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#10b981", "#6366f1", "#ec4899"];

interface RepoRow {
  id: string;
  company_name: string | null;
  industry: string | null;
  designation_level: string | null;
  ucdb_status: string | null;
  city: string | null;
  state: string | null;
  official_email: string | null;
  mobile_number_1: string | null;
  created_at: string;
}

export default function FerventDashboard() {
  const { isLoading: orgLoading } = useIsFervent();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fervent-dashboard-data"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fervent_data_repository")
        .select("id, company_name, industry, designation_level, ucdb_status, city, state, official_email, mobile_number_1, created_at")
        .eq("org_id", FERVENT_ORG_ID)
        .range(0, 9999);
      if (error) throw error;
      return (data || []) as RepoRow[];
    },
  });

  const stats = useMemo(() => {
    const total = rows.length;
    const companies = new Set(rows.map((r) => r.company_name).filter(Boolean)).size;
    const withEmail = rows.filter((r) => r.official_email && r.official_email.trim() !== "").length;
    const withMobile = rows.filter((r) => r.mobile_number_1 && r.mobile_number_1.trim() !== "").length;
    const industries = new Set(rows.map((r) => r.industry).filter(Boolean)).size;

    const monthStart = startOfMonth(new Date());
    const addedThisMonth = rows.filter((r) => new Date(r.created_at) >= monthStart).length;

    const emailCoverage = total ? Math.round((withEmail / total) * 100) : 0;
    const mobileCoverage = total ? Math.round((withMobile / total) * 100) : 0;

    return { total, companies, withEmail, withMobile, industries, addedThisMonth, emailCoverage, mobileCoverage };
  }, [rows]);

  const byIndustry = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const key = r.industry?.trim() || "Unspecified";
      m.set(key, (m.get(key) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows]);

  const byDesignationLevel = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const key = r.designation_level?.trim() || "Unspecified";
      m.set(key, (m.get(key) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const key = r.ucdb_status?.trim() || "Unspecified";
      m.set(key, (m.get(key) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const byState = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const key = r.state?.trim() || "Unspecified";
      m.set(key, (m.get(key) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows]);

  const monthlyTrend = useMemo(() => {
    const months: { key: string; label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = startOfMonth(subMonths(new Date(), i));
      months.push({ key: format(d, "yyyy-MM"), label: format(d, "MMM"), count: 0 });
    }
    const map = new Map(months.map((m) => [m.key, m]));
    rows.forEach((r) => {
      const key = format(new Date(r.created_at), "yyyy-MM");
      const bucket = map.get(key);
      if (bucket) bucket.count++;
    });
    return months;
  }, [rows]);

  if (orgLoading || isLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 text-sm text-muted-foreground">Loading dashboard…</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Fervent Dashboard</h1>
            <p className="text-sm text-muted-foreground">An overview of your vendor/lead database.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/data-repository" className="gap-1.5">
              Open Fervent Database <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {stats.total === 0 ? (
          <Card>
            <CardContent className="py-16 text-center space-y-3">
              <Database className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">No records yet. Import your database to see insights here.</p>
              <Button asChild>
                <Link to="/data-repository">Go to Fervent Database</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard icon={<Database size={16} />} label="Total Records" value={stats.total} tone="slate" />
              <KpiCard icon={<Building2 size={16} />} label="Companies" value={stats.companies} tone="blue" />
              <KpiCard icon={<TrendingUp size={16} />} label="Industries" value={stats.industries} tone="violet" />
              <KpiCard icon={<Database size={16} />} label="Added This Month" value={stats.addedThisMonth} tone="emerald" />
              <KpiCard icon={<Mail size={16} />} label="Email Coverage" value={`${stats.emailCoverage}%`} tone="amber" />
              <KpiCard icon={<Phone size={16} />} label="Mobile Coverage" value={`${stats.mobileCoverage}%`} tone="indigo" />
            </div>

            {/* Trend + Designation Level */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <ChartCard className="lg:col-span-2" title="Records added" subtitle="Last 6 months">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyTrend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="g-added" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#01B8AA" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#01B8AA" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="count" name="Records" stroke="#01B8AA" strokeWidth={2} fill="url(#g-added)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="By designation level" subtitle="Seniority mix">
                {byDesignationLevel.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byDesignationLevel} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                        {byDesignationLevel.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>No data</Empty>
                )}
              </ChartCard>
            </div>

            {/* Industry + State */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ChartCard title="Top industries" subtitle="By record count">
                {byIndustry.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byIndustry} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" fill="#01B8AA" radius={[0, 4, 4, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>No data</Empty>
                )}
              </ChartCard>

              <ChartCard title="Top states" subtitle="Geographic spread">
                {byState.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byState} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>No data</Empty>
                )}
              </ChartCard>
            </div>

            {/* Source status */}
            <ChartCard title="By source" subtitle="UCDB Status breakdown">
              {byStatus.length > 0 ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={byStatus} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" name="Records" radius={[4, 4, 0, 0]} barSize={40}>
                      {byStatus.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No data</Empty>
              )}
            </ChartCard>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

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
    <Card className={`flex flex-col p-4 ${className}`}>
      <div className="mb-2 shrink-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="h-[220px]">{children}</div>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{children}</div>;
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="space-y-1 rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="capitalize text-muted-foreground">{p.name || p.dataKey}:</span>
          <span className="font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
};
