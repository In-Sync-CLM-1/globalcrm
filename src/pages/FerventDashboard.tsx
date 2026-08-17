import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { addMonths, differenceInCalendarMonths, format, startOfMonth, subMonths } from "date-fns";
import { Database, Building2, Mail, Phone, TrendingUp, ArrowRight, SlidersHorizontal, Download, X, UserX, Users, Globe2 } from "lucide-react";
import * as echarts from "echarts";
import { useIsFervent, FERVENT_ORG_ID } from "@/hooks/useIsFervent";
import { EChart } from "@/components/charts/EChart";
import { getFerventChartTheme } from "@/components/FerventDashboard/ferventChartTheme";
import { exportToCSV } from "@/utils/exportUtils";
import worldGeo from "@/assets/worldMap.json";
import { canonicalCountry, SMALL_NATION_COORDS } from "@/components/FerventDashboard/countryData";
import {
  buildTrendOption,
  buildIndustryTreemapOption,
  buildDesignationDonutOption,
  buildRankedBarOption,
  buildStatusSegmentOption,
  buildDailyActivityHeatmapOption,
  buildWorldHeatmapOption,
  buildGeoSplitDonutOption,
  UNSPECIFIED,
} from "@/components/FerventDashboard/ferventChartOptions";
import "@/components/FerventDashboard/ferventEditorial.css";

echarts.registerMap("World", worldGeo as any);

interface RepoRow {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  designation: string | null;
  designation_level: string | null;
  department: string | null;
  industry: string | null;
  employee_size: string | null;
  ucdb_status: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
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
  country: string;
  source: string;
}

const emptyFilters: FilterState = {
  dateFrom: "", dateTo: "", industry: "all", designationLevel: "all",
  designation: "all", city: "all", state: "all", country: "all", source: "all",
};

function normalizeKey(raw: string | null): string {
  return (typeof raw === "string" ? raw.trim() : "") || UNSPECIFIED;
}

function fieldMatches(value: string | null, filterValue: string, mode: "exact" | "contains"): boolean {
  const key = normalizeKey(value);
  if (mode === "contains") return key.toLowerCase().includes(filterValue.toLowerCase());
  return key === filterValue;
}

function displayName(r: Pick<RepoRow, "first_name" | "last_name">): string {
  return [r.first_name, r.last_name].filter((v) => v && v.trim()).join(" ").trim();
}

// A pre-existing import-mapping bug left these exact data-source labels
// (identical to the values ucdb_status uses) sitting in `designation` for
// ~31% of records, dominating the "By Designation" ranking over every real
// job title. Excluded from that chart only — the underlying rows aren't
// touched, and the same exclusion is applied in the SQL cache function.
const DESIGNATION_SOURCE_LABELS = new Set(["Vendor DB", "Fervent DB", "Lusha"]);

// A grouped dimension where the only real bucket is "Unspecified" carries
// zero information (this dataset's designation_level is 100% untagged) — an
// all-gray donut/bar for that is exactly the "meaningless information" a
// redesign should remove, so callers render an empty state instead of the
// chart when this is true.
// threshold defaults to "entirely untagged" (designation_level: 100% blank);
// Top States passes a looser bar since its untagged share isn't literally
// 100% — see foldPlaceholders below, "IND" folds into Unspecified too and
// the combined share clears 90%+, which is just as uninformative as blank.
function isUntagged(grouped: { name: string; value: number }[], threshold = 1): boolean {
  const total = grouped.reduce((s, d) => s + d.value, 0) || 1;
  const unspecified = grouped.find((d) => d.name === UNSPECIFIED)?.value || 0;
  return unspecified / total >= threshold;
}

