import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, startOfMonth, subMonths } from "date-fns";
import { Database, Building2, Mail, Phone, TrendingUp, ArrowRight, SlidersHorizontal, Download, X, UserX, Users } from "lucide-react";
import { useIsFervent, FERVENT_ORG_ID } from "@/hooks/useIsFervent";
import { EChart } from "@/components/charts/EChart";
import { getFerventChartTheme } from "@/components/FerventDashboard/ferventChartTheme";
import { exportToCSV } from "@/utils/exportUtils";
import {
  buildTrendOption,
  buildIndustryTreemapOption,
  buildDesignationDonutOption,
  buildRankedBarOption,
  buildStatusSegmentOption,
  buildDailyActivityHeatmapOption,
  UNSPECIFIED,
} from "@/components/FerventDashboard/ferventChartOptions";

interface RepoRow {
  id: string;
  company_name: string | null;
  full_name: string | null;
  designation: string | null;
  designation_level: string | null;
  department: string | null;
  industry: string | null;
  employee_size: string | null;
  ucdb_status: string | null;
  city: string | null;
  state: string | null;
  official_email: string | null;
  personal_email_1: string | null;
  personal_email_2: string | null;
  mobile_number_1: string | null;
  created_at: string;
}

interface FilterState {
  dateFrom: string;
  dateTo: string;
  industry: string;
  designationLevel: string;
  designation: string;
  city: string;
  state: string;
  source: string;
}

const emptyFilters: FilterState = {
  dateFrom: "", dateTo: "", industry: "all", designationLevel: "all",
  designation: "all", city: "all", state: "all", source: "all",
};

function normalizeKey(raw: string | null): string {
  return (typeof raw === "string" ? raw.trim() : "") || UNSPECIFIED;
}

function hasEmail(r: RepoRow): boolean {
  return !!(r.official_email?.trim() || r.personal_email_1?.trim() || r.personal_email_2?.trim());
}
function hasMobile(r: RepoRow): boolean {
  return !!r.mobile_number_1?.trim();
}

function groupBy(rows: RepoRow[], field: keyof RepoRow): { name: string; value: number }[] {
  const m = new Map<string, number>();
  rows.forEach((r) => {
    const key = normalizeKey(r[field] as string | null);
    m.set(key, (m.get(key) || 0) + 1);
  });
  return Array.from(m.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function distinctOptions(rows: RepoRow[], field: keyof RepoRow): string[] {
  const set = new Set<string>();
  rows.forEach((r) => set.add(normalizeKey(r[field] as string | null)));
  return Array.from(set).sort((a, b) => (a === UNSPECIFIED ? 1 : b === UNSPECIFIED ? -1 : a.localeCompare(b)));
}

function csvEscape(v: string): string {
  return `"${(v || "").replace(/"/g, '""')}"`;
}

export default function FerventDashboard() {
  const { isLoading: orgLoading } = useIsFervent();
  const theme = useMemo(() => getFerventChartTheme(), []);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [drilldown, setDrilldown] = useState<{ label: string; rows: RepoRow[] } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fervent-dashboard-data"],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: RepoRow[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("fervent_data_repository")
          .select(
            "id, company_name, full_name, designation, designation_level, department, industry, employee_size, ucdb_status, city, state, official_email, personal_email_1, personal_email_2, mobile_number_1, created_at"
          )
          .eq("org_id", FERVENT_ORG_ID)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        all.push(...((data || []) as RepoRow[]));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  const filterOptions = useMemo(
    () => ({
      industry: distinctOptions(rows, "industry"),
      designationLevel: distinctOptions(rows, "designation_level"),
      designation: distinctOptions(rows, "designation"),
      city: distinctOptions(rows, "city"),
      state: distinctOptions(rows, "state"),
      source: distinctOptions(rows, "ucdb_status"),
    }),
    [rows]
  );

  const activeFilters =
    (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0) +
    (filters.industry !== "all" ? 1 : 0) + (filters.designationLevel !== "all" ? 1 : 0) +
    (filters.designation !== "all" ? 1 : 0) + (filters.city !== "all" ? 1 : 0) +
    (filters.state !== "all" ? 1 : 0) + (filters.source !== "all" ? 1 : 0);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filters.dateFrom && new Date(r.created_at) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(r.created_at) > new Date(`${filters.dateTo}T23:59:59`)) return false;
      if (filters.industry !== "all" && normalizeKey(r.industry) !== filters.industry) return false;
      if (filters.designationLevel !== "all" && normalizeKey(r.designation_level) !== filters.designationLevel) return false;
      if (filters.designation !== "all" && normalizeKey(r.designation) !== filters.designation) return false;
      if (filters.city !== "all" && normalizeKey(r.city) !== filters.city) return false;
      if (filters.state !== "all" && normalizeKey(r.state) !== filters.state) return false;
      if (filters.source !== "all" && normalizeKey(r.ucdb_status) !== filters.source) return false;
      return true;
    });
  }, [rows, filters]);

  const stats = useMemo(() => {
    const total = filteredRows.length;
    const companies = new Set(filteredRows.map((r) => r.company_name).filter(Boolean)).size;
    const withEmail = filteredRows.filter(hasEmail).length;
    const withMobile = filteredRows.filter(hasMobile).length;
    const industries = new Set(filteredRows.map((r) => r.industry).filter(Boolean)).size;
    const monthStart = startOfMonth(new Date());
    const addedThisMonth = filteredRows.filter((r) => new Date(r.created_at) >= monthStart).length;
    const missingBoth = filteredRows.filter((r) => !hasEmail(r) && !hasMobile(r)).length;
    const emailCoverage = total ? Math.round((withEmail / total) * 100) : 0;
    const mobileCoverage = total ? Math.round((withMobile / total) * 100) : 0;
    return { total, companies, withEmail, withMobile, industries, addedThisMonth, emailCoverage, mobileCoverage, missingBoth };
  }, [filteredRows]);

  const byIndustry = useMemo(() => groupBy(filteredRows, "industry"), [filteredRows]);
  const byDesignationLevel = useMemo(() => groupBy(filteredRows, "designation_level"), [filteredRows]);
  const byStatus = useMemo(() => groupBy(filteredRows, "ucdb_status"), [filteredRows]);
  const byState = useMemo(() => groupBy(filteredRows, "state"), [filteredRows]);
  const byCity = useMemo(() => groupBy(filteredRows, "city"), [filteredRows]);
  const byDesignation = useMemo(() => groupBy(filteredRows, "designation"), [filteredRows]);
  const byEmployeeSize = useMemo(() => groupBy(filteredRows, "employee_size"), [filteredRows]);
  const byCompany = useMemo(() => groupBy(filteredRows, "company_name"), [filteredRows]);

  const missingBuckets = useMemo(() => {
    const both = filteredRows.filter((r) => !hasEmail(r) && !hasMobile(r));
    const emailOnly = filteredRows.filter((r) => !hasEmail(r) && hasMobile(r));
    const mobileOnly = filteredRows.filter((r) => hasEmail(r) && !hasMobile(r));
    return [
      { label: "Missing mobile & email", rows: both, dot: "bg-red-600", border: "border-red-200", bg: "bg-red-50", text: "text-red-700", pill: "border-red-200 text-red-800 hover:bg-red-100" },
      { label: "Missing email only", rows: emailOnly, dot: "bg-amber-400", border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-700", pill: "border-amber-200 text-amber-800 hover:bg-amber-100" },
      { label: "Missing mobile only", rows: mobileOnly, dot: "bg-blue-400", border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", pill: "border-blue-200 text-blue-800 hover:bg-blue-100" },
    ].filter((b) => b.rows.length > 0);
  }, [filteredRows]);

  const monthlyTrend = useMemo(() => {
    const months: { key: string; label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = startOfMonth(subMonths(new Date(), i));
      months.push({ key: format(d, "yyyy-MM"), label: format(d, "MMM"), count: 0 });
    }
    const map = new Map(months.map((m) => [m.key, m]));
    filteredRows.forEach((r) => {
      const key = format(new Date(r.created_at), "yyyy-MM");
      const bucket = map.get(key);
      if (bucket) bucket.count++;
    });
    return months;
  }, [filteredRows]);

  const monthKeyMap = useMemo(() => {
    const m: Record<string, string> = {};
    monthlyTrend.forEach((b) => (m[b.label] = b.key));
    return m;
  }, [monthlyTrend]);

  // Daily activity heatmap — last 3 full months, so the calendar grid stays a
  // compact 3-row block rather than sprawling across a year.
  const activityRange = useMemo((): [string, string] => {
    const start = startOfMonth(subMonths(new Date(), 2));
    return [format(start, "yyyy-MM-dd"), format(new Date(), "yyyy-MM-dd")];
  }, []);

  const dailyActivity = useMemo(() => {
    const m = new Map<string, number>();
    filteredRows.forEach((r) => {
      const key = format(new Date(r.created_at), "yyyy-MM-dd");
      m.set(key, (m.get(key) || 0) + 1);
    });
    return Array.from(m.entries()).map(([date, count]) => ({ date, count }));
  }, [filteredRows]);

  const trendOption = useMemo(() => buildTrendOption(monthlyTrend, theme), [monthlyTrend, theme]);
  const industryOption = useMemo(() => buildIndustryTreemapOption(byIndustry, theme), [byIndustry, theme]);
  const designationLevelOption = useMemo(() => buildDesignationDonutOption(byDesignationLevel, theme), [byDesignationLevel, theme]);
  const statesOption = useMemo(() => buildRankedBarOption(byState, theme, { topN: 8, color: theme.categorical[4] }), [byState, theme]);
  const cityOption = useMemo(() => buildRankedBarOption(byCity, theme, { topN: 8, color: theme.categorical[1] }), [byCity, theme]);
  const designationOption = useMemo(
    () => buildRankedBarOption(byDesignation, theme, { topN: 10, color: theme.categorical[6], labelWidth: 120 }),
    [byDesignation, theme]
  );
  const employeeSizeOption = useMemo(() => buildRankedBarOption(byEmployeeSize, theme, { topN: 8, color: theme.categorical[3] }), [byEmployeeSize, theme]);
  const companyOption = useMemo(
    () => buildRankedBarOption(byCompany, theme, { topN: 12, color: theme.categorical[2], labelWidth: 130 }),
    [byCompany, theme]
  );
  const statusOption = useMemo(() => buildStatusSegmentOption(byStatus, theme), [byStatus, theme]);
  const activityOption = useMemo(
    () => buildDailyActivityHeatmapOption(dailyActivity, theme, activityRange),
    [dailyActivity, theme, activityRange]
  );

  const drill = (label: string, matcher: (r: RepoRow) => boolean) => {
    setDrilldown({ label, rows: filteredRows.filter(matcher) });
  };

  function fieldClickEvents(field: keyof RepoRow, grouped: { name: string; value: number }[], labelPrefix: string) {
    const top = grouped.slice(0, 7).map((d) => d.name);
    return {
      click: (p: any) => {
        const name = p.name ?? p.seriesName;
        if (!name) return;
        if (name === "Other") drill(`${labelPrefix}: Other`, (r) => !top.includes(normalizeKey(r[field] as string | null)));
        else drill(`${labelPrefix}: ${name}`, (r) => normalizeKey(r[field] as string | null) === name);
      },
    };
  }

  const trendClickEvents = {
    click: (p: any) => {
      const key = monthKeyMap[p.name];
      if (!key) return;
      drill(`Added in ${p.name}`, (r) => format(new Date(r.created_at), "yyyy-MM") === key);
    },
  };

  const activityClickEvents = {
    click: (p: any) => {
      const day = p.data?.[0];
      if (!day) return;
      drill(`Added on ${day}`, (r) => format(new Date(r.created_at), "yyyy-MM-dd") === day);
    },
  };

  const resetFilters = () => setFilters(emptyFilters);

  const exportSummaryCsv = () => {
    const total = filteredRows.length;
    const lines = ["Dimension,Value,Count,Share %"];
    const push = (dim: string, arr: { name: string; value: number }[]) => {
      arr.forEach((d) => lines.push(`${dim},${csvEscape(d.name)},${d.value},${total ? ((d.value / total) * 100).toFixed(1) : 0}`));
    };
    push("Industry", byIndustry);
    push("Designation Level", byDesignationLevel);
    push("Designation", byDesignation);
    push("Data Source", byStatus);
    push("State", byState);
    push("City", byCity);
    push("Employee Size", byEmployeeSize);
    lines.push("");
    lines.push("Top Companies,Company,Contacts");
    byCompany.slice(0, 50).forEach((c) => lines.push(`Company,${csvEscape(c.name)},${c.value}`));
    lines.push("");
    lines.push("Missing Contact Info,Company,Full Name,Reason,Mobile,Email,Added On");
    missingBuckets.forEach((b) =>
      b.rows.forEach((r) => {
        lines.push(
          `Missing,${csvEscape(r.company_name || "")},${csvEscape(r.full_name || "")},${csvEscape(b.label)},${csvEscape(r.mobile_number_1 || "")},${csvEscape(
            r.official_email || r.personal_email_1 || r.personal_email_2 || ""
          )},${format(new Date(r.created_at), "yyyy-MM-dd")}`
        );
      })
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fervent-dashboard-summary-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDrilldownCsv = () => {
    if (!drilldown || drilldown.rows.length === 0) return;
    exportToCSV(
      drilldown.rows,
      [
        { key: "company_name", label: "Company" },
        { key: "full_name", label: "Full Name" },
        { key: "designation", label: "Designation" },
        { key: "department", label: "Department" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
        { key: "mobile_number_1", label: "Mobile Number" },
        { key: "official_email", label: "Official Email" },
        { key: "created_at", label: "Added On", format: (v: string) => format(new Date(v), "yyyy-MM-dd") },
      ],
      `fervent-drilldown-${format(new Date(), "yyyyMMdd-HHmm")}`
    );
  };

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
          <div className="flex items-center gap-2">
            {stats.total > 0 && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters
                      {activeFilters > 0 && <Badge className="ml-2" variant="secondary">{activeFilters}</Badge>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Added from</Label>
                        <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Added to</Label>
                        <Input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
                      </div>
                    </div>
                    {([
                      ["industry", "Industry"],
                      ["designationLevel", "Designation Level"],
                      ["designation", "Designation"],
                      ["state", "State"],
                      ["city", "City"],
                      ["source", "Data Source"],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-xs">{label}</Label>
                        <Select value={filters[key]} onValueChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            {filterOptions[key].map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    {activeFilters > 0 && (
                      <Button variant="ghost" size="sm" className="w-full" onClick={resetFilters}>
                        <X className="mr-1.5 h-3.5 w-3.5" /> Reset filters
                      </Button>
                    )}
                  </PopoverContent>
                </Popover>
                <Button variant="outline" size="sm" onClick={exportSummaryCsv}>
                  <Download className="mr-2 h-4 w-4" /> Export
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/data-repository" className="gap-1.5">
                Open Fervent Database <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {stats.total === 0 ? (
          <Card>
            <CardContent className="py-16 text-center space-y-3">
              <Database className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                {activeFilters > 0 ? "No records match the current filters." : "No records yet. Import your database to see insights here."}
              </p>
              <Button asChild>
                <Link to="/data-repository">Go to Fervent Database</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <KpiCard icon={<Database size={16} />} label="Total Records" value={stats.total} accent={theme.categorical[0]} />
              <KpiCard icon={<Building2 size={16} />} label="Companies" value={stats.companies} accent={theme.categorical[2]} />
              <KpiCard icon={<TrendingUp size={16} />} label="Industries Tagged" value={stats.industries} accent={theme.categorical[3]} />
              <KpiCard icon={<Database size={16} />} label="Added This Month" value={stats.addedThisMonth} accent={theme.categorical[1]} />
              <KpiCard icon={<Mail size={16} />} label="Email Coverage" value={`${stats.emailCoverage}%`} accent={theme.categorical[4]} />
              <KpiCard icon={<Phone size={16} />} label="Mobile Coverage" value={`${stats.mobileCoverage}%`} accent={theme.categorical[6]} />
              <KpiCard
                icon={<UserX size={16} />}
                label="Missing Both"
                value={stats.missingBoth}
                accent="#ef4444"
                onClick={stats.missingBoth > 0 ? () => drill("Missing mobile & email", (r) => !hasEmail(r) && !hasMobile(r)) : undefined}
              />
            </div>

            {/* Bento grid — hero designation ranking, trend, and data source mix */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card className="lg:col-span-2 lg:row-span-2">
                <ChartHeader title="By Designation" subtitle="Top job titles — click to drill down" />
                <CardContent className="p-1 h-[350px]">
                  <EChart option={designationOption} eventHandlers={fieldClickEvents("designation", byDesignation, "Designation")} />
                </CardContent>
              </Card>
              <Card>
                <ChartHeader title="Records Added" subtitle="Last 6 months — click a bar to drill down" />
                <CardContent className="p-1 h-[160px]">
                  <EChart option={trendOption} eventHandlers={trendClickEvents} />
                </CardContent>
              </Card>
              <Card>
                <ChartHeader title="By Data Source" subtitle="Click a segment to drill down" />
                <CardContent className="p-1 h-[160px]">
                  <EChart option={statusOption} eventHandlers={fieldClickEvents("ucdb_status", byStatus, "Source")} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <ChartHeader title="Daily Activity" subtitle="Last 3 months — click a day to drill down" />
              <CardContent className="p-1 h-[190px]">
                <EChart option={activityOption} eventHandlers={activityClickEvents} />
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card className="lg:col-span-2">
                <ChartHeader title="By Industry" subtitle="Click a tile to drill down" />
                <CardContent className="p-1 h-[230px]">
                  <EChart option={industryOption} eventHandlers={fieldClickEvents("industry", byIndustry, "Industry")} />
                </CardContent>
              </Card>
              <Card>
                <ChartHeader title="By Designation Level" subtitle="Seniority mix — click to drill down" />
                <CardContent className="p-1 h-[230px]">
                  <EChart option={designationLevelOption} eventHandlers={fieldClickEvents("designation_level", byDesignationLevel, "Designation level")} />
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card>
                <ChartHeader title="Top States" subtitle="Click a bar to drill down" />
                <CardContent className="p-1 h-[230px]">
                  <EChart option={statesOption} eventHandlers={fieldClickEvents("state", byState, "State")} />
                </CardContent>
              </Card>
              <Card>
                <ChartHeader title="Top Cities" subtitle="Click a bar to drill down" />
                <CardContent className="p-1 h-[230px]">
                  <EChart option={cityOption} eventHandlers={fieldClickEvents("city", byCity, "City")} />
                </CardContent>
              </Card>
              <Card>
                <ChartHeader title="By Company Size" subtitle="Employees — click to drill down" />
                <CardContent className="p-1 h-[230px]">
                  <EChart option={employeeSizeOption} eventHandlers={fieldClickEvents("employee_size", byEmployeeSize, "Company size")} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <ChartHeader
                title="Top Companies"
                subtitle="By number of contacts — click a bar to drill down"
                extra={<Badge variant="secondary">{byCompany.length}</Badge>}
              />
              <CardContent className="p-1 h-[280px]">
                <EChart option={companyOption} eventHandlers={fieldClickEvents("company_name", byCompany, "Company")} />
              </CardContent>
            </Card>

            {/* Missing contact info */}
            {missingBuckets.length > 0 && (
              <Card>
                <ChartHeader
                  title="Missing Contact Info"
                  subtitle="Records that can't currently be called or emailed"
                  extra={<Badge variant="secondary">{missingBuckets.reduce((s, b) => s + b.rows.length, 0)}</Badge>}
                />
                <CardContent className="p-3">
                  <TooltipProvider delayDuration={200}>
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(missingBuckets.length, 3)}, minmax(0, 1fr))` }}>
                      {missingBuckets.map((b) => (
                        <div key={b.label} className={`rounded-lg border ${b.border} ${b.bg} p-2.5`}>
                          <div className={`text-[11px] font-semibold ${b.text} mb-2 flex items-center gap-1.5`}>
                            <span className={`inline-block w-2 h-2 rounded-full ${b.dot}`} />
                            {b.label}
                            <span className="ml-auto font-normal opacity-60">{b.rows.length}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {b.rows.slice(0, 24).map((r) => (
                              <Tooltip key={r.id}>
                                <TooltipTrigger asChild>
                                  <button className={`text-[11px] px-2 py-0.5 rounded border bg-white ${b.pill} font-medium transition-colors cursor-default`}>
                                    {r.full_name || r.company_name || "—"}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  <p className="font-semibold mb-0.5">{r.full_name || "—"}</p>
                                  <p>{r.company_name || "—"}</p>
                                  <p>{r.designation || "—"}</p>
                                </TooltipContent>
                              </Tooltip>
                            ))}
                          </div>
                          {b.rows.length > 24 && (
                            <button
                              className="mt-2 text-[11px] text-muted-foreground underline underline-offset-2"
                              onClick={() => setDrilldown({ label: b.label, rows: b.rows })}
                            >
                              +{b.rows.length - 24} more — view all
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </TooltipProvider>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Drill-down dialog */}
      <Dialog open={!!drilldown} onOpenChange={(open) => { if (!open) setDrilldown(null); }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Records — {drilldown?.label}
                <Badge variant="secondary">{drilldown?.rows.length ?? 0}</Badge>
              </DialogTitle>
              {drilldown && drilldown.rows.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportDrilldownCsv}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Export
                </Button>
              )}
            </div>
          </DialogHeader>
          {drilldown && drilldown.rows.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Company</TableHead>
                    <TableHead className="text-xs">Full Name</TableHead>
                    <TableHead className="text-xs">Designation</TableHead>
                    <TableHead className="text-xs">City / State</TableHead>
                    <TableHead className="text-xs">Mobile</TableHead>
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Added On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drilldown.rows.slice(0, 500).map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs max-w-[160px] truncate" title={r.company_name || ""}>{r.company_name || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate" title={r.full_name || ""}>{r.full_name || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={r.designation || ""}>{r.designation || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.mobile_number_1 || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[170px] truncate" title={r.official_email || ""}>{r.official_email || r.personal_email_1 || r.personal_email_2 || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "dd MMM ''yy")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {drilldown.rows.length > 500 && (
                <p className="text-center text-[11px] text-muted-foreground py-2 border-t bg-muted/30">
                  Showing first 500 of {drilldown.rows.length} — export CSV for the full list.
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm py-10">No records found for this slice.</p>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function KpiCard({ icon, label, value, accent, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent: string; onClick?: () => void }) {
  return (
    <Card className={`overflow-hidden transition-shadow hover:shadow-md ${onClick ? "cursor-pointer" : ""}`} onClick={onClick}>
      <CardContent className="flex items-center gap-2.5 p-2.5" style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}1A`, color: accent }}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] text-muted-foreground leading-tight">{label}</p>
          <p className="text-lg font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 p-3 pb-1">
      <div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground leading-tight">{subtitle}</p>}
      </div>
      {extra}
    </div>
  );
}