// `state`/`city` both carry a literal "IND"/"India" placeholder for a large
// slice of records instead of an actual state/city (found live while
// checking this redesign) — not a real place, so it folds into the same
// "Unspecified" bucket rather than showing up as if it were a real state
// named "IND" outranking every real state in the leaderboard.
const PLACE_PLACEHOLDER_LABELS = new Set(["ind", "india"]);
function foldPlaceholders(grouped: { name: string; value: number }[]): { name: string; value: number }[] {
  const m = new Map<string, number>();
  grouped.forEach(({ name, value }) => {
    const key = PLACE_PLACEHOLDER_LABELS.has(name.trim().toLowerCase()) ? UNSPECIFIED : name;
    m.set(key, (m.get(key) || 0) + value);
  });
  return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
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
  const [matchMode, setMatchMode] = useState<"exact" | "contains">("exact");
  const [drilldown, setDrilldown] = useState<{ label: string; rows: RepoRow[] } | null>(null);

  // Full row set powers interactive filtering, drilldown, and CSV export —
  // still fetched in full, but no longer blocks the initial paint (see
  // cacheQuery below). Loads in the background; the moment it lands, every
  // chart/stat below seamlessly swaps from the cached snapshot to live data.
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
            "id, company_name, first_name, last_name, designation, designation_level, department, industry, employee_size, ucdb_status, city, state, country, official_email, personal_email_1, personal_email_2, mobile_number_1, created_at"
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

  // Pre-aggregated snapshot (refreshed every 5 min by a cron worker, RMPL's
  // dashboard-cache pattern — see refresh_fervent_dashboard_cache). Loads in
  // a handful of milliseconds regardless of repository size, so the page can
  // paint instantly instead of waiting on the full-table fetch above.
  const { data: cache, isLoading: cacheLoading } = useQuery({
    queryKey: ["fervent-dashboard-cache"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fervent_dashboard_cache")
        .select("*")
        .eq("org_id", FERVENT_ORG_ID)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const activeFilters =
    (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0) +
    (filters.industry !== "all" ? 1 : 0) + (filters.designationLevel !== "all" ? 1 : 0) +
    (filters.designation !== "all" ? 1 : 0) + (filters.city !== "all" ? 1 : 0) +
    (filters.state !== "all" ? 1 : 0) + (filters.country !== "all" ? 1 : 0) + (filters.source !== "all" ? 1 : 0);

  // Use the cache while the full row set is still loading and no filter is
  // applied (filters need real rows to answer). Once `rows` lands, or a
  // filter is touched, everything below switches to live computation from
  // filteredRows — same as this page always worked, just no longer gating
  // the first paint on it.
  const showCache = !!cache && rows.length === 0 && activeFilters === 0;

  const filterOptions = useMemo(() => {
    if (cache?.filter_options && (showCache || rows.length === 0)) {
      const fo = cache.filter_options as Record<string, string[]>;
      return {
        industry: fo.industry || [],
        designationLevel: fo.designationLevel || [],
        designation: fo.designation || [],
        city: fo.city || [],
        state: fo.state || [],
        country: fo.country || [],
        source: fo.source || [],
      };
    }
    return {
      industry: distinctOptions(rows, "industry"),
      designationLevel: distinctOptions(rows, "designation_level"),
      designation: distinctOptions(rows.filter((r) => !DESIGNATION_SOURCE_LABELS.has((r.designation || "").trim())), "designation"),
      city: distinctOptions(rows, "city"),
      state: distinctOptions(rows, "state"),
      country: distinctOptions(rows, "country"),
      source: distinctOptions(rows, "ucdb_status"),
    };
  }, [rows, cache, showCache]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filters.dateFrom && new Date(r.created_at) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(r.created_at) > new Date(`${filters.dateTo}T23:59:59`)) return false;
      if (filters.industry !== "all" && !fieldMatches(r.industry, filters.industry, matchMode)) return false;
      if (filters.designationLevel !== "all" && !fieldMatches(r.designation_level, filters.designationLevel, matchMode)) return false;
      if (filters.designation !== "all" && !fieldMatches(r.designation, filters.designation, matchMode)) return false;
      if (filters.city !== "all" && !fieldMatches(r.city, filters.city, matchMode)) return false;
      if (filters.state !== "all" && !fieldMatches(r.state, filters.state, matchMode)) return false;
      if (filters.country !== "all" && !fieldMatches(r.country, filters.country, matchMode)) return false;
      if (filters.source !== "all" && !fieldMatches(r.ucdb_status, filters.source, matchMode)) return false;
      return true;
    });
  }, [rows, filters, matchMode]);

  const stats = useMemo(() => {
    if (showCache && cache) {
      const total = cache.total_count || 0;
      const withEmail = cache.with_email_count || 0;
      const withMobile = cache.with_mobile_count || 0;
      return {
        total, companies: cache.companies_count || 0, withEmail, withMobile,
        industries: cache.industries_count || 0, addedThisMonth: cache.added_this_month_count || 0,
        emailCoverage: total ? Math.round((withEmail / total) * 100) : 0,
        mobileCoverage: total ? Math.round((withMobile / total) * 100) : 0,
        missingBoth: cache.missing_both_count || 0,
      };
    }
    const total = filteredRows.length;
    const companies = new Set(
      filteredRows.map((r) => r.company_name?.trim()).filter((v): v is string => !!v && !/^\d+$/.test(v))
    ).size;
    const withEmail = filteredRows.filter(hasEmail).length;
    const withMobile = filteredRows.filter(hasMobile).length;
    const industries = new Set(filteredRows.map((r) => r.industry).filter(Boolean)).size;
    const monthStart = startOfMonth(new Date());
    const addedThisMonth = filteredRows.filter((r) => new Date(r.created_at) >= monthStart).length;
    const missingBoth = filteredRows.filter((r) => !hasEmail(r) && !hasMobile(r)).length;
    const emailCoverage = total ? Math.round((withEmail / total) * 100) : 0;
    const mobileCoverage = total ? Math.round((withMobile / total) * 100) : 0;
    return { total, companies, withEmail, withMobile, industries, addedThisMonth, emailCoverage, mobileCoverage, missingBoth };
  }, [filteredRows, showCache, cache]);

  type Grouped = { name: string; value: number }[];
  const byIndustry = useMemo<Grouped>(() => (showCache && cache ? cache.by_industry : groupBy(filteredRows, "industry")), [filteredRows, showCache, cache]);
  const byDesignationLevel = useMemo<Grouped>(() => (showCache && cache ? cache.by_designation_level : groupBy(filteredRows, "designation_level")), [filteredRows, showCache, cache]);
  const byStatus = useMemo<Grouped>(() => (showCache && cache ? cache.by_status : groupBy(filteredRows, "ucdb_status")), [filteredRows, showCache, cache]);
  const byState = useMemo<Grouped>(() => foldPlaceholders(showCache && cache ? cache.by_state : groupBy(filteredRows, "state")), [filteredRows, showCache, cache]);
  const byCity = useMemo<Grouped>(() => foldPlaceholders(showCache && cache ? cache.by_city : groupBy(filteredRows, "city")), [filteredRows, showCache, cache]);
  const byDesignation = useMemo<Grouped>(() => {
    if (showCache && cache) return cache.by_designation;
    const realDesignationRows = filteredRows.filter((r) => !DESIGNATION_SOURCE_LABELS.has((r.designation || "").trim()));
    return groupBy(realDesignationRows, "designation");
  }, [filteredRows, showCache, cache]);
  const byEmployeeSize = useMemo<Grouped>(() => (showCache && cache ? cache.by_employee_size : groupBy(filteredRows, "employee_size")), [filteredRows, showCache, cache]);
  const byCompany = useMemo<Grouped>(() => {
    if (showCache && cache) return cache.by_company;
    const realCompanyRows = filteredRows.filter((r) => !/^\d+$/.test((r.company_name || "").trim()));
    return groupBy(realCompanyRows, "company_name");
  }, [filteredRows, showCache, cache]);
  const byCountry = useMemo<Grouped>(() => (showCache && cache?.by_country ? cache.by_country : groupBy(filteredRows, "country")), [filteredRows, showCache, cache]);

  // Classify the raw country breakdown into the world map's polygon data
  // (mapCountries), point-marker small nations (Singapore/Hong Kong — too
  // small to render as filled regions), and the domestic/international/
  // unclassified split. A raw country value that doesn't match a real
  // country (the import-mapping bug that left company names in this field
  // for a chunk of records — see countryData.ts) lands in "unclassified",
  // never silently counted as India or folded into another country.
  const { mapCountries, smallNationData, geoSplit } = useMemo(() => {
    const polyMap = new Map<string, number>();
    const smallMap = new Map<string, number>();
    let domestic = 0, international = 0, unclassified = 0;
    byCountry.forEach(({ name, value }) => {
      const canon = canonicalCountry(name);
      if (!canon) { unclassified += value; return; }
      if (canon === "India") domestic += value;
      else international += value;
      if (SMALL_NATION_COORDS[canon]) smallMap.set(canon, (smallMap.get(canon) || 0) + value);
      else polyMap.set(canon, (polyMap.get(canon) || 0) + value);
    });
    return {
      mapCountries: Array.from(polyMap.entries()).map(([name, value]) => ({ name, value })),
      smallNationData: Array.from(smallMap.entries()).map(([name, value]) => ({ name, value })),
      geoSplit: { domestic, international, unclassified },
    };
  }, [byCountry]);

  const topInternational = useMemo(
    () => [...mapCountries, ...smallNationData].filter((c) => c.name !== "India").sort((a, b) => b.value - a.value),
    [mapCountries, smallNationData]
  );

  const missingBuckets = useMemo(() => {
    const both = filteredRows.filter((r) => !hasEmail(r) && !hasMobile(r));
    const emailOnly = filteredRows.filter((r) => !hasEmail(r) && hasMobile(r));
    const mobileOnly = filteredRows.filter((r) => hasEmail(r) && !hasMobile(r));
    return [
      { label: "Missing mobile & email", rows: both, severity: "critical" as const },
      { label: "Missing email only", rows: emailOnly, severity: "warning" as const },
      { label: "Missing mobile only", rows: mobileOnly, severity: "info" as const },
    ].filter((b) => b.rows.length > 0);
  }, [filteredRows]);

  // The month this org's data actually begins. Charts start here rather than a
  // fixed number of months back, so the period before they came onto the
  // platform doesn't render as a run of empty columns. Derived from the
  // unfiltered rows so the axis doesn't shift around as filters are applied.
  const dataStartMonth = useMemo(() => {
    if (showCache && cache?.data_start_month) return startOfMonth(new Date(cache.data_start_month));
    let earliest: number | null = null;
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      if (!Number.isNaN(t) && (earliest === null || t < earliest)) earliest = t;
    }
    return startOfMonth(earliest === null ? new Date() : new Date(earliest));
  }, [rows, showCache, cache]);

  const monthlyTrend = useMemo(() => {
    const months: { key: string; label: string; count: number }[] = [];
    const currentMonth = startOfMonth(new Date());
    // Still a rolling six-month window once there's enough history for one.
    const windowStart = startOfMonth(subMonths(currentMonth, 5));
    const start = dataStartMonth > windowStart ? dataStartMonth : windowStart;
    const span = differenceInCalendarMonths(currentMonth, start);
    for (let i = 0; i <= span; i++) {
      const d = addMonths(start, i);
      months.push({ key: format(d, "yyyy-MM"), label: format(d, "MMM"), count: 0 });
    }
    const map = new Map(months.map((m) => [m.key, m]));
    if (showCache && cache?.monthly_counts) {
      const counts = cache.monthly_counts as Record<string, number>;
      Object.entries(counts).forEach(([key, count]) => {
        const bucket = map.get(key);
        if (bucket) bucket.count = count;
      });
    } else {
      filteredRows.forEach((r) => {
        const key = format(new Date(r.created_at), "yyyy-MM");
        const bucket = map.get(key);
        if (bucket) bucket.count++;
      });
    }
    return months;
  }, [filteredRows, dataStartMonth, showCache, cache]);

  const monthKeyMap = useMemo(() => {
    const m: Record<string, string> = {};
    monthlyTrend.forEach((b) => (m[b.label] = b.key));
    return m;
  }, [monthlyTrend]);

  // Daily activity heatmap — last 3 full months, so the calendar grid stays a
  // compact 3-row block rather than sprawling across a year, and never starting
  // before this org's first record.
  const activityRange = useMemo((): [string, string] => {
    const windowStart = startOfMonth(subMonths(new Date(), 2));
    const start = dataStartMonth > windowStart ? dataStartMonth : windowStart;
    return [format(start, "yyyy-MM-dd"), format(new Date(), "yyyy-MM-dd")];
  }, [dataStartMonth]);

  const dailyActivity = useMemo(() => {
    if (showCache && cache?.daily_counts) {
      const counts = cache.daily_counts as Record<string, number>;
      return Object.entries(counts).map(([date, count]) => ({ date, count }));
    }
    const m = new Map<string, number>();
    filteredRows.forEach((r) => {
      const key = format(new Date(r.created_at), "yyyy-MM-dd");
      m.set(key, (m.get(key) || 0) + 1);
    });
    return Array.from(m.entries()).map(([date, count]) => ({ date, count }));
  }, [filteredRows, showCache, cache]);

  const trendOption = useMemo(() => buildTrendOption(monthlyTrend, theme), [monthlyTrend, theme]);
  const industryOption = useMemo(() => buildIndustryTreemapOption(byIndustry, theme), [byIndustry, theme]);
  const designationLevelOption = useMemo(() => buildDesignationDonutOption(byDesignationLevel, theme), [byDesignationLevel, theme]);
  const statesOption = useMemo(() => buildRankedBarOption(byState, theme, { topN: 8, color: theme.categorical[4] }), [byState, theme]);
  const citiesOption = useMemo(() => buildRankedBarOption(byCity, theme, { topN: 8, color: theme.categorical[5] }), [byCity, theme]);
  const worldHeatmapOption = useMemo(
    () => buildWorldHeatmapOption(mapCountries, smallNationData, theme, SMALL_NATION_COORDS),
    [mapCountries, smallNationData, theme]
  );
  const geoSplitOption = useMemo(
    () => buildGeoSplitDonutOption(geoSplit.domestic, geoSplit.international, geoSplit.unclassified, theme),
    [geoSplit, theme]
  );
  const topInternationalOption = useMemo(
    () => buildRankedBarOption(topInternational, theme, { topN: 8, color: theme.categorical[2], labelWidth: 110 }),
    [topInternational, theme]
  );
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

  const worldMapClickEvents = {
    click: (p: any) => {
      if (!p.name) return;
      drill(`Country: ${p.name}`, (r) => canonicalCountry(r.country) === p.name);
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
    push("Country", byCountry);
    push("State", byState);
    push("City", byCity);
    push("Employee Size", byEmployeeSize);
    lines.push("");
    lines.push("Top Companies,Company,Contacts");
    byCompany.slice(0, 50).forEach((c) => lines.push(`Company,${csvEscape(c.name)},${c.value}`));
    lines.push("");
    lines.push("Missing Contact Info,Company,Name,Reason,Mobile,Email,Added On");
    missingBuckets.forEach((b) =>
      b.rows.forEach((r) => {
        lines.push(
          `Missing,${csvEscape(r.company_name || "")},${csvEscape(displayName(r))},${csvEscape(b.label)},${csvEscape(r.mobile_number_1 || "")},${csvEscape(
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
        { key: "first_name", label: "First Name" },
        { key: "last_name", label: "Last Name" },
        { key: "designation", label: "Designation" },
        { key: "department", label: "Department" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
        { key: "country", label: "Country" },
        { key: "mobile_number_1", label: "Phone 1" },
        { key: "official_email", label: "Official Email" },
        { key: "created_at", label: "Added On", format: (v: string) => format(new Date(v), "yyyy-MM-dd") },
      ],
      `fervent-drilldown-${format(new Date(), "yyyyMMdd-HHmm")}`
    );
  };

  // Block only until SOMETHING is ready to show — the cache (fast, near-
  // instant) in the common case, or the full row set if cache isn't ready
  // yet (e.g. a brand-new org with no cache row written yet).
  if (orgLoading || (isLoading && cacheLoading)) {
    return (
      <DashboardLayout>
        <div className="fervent-editorial -m-3 sm:-m-4 lg:-m-6 p-8 min-h-[calc(100vh-3rem)]">
          <p className="editorial-eyebrow">Fervent Database</p>
          <p className="mt-3 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Loading dashboard…</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="fervent-editorial -m-3 sm:-m-4 lg:-m-6 p-3 sm:p-4 lg:p-6 min-h-[calc(100vh-3rem)]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="editorial-eyebrow">Fervent Communication · Data Repository</p>
              <h1 className="editorial-display text-[1.75rem] sm:text-[2.1rem] leading-none mt-1.5" style={{ textWrap: "balance" }}>
                Vendor &amp; lead database
              </h1>
              <p className="mt-1.5 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                {stats.total.toLocaleString()} records, tracked across {mapCountries.length + smallNationData.length + 1} countries.
                {isLoading && <span className="ml-1 text-xs italic">Refreshing live data — filtering and drilldown ready shortly.</span>}
              </p>
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
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Match mode</Label>
                        <ToggleGroup
                          type="single"
                          size="sm"
                          value={matchMode}
                          onValueChange={(v) => v && setMatchMode(v as "exact" | "contains")}
                        >
                          <ToggleGroupItem value="exact" className="text-xs px-2.5 h-7">Exact</ToggleGroupItem>
                          <ToggleGroupItem value="contains" className="text-xs px-2.5 h-7">Contains</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
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
                        ["country", "Country"],
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
              <Button size="sm" asChild>
                <Link to="/data-repository" className="gap-1.5">
                  Open Database <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          {stats.total === 0 ? (
            <div className="editorial-card py-20 text-center space-y-3">
              <Database className="h-10 w-10 mx-auto" style={{ color: "hsl(var(--muted-foreground))" }} />
              <p style={{ color: "hsl(var(--muted-foreground))" }}>
                {activeFilters > 0 ? "No records match the current filters." : "No records yet. Import your database to see insights here."}
              </p>
              <Button asChild>
                <Link to="/data-repository">Go to Fervent Database</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Hero — global heatmap is the centerpiece, domestic/international split and
                  top international markets fill the rest of the row so nothing sits empty */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="editorial-card lg:col-span-2 lg:row-span-2 overflow-hidden">
                  <ChartHeader
                    icon={<Globe2 className="h-4 w-4" style={{ color: "hsl(var(--primary))" }} />}
                    title="Global footprint"
                    subtitle="Every country with records, colored by volume — click a country to drill down"
                  />
                  <div className="p-1 h-[440px]">
                    <EChart option={worldHeatmapOption} eventHandlers={worldMapClickEvents} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="Domestic vs. international" subtitle="India vs. rest of world" />
                  <div className="p-1 h-[210px]">
                    <EChart option={geoSplitOption} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="Top international markets" subtitle="Click a bar to drill down" />
                  <div className="p-1 h-[210px]">
                    <EChart option={topInternationalOption} eventHandlers={fieldClickEvents("country", topInternational, "Country")} />
                  </div>
                </div>
              </div>

              {/* Stat rail — data completeness at a glance, editorial numerals in a single divided row */}
              <div className="editorial-card">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: "hsl(var(--border))" }}>
                  <StatCell icon={<Database size={14} />} label="Total records" value={stats.total.toLocaleString()} />
                  <StatCell icon={<Building2 size={14} />} label="Companies" value={stats.companies.toLocaleString()} />
                  <StatCell icon={<TrendingUp size={14} />} label="Added this month" value={stats.addedThisMonth.toLocaleString()} />
                  <StatCell icon={<Mail size={14} />} label="Email coverage" value={`${stats.emailCoverage}%`} />
                  <StatCell icon={<Phone size={14} />} label="Mobile coverage" value={`${stats.mobileCoverage}%`} />
                  <StatCell
                    icon={<UserX size={14} />}
                    label="Missing both"
                    value={stats.missingBoth.toLocaleString()}
                    tone="critical"
                    onClick={stats.missingBoth > 0 ? () => drill("Missing mobile & email", (r) => !hasEmail(r) && !hasMobile(r)) : undefined}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="Records added" subtitle="Last 6 months — click a bar to drill down" />
                  <div className="p-1 h-[200px]">
                    <EChart option={trendOption} eventHandlers={trendClickEvents} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="By data source" subtitle="Click a segment to drill down" />
                  <div className="p-1 h-[200px]">
                    <EChart option={statusOption} eventHandlers={fieldClickEvents("ucdb_status", byStatus, "Source")} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="Daily activity" subtitle="Last 3 months — click a day to drill down" />
                  <div className="p-1 h-[200px]">
                    <EChart option={activityOption} eventHandlers={activityClickEvents} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="By designation" subtitle="Top job titles — click to drill down" />
                  <div className="p-1 h-[230px]">
                    <EChart option={designationOption} eventHandlers={fieldClickEvents("designation", byDesignation, "Designation")} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="By industry" subtitle="Click a tile to drill down" />
                  <div className="p-1 h-[230px]">
                    <EChart option={industryOption} eventHandlers={fieldClickEvents("industry", byIndustry, "Industry")} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="By designation level" subtitle="Seniority mix — click to drill down" />
                  <div className="p-1 h-[230px]">
                    {isUntagged(byDesignationLevel) ? (
                      <EmptyChartState label="designation level" />
                    ) : (
                      <EChart option={designationLevelOption} eventHandlers={fieldClickEvents("designation_level", byDesignationLevel, "Designation level")} />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="Top cities (India)" subtitle="Click a bar to drill down" />
                  <div className="p-1 h-[230px]">
                    <EChart option={citiesOption} eventHandlers={fieldClickEvents("city", byCity, "City")} />
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="Top states (India)" subtitle="Click a bar to drill down" />
                  <div className="p-1 h-[230px]">
                    {isUntagged(byState, 0.9) ? (
                      <EmptyChartState label="state" />
                    ) : (
                      <EChart option={statesOption} eventHandlers={fieldClickEvents("state", byState, "State")} />
                    )}
                  </div>
                </div>
                <div className="editorial-card overflow-hidden">
                  <ChartHeader title="By company size" subtitle="Employees — click to drill down" />
                  <div className="p-1 h-[230px]">
                    <EChart option={employeeSizeOption} eventHandlers={fieldClickEvents("employee_size", byEmployeeSize, "Company size")} />
                  </div>
                </div>
              </div>

              <div className="editorial-card overflow-hidden">
                <ChartHeader
                  title="Top companies"
                  subtitle="By number of contacts — click a bar to drill down"
                  extra={<Badge variant="secondary">{byCompany.length}</Badge>}
                />
                <div className="p-1 h-[280px]">
                  <EChart option={companyOption} eventHandlers={fieldClickEvents("company_name", byCompany, "Company")} />
                </div>
              </div>

              {/* Missing contact info */}
              {missingBuckets.length > 0 && (
                <div className="editorial-card">
                  <ChartHeader
                    title="Missing contact info"
                    subtitle="Records that can't currently be called or emailed"
                    extra={<Badge variant="secondary">{missingBuckets.reduce((s, b) => s + b.rows.length, 0)}</Badge>}
                  />
                  <div className="p-3">
                    <TooltipProvider delayDuration={200}>
                      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(missingBuckets.length, 3)}, minmax(0, 1fr))` }}>
                        {missingBuckets.map((b) => (
                          <MissingBucket key={b.label} label={b.label} rows={b.rows} severity={b.severity} onViewAll={() => setDrilldown({ label: b.label, rows: b.rows })} />
                        ))}
                      </div>
                    </TooltipProvider>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Drill-down dialog */}
        <Dialog open={!!drilldown} onOpenChange={(open) => { if (!open) setDrilldown(null); }}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2 pr-6">
                <DialogTitle className="flex items-center gap-2 editorial-display font-semibold">
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
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Designation</TableHead>
                      <TableHead className="text-xs">City / State</TableHead>
                      <TableHead className="text-xs">Country</TableHead>
                      <TableHead className="text-xs">Mobile</TableHead>
                      <TableHead className="text-xs">Email</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Added On</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drilldown.rows.slice(0, 500).map((r) => (
                      <TableRow key={r.id} className="hover:bg-muted/30">
                        <TableCell className="text-xs max-w-[160px] truncate" title={r.company_name || ""}>{r.company_name || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate" title={displayName(r)}>{displayName(r) || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate" title={r.designation || ""}>{r.designation || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.country || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.mobile_number_1 || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[170px] truncate" title={r.official_email || ""}>{r.official_email || r.personal_email_1 || r.personal_email_2 || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "dd MMM ''yy")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {drilldown.rows.length > 500 && (
                  <p className="text-center text-[11px] py-2 border-t bg-muted/30" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Showing first 500 of {drilldown.rows.length} — export CSV for the full list.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-center text-sm py-10" style={{ color: "hsl(var(--muted-foreground))" }}>No records found for this slice.</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function StatCell({
  icon, label, value, tone, onClick,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "critical"; onClick?: () => void }) {
  const valueColor = tone === "critical" ? "hsl(var(--primary))" : "hsl(var(--foreground))";
  return (
    <div
      className={`flex flex-col gap-1 p-4 ${onClick ? "cursor-pointer transition-colors hover:bg-[hsl(var(--accent))]" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
        {icon}
        <span className="editorial-eyebrow">{label}</span>
      </div>
      <span className="editorial-figure text-2xl font-semibold leading-none" style={{ color: valueColor }}>{value}</span>
    </div>
  );
}

function ChartHeader({ title, subtitle, extra, icon }: { title: string; subtitle?: string; extra?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 p-4 pb-2">
      <div className="flex items-start gap-1.5">
        {icon && <span className="mt-0.5">{icon}</span>}
        <div>
          <h3 className="editorial-display text-[0.95rem] font-semibold leading-tight" style={{ textWrap: "balance" }}>{title}</h3>
          {subtitle && <p className="text-[11px] leading-tight mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{subtitle}</p>}
        </div>
      </div>
      {extra}
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>No {label} has been tagged on these records yet.</p>
    </div>
  );
}

// Severity stripe on the left edge (not color-alone) + a small caption noting
// what the missing info actually blocks — matches the dataviz skill's rule
// that state gets encoded in form as well as color.
const SEVERITY_STYLES: Record<"critical" | "warning" | "info", { stripe: string; dot: string; note: string }> = {
  critical: { stripe: "hsl(var(--primary))", dot: "hsl(var(--primary))", note: "Can't be reached at all" },
  warning: { stripe: "38 70% 48%", dot: "38 70% 48%", note: "Can be called, not emailed" },
  info: { stripe: "205 45% 46%", dot: "205 45% 46%", note: "Can be emailed, not called" },
};

function MissingBucket({
  label, rows, severity, onViewAll,
}: { label: string; rows: RepoRow[]; severity: "critical" | "warning" | "info"; onViewAll: () => void }) {
  const s = SEVERITY_STYLES[severity];
  const stripeColor = severity === "critical" ? s.stripe : `hsl(${s.stripe})`;
  const dotColor = severity === "critical" ? s.dot : `hsl(${s.dot})`;
  return (
    <div className="rounded-md border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderLeft: `3px solid ${stripeColor}`, background: "hsl(var(--accent) / 0.5)" }}>
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>· {s.note}</span>
        <span className="ml-auto editorial-figure text-[11px] font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{rows.length}</span>
      </div>
      <div className="p-2.5 flex flex-wrap gap-1.5">
        {rows.slice(0, 24).map((r) => (
          <Tooltip key={r.id}>
            <TooltipTrigger asChild>
              <button
                className="text-[11px] px-2 py-0.5 rounded border font-medium transition-colors cursor-default"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                {displayName(r) || r.company_name || "—"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-semibold mb-0.5">{displayName(r) || "—"}</p>
              <p>{r.company_name || "—"}</p>
              <p>{r.designation || "—"}</p>
            </TooltipContent>
          </Tooltip>
        ))}
        {rows.length > 24 && (
          <button
            className="text-[11px] underline underline-offset-2 self-center"
            style={{ color: "hsl(var(--muted-foreground))" }}
            onClick={onViewAll}
          >
            +{rows.length - 24} more — view all
          </button>
        )}
      </div>
    </div>
  );
}
