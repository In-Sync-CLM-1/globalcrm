import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingState } from "@/components/common/LoadingState";
import { useNotification } from "@/hooks/useNotification";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { usePagination } from "@/hooks/usePagination";
import PaginationControls from "@/components/common/PaginationControls";
import { BulkDeleteButton } from "@/components/common/BulkDeleteButton";
import { requestExport } from "@/lib/exportJobs";
import { FerventBulkUploadDialog } from "@/components/FerventRepository/FerventBulkUploadDialog";
import { FerventActiveUploadProgress } from "@/components/FerventRepository/FerventActiveUploadProgress";
import { useFerventActiveImportJob } from "@/hooks/useFerventActiveImportJob";
import { FerventRecordActivity } from "@/components/FerventRepository/FerventRecordActivity";
import { ExportHistoryDialog } from "@/components/Exports/ExportHistoryDialog";
import { FerventImportHistory } from "@/components/FerventRepository/FerventImportHistory";
import { FerventEditRecordDialog } from "@/components/FerventRepository/FerventEditRecordDialog";
import { FerventBulkEditDialog } from "@/components/FerventRepository/FerventBulkEditDialog";
import { FerventAdvancedSearch } from "@/components/FerventRepository/FerventAdvancedSearch";
import { FerventSavedSearches } from "@/components/FerventRepository/FerventSavedSearches";
import { TurnoverRangeFilter } from "@/components/FerventRepository/TurnoverRangeFilter";
import { EMPLOYEE_SIZE_BUCKETS, formatTurnoverUsdMillion } from "@/components/FerventRepository/ferventFieldNormalization";
import {
  applyBooleanQuery,
  emptyBooleanQuery,
  isBooleanQueryEmpty,
  type BooleanQuery,
  type SavedSearchDefinition,
} from "@/components/FerventRepository/ferventBooleanSearch";
import { Upload, Download, Search, X, Phone, MessageSquare, GitBranch, Lock, History, Pencil, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useUrlObjectState } from "@/hooks/useUrlState";
import { useUrlState } from "@/hooks/useUrlState";

export interface RepositoryRecord {
  id: string;
  unique_id: string | null;
  upload_status: string | null;
  source_type: string | null;
  db_sourced_year: number | null;
  ucdb_status: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  designation: string | null;
  department: string | null;
  designation_level: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  std_code: string | null;
  mobile_number_1: string | null;
  mobile_number_2: string | null;
  direct_number: string | null;
  phone_number: string | null;
  official_email: string | null;
  personal_email_1: string | null;
  personal_email_2: string | null;
  linkedin_url: string | null;
  domain_name: string | null;
  website: string | null;
  industry: string | null;
  sub_industry: string | null;
  employee_size: string | null;
  turnover: string | null;
  turnover_usd_million: number | null;
  company_linkedin_url: string | null;
  import_job_id: string | null;
  created_at: string;
}

interface RepositoryFilters {
  search: string;
  city: string[];
  state: string[];
  country: string[];
  industry: string[];
  subIndustry: string[];
  designation: string[];
  designationLevel: string[];
  department: string[];
  dbSourcedYear: string;
  ucdbStatus: string[];
  website: string;
  domainName: string;
  employeeSize: string[];
  turnoverMinUsdM: string;
  turnoverMaxUsdM: string;
  matchMode: "exact" | "contains";
}

const emptyFilters: RepositoryFilters = {
  search: "", city: [], state: [], country: [], industry: [],
  subIndustry: [], designation: [], designationLevel: [], department: [], dbSourcedYear: "", ucdbStatus: [],
  website: "", domainName: "", employeeSize: [], turnoverMinUsdM: "", turnoverMaxUsdM: "", matchMode: "contains",
};

// Distinct-value columns backing the searchable multi-select filters below.
const FILTER_OPTION_FIELDS = [
  "city", "state", "country", "industry", "sub_industry", "designation",
  "designation_level", "department", "ucdb_status",
] as const;
type FilterOptionField = (typeof FILTER_OPTION_FIELDS)[number];

// PostgREST's .or() splits on unescaped commas/parens, so a raw search value
// like "Smith, Jones & Co" would otherwise be parsed as extra filter clauses.
// The quotes must wrap the full ilike pattern (including any % wildcards) —
// PostgREST only treats a value as quoted when the quote is the first
// character, so wrapping the raw term and adding % outside the quotes (as
// before) sent literal `"` and `%` chars to Postgres and matched nothing.
function escapeOrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function applyBasicFilters(query: any, f: RepositoryFilters) {
  const exact = f.matchMode === "exact";
  const like = (value: string) => (exact ? value : `%${value}%`);

  if (f.search) {
    const s = escapeOrValue(f.search);
    const pattern = exact ? s : `%${s}%`;
    query = query.or(`first_name.ilike."${pattern}",last_name.ilike."${pattern}",company_name.ilike."${pattern}"`);
  }
  if (f.city.length) query = query.in("city", f.city);
  if (f.state.length) query = query.in("state", f.state);
  if (f.country.length) query = query.in("country", f.country);
  if (f.industry.length) query = query.in("industry", f.industry);
  if (f.subIndustry.length) query = query.in("sub_industry", f.subIndustry);
  if (f.designation.length) query = query.in("designation", f.designation);
  if (f.designationLevel.length) query = query.in("designation_level", f.designationLevel);
  if (f.department.length) query = query.in("department", f.department);
  if (f.dbSourcedYear) query = query.eq("db_sourced_year", parseInt(f.dbSourcedYear));
  if (f.ucdbStatus.length) query = query.in("ucdb_status", f.ucdbStatus);
  if (f.website) query = query.ilike("website", like(f.website));
  if (f.domainName) query = query.ilike("domain_name", like(f.domainName));
  if (f.employeeSize.length) query = query.in("employee_size", f.employeeSize);
  if (f.turnoverMinUsdM) query = query.gte("turnover_usd_million", parseFloat(f.turnoverMinUsdM));
  if (f.turnoverMaxUsdM) query = query.lte("turnover_usd_million", parseFloat(f.turnoverMaxUsdM));
  return query;
}

function SortableHead({
  field,
  label,
  sortField,
  sortAscending,
  onSort,
}: {
  field: string;
  label: string;
  sortField: string;
  sortAscending: boolean;
  onSort: (field: string) => void;
}) {
  const active = sortField === field;
  const Icon = active ? (sortAscending ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className="whitespace-nowrap">
      <button
        type="button"
        className={`flex items-center gap-1 hover:text-foreground ${active ? "text-foreground font-semibold" : "text-muted-foreground"}`}
        onClick={() => onSort(field)}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

function DisabledAction({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="outline" size="sm" disabled className="gap-1.5 cursor-not-allowed opacity-60">
            <Icon className="h-3.5 w-3.5" />
            {label}
            <Lock className="h-3 w-3 ml-1" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>Not enabled on your plan yet — contact your account manager to activate {label.toLowerCase()}.</p>
      </TooltipContent>
    </Tooltip>
  );
}

// The fields an export can hold, in file order. The database builds each one (export_build in the db_exports migration).
const EXPORT_COLUMNS: { label: string }[] = [
  { label: "Unique ID" },
  { label: "Status" },
  { label: "Source" },
  { label: "DB Sourced Year" },
  { label: "UCDB Status" },
  { label: "Company Name" },
  { label: "First Name" },
  { label: "Last Name" },
  { label: "Designation" },
  { label: "Department" },
  { label: "Designation Level" },
  { label: "City" },
  { label: "State" },
  { label: "Country" },
  { label: "STD Code" },
  { label: "Phone 1" },
  { label: "Phone 2" },
  { label: "Phone 3" },
  { label: "Phone 4" },
  { label: "Official Email ID" },
  { label: "Personal Email ID 1" },
  { label: "Personal Email ID 2" },
  { label: "Contact LinkedIn ID" },
  { label: "Domain Name" },
  { label: "Website" },
  { label: "Industry" },
  { label: "SubIndustry" },
  { label: "Employee Size" },
  { label: "Turnover" },
  { label: "Company LinkedIn ID" },
];

export default function FerventRepository() {
  const { effectiveOrgId } = useOrgContext();
  const { isRunning: isImportRunning } = useFerventActiveImportJob(effectiveOrgId || null);
  const hadActiveImportJob = useRef(false);
  const { canAccessFeature, loading: featureLoading } = useFeatureAccess();
  const notify = useNotification();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (isImportRunning) {
      hadActiveImportJob.current = true;
    } else if (hadActiveImportJob.current) {
      // The active job just finished (status moved off pending/processing)
      // — refresh the table and import history to show it.
      hadActiveImportJob.current = false;
      queryClient.invalidateQueries({ queryKey: ["fervent-repository"] });
      queryClient.invalidateQueries({ queryKey: ["fervent-import-history"] });
    }
  }, [isImportRunning, queryClient]);

  const [filters, setFilters] = useUrlObjectState<RepositoryFilters>("f", emptyFilters);
  const [appliedFilters, setAppliedFilters] = useUrlObjectState<RepositoryFilters>("af", emptyFilters);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RepositoryRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFields, setExportFields] = useState<string[]>(EXPORT_COLUMNS.map((c) => c.label));
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RepositoryRecord | null>(null);
  const [searchMode, setSearchMode] = useUrlState<"basic" | "advanced">("mode", "basic");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [advancedQuery, setAdvancedQuery] = useState<BooleanQuery>(emptyBooleanQuery);
  const [appliedAdvancedQuery, setAppliedAdvancedQuery] = useState<BooleanQuery | null>(null);
  const [sortField, setSortField] = useState<string>("created_at");
  const [sortAscending, setSortAscending] = useState(false);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAscending((prev) => !prev);
    } else {
      setSortField(field);
      setSortAscending(true);
    }
    pagination.setPage(1);
  };

  const pagination = usePagination({ defaultPageSize: 25 });

  const { data, isLoading } = useQuery({
    queryKey: ["fervent-repository", effectiveOrgId, pagination.currentPage, pagination.pageSize, appliedFilters, appliedAdvancedQuery, sortField, sortAscending],
    queryFn: async () => {
      const offset = (pagination.currentPage - 1) * pagination.pageSize;
      let query = supabase
        .from("fervent_data_repository")
        .select("*", { count: "exact" })
        .eq("org_id", effectiveOrgId);

      query = appliedAdvancedQuery ? applyBooleanQuery(query, appliedAdvancedQuery) : applyBasicFilters(query, appliedFilters);

      const { data, error, count } = await query
        .order(sortField, { ascending: sortAscending, nullsFirst: false })
        .range(offset, offset + pagination.pageSize - 1);

      if (error) throw error;
      pagination.setTotalRecords(count || 0);
      return (data || []) as RepositoryRecord[];
    },
    enabled: !!effectiveOrgId && canAccessFeature("fervent_data_repository"),
  });

  const records = data || [];

  // Distinct values for the searchable multi-select filters, worked out by the database.
  const { data: filterOptions } = useQuery({
    queryKey: ["fervent-filter-options", effectiveOrgId],
    queryFn: async () => {
      const lists = await Promise.all(
        FILTER_OPTION_FIELDS.map(async (field) => {
          const { data, error } = await (supabase as any).rpc("fervent_filter_values", { _field: field });
          if (error) throw error;
          return [field, ((data || []) as string[]).sort((a, b) => a.localeCompare(b))] as const;
        })
      );
      return Object.fromEntries(lists) as Record<FilterOptionField, string[]>;
    },
    enabled: !!effectiveOrgId && canAccessFeature("fervent_data_repository"),
    staleTime: 5 * 60 * 1000,
  });

  const opts = (field: FilterOptionField) => filterOptions?.[field] || [];

  const applyFilters = () => {
    setAppliedFilters(filters);
    setAppliedAdvancedQuery(null);
    pagination.setPage(1);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setAppliedAdvancedQuery(null);
    pagination.setPage(1);
  };

  const applyAdvancedSearch = () => {
    if (isBooleanQueryEmpty(advancedQuery)) return;
    setAppliedAdvancedQuery(advancedQuery);
    pagination.setPage(1);
  };

  const clearAdvancedSearch = () => {
    setAdvancedQuery(emptyBooleanQuery);
    setAppliedAdvancedQuery(null);
    pagination.setPage(1);
  };

  const loadSavedSearch = (definition: SavedSearchDefinition) => {
    if (definition.mode === "advanced") {
      setSearchMode("advanced");
      setAdvancedQuery(definition.query);
      setAppliedAdvancedQuery(isBooleanQueryEmpty(definition.query) ? null : definition.query);
    } else {
      setSearchMode("basic");
      const loaded = { ...emptyFilters, ...definition.filters } as RepositoryFilters;
      setFilters(loaded);
      setAppliedFilters(loaded);
      setAppliedAdvancedQuery(null);
    }
    pagination.setPage(1);
  };

  const currentSavedSearchDefinition: SavedSearchDefinition =
    searchMode === "advanced" ? { mode: "advanced", query: advancedQuery } : { mode: "basic", filters };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.length === records.length ? [] : records.map((r) => r.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // The database makes the file (see lib/exportJobs), so leaving or refreshing this page does not stop it.
  const handleExport = async () => {
    const exportingSelection = selectedIds.length > 0;
    // Export reflects whatever is currently set in the Filters/Advanced
    // Search panel, not just what's been committed via "Apply Filters" — a
    // multi-select checkbox doesn't have the same implicit-apply feel a
    // text input has on Enter, so gating export on the *applied* snapshot
    // let a picked-but-not-yet-applied filter silently export everything.
    const exportingAdvanced = searchMode === "advanced" && !isBooleanQueryEmpty(advancedQuery);
    const fields = EXPORT_COLUMNS.map((c) => c.label).filter((label) => exportFields.includes(label));
    if (fields.length === 0) {
      notify.error("No fields selected", "Pick at least one field to export.");
      return;
    }
    setExporting(true);
    try {
      await requestExport(
        "fervent_repository",
        {
          ...(exportingSelection ? { ids: selectedIds } : exportingAdvanced ? { advanced: advancedQuery } : { filters }),
          ...(fields.length < EXPORT_COLUMNS.length ? { fields } : {}),
          sort: { field: sortField, ascending: sortAscending },
        },
        `fervent-database-${exportingSelection ? "selected" : "filtered"}-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      setShowExportDialog(false);
      queryClient.invalidateQueries({ queryKey: ["export-jobs"] });
      notify.success("Preparing your export", "It will download by itself when ready. You can keep working, and it also stays in Export History for 7 days.");
    } catch (err: any) {
      notify.error("Export failed", err.message);
    } finally {
      setExporting(false);
    }
  };

  if (featureLoading) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading..." />
      </DashboardLayout>
    );
  }

  if (!canAccessFeature("fervent_data_repository")) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            This feature is not available for your organization.
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Fervent Database</h1>
            <p className="text-sm text-muted-foreground">
              Your vendor/lead database — import, filter, and export. Calling and pipeline actions are shown below but not active on your plan.
            </p>
          </div>
          <div className="flex gap-2">
            <FerventSavedSearches
              orgId={effectiveOrgId || ""}
              currentDefinition={currentSavedSearchDefinition}
              onLoad={loadSavedSearch}
            />
            <Button variant="outline" size="sm" onClick={() => setShowImportHistory(true)}>
              <History className="h-4 w-4 mr-2" />
              Import History
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowExportHistory(true)}>
              <History className="h-4 w-4 mr-2" />
              Export History
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowExportDialog(true)} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Starting..." : selectedIds.length > 0 ? `Export Selected (${selectedIds.length})` : "Export"}
            </Button>
            <Button size="sm" onClick={() => setShowUpload(true)} disabled={isImportRunning}>
              <Upload className="h-4 w-4 mr-2" />
              {isImportRunning ? "Import in progress…" : "Import Data"}
            </Button>
          </div>
        </div>

        <FerventActiveUploadProgress orgId={effectiveOrgId || null} />

        <Card>
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm font-medium hover:text-foreground/80"
                  >
                    <Search className="h-4 w-4" />
                    {searchMode === "advanced" ? "Advanced Search" : "Filters"}
                    {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </CollapsibleTrigger>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={searchMode === "basic" ? "secondary" : "ghost"}
                    onClick={() => { setSearchMode("basic"); setFiltersOpen(true); }}
                  >
                    Filters
                  </Button>
                  <Button
                    size="sm"
                    variant={searchMode === "advanced" ? "secondary" : "ghost"}
                    onClick={() => { setSearchMode("advanced"); setFiltersOpen(true); }}
                  >
                    Advanced Search
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CollapsibleContent>
          <CardContent>
            {searchMode === "advanced" ? (
              <FerventAdvancedSearch
                query={advancedQuery}
                onChange={setAdvancedQuery}
                onApply={applyAdvancedSearch}
                onClear={clearAdvancedSearch}
              />
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">Match mode</span>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={filters.matchMode}
                    onValueChange={(v) => v && setFilters({ ...filters, matchMode: v as "exact" | "contains" })}
                  >
                    <ToggleGroupItem value="exact" className="text-xs px-2.5 h-7">Exact</ToggleGroupItem>
                    <ToggleGroupItem value="contains" className="text-xs px-2.5 h-7">Contains</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Input placeholder="Name or company" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <MultiSelectFilter triggerLabel="City" placeholder="Search city..." options={opts("city")} selected={filters.city} onChange={(v) => setFilters({ ...filters, city: v })} />
                  <MultiSelectFilter triggerLabel="State" placeholder="Search state..." options={opts("state")} selected={filters.state} onChange={(v) => setFilters({ ...filters, state: v })} />
                  <MultiSelectFilter triggerLabel="Country" placeholder="Search country..." options={opts("country")} selected={filters.country} onChange={(v) => setFilters({ ...filters, country: v })} />
                  <MultiSelectFilter triggerLabel="Industry" placeholder="Search industry..." options={opts("industry")} selected={filters.industry} onChange={(v) => setFilters({ ...filters, industry: v })} />
                  <MultiSelectFilter triggerLabel="Sub Industry" placeholder="Search sub industry..." options={opts("sub_industry")} selected={filters.subIndustry} onChange={(v) => setFilters({ ...filters, subIndustry: v })} />
                  <MultiSelectFilter triggerLabel="Designation" placeholder="Search designation..." options={opts("designation")} selected={filters.designation} onChange={(v) => setFilters({ ...filters, designation: v })} />
                  <MultiSelectFilter triggerLabel="Designation Level" placeholder="Search level..." options={opts("designation_level")} selected={filters.designationLevel} onChange={(v) => setFilters({ ...filters, designationLevel: v })} />
                  <MultiSelectFilter triggerLabel="Department" placeholder="Search department..." options={opts("department")} selected={filters.department} onChange={(v) => setFilters({ ...filters, department: v })} />
                  <Input placeholder="DB Sourced Year" type="number" value={filters.dbSourcedYear} onChange={(e) => setFilters({ ...filters, dbSourcedYear: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <MultiSelectFilter triggerLabel="UCDB Status" placeholder="Search status..." options={opts("ucdb_status")} selected={filters.ucdbStatus} onChange={(v) => setFilters({ ...filters, ucdbStatus: v })} />
                  <Input placeholder="Website" value={filters.website} onChange={(e) => setFilters({ ...filters, website: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Domain Name" value={filters.domainName} onChange={(e) => setFilters({ ...filters, domainName: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <MultiSelectFilter triggerLabel="Employee Size" placeholder="Search range..." options={EMPLOYEE_SIZE_BUCKETS} selected={filters.employeeSize} onChange={(v) => setFilters({ ...filters, employeeSize: v })} />
                  <TurnoverRangeFilter minM={filters.turnoverMinUsdM} maxM={filters.turnoverMaxUsdM} onChange={(min, max) => setFilters({ ...filters, turnoverMinUsdM: min, turnoverMaxUsdM: max })} />
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={applyFilters}>Apply Filters</Button>
                  <Button size="sm" variant="ghost" onClick={clearFilters}>
                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                </div>
              </>
            )}
          </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.length} selected</span>
            <Button variant="outline" size="sm" onClick={() => setShowBulkEdit(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Bulk Edit
            </Button>
            <BulkDeleteButton
              selectedIds={selectedIds}
              tableName="fervent_data_repository"
              onSuccess={() => {
                setSelectedIds([]);
                queryClient.invalidateQueries({ queryKey: ["fervent-repository"] });
              }}
            />
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <LoadingState message="Loading records..." />
            ) : records.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No records found. Import a CSV or Excel file to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table stickyHeader>
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead className="w-10 sticky left-0 bg-card">
                        <Checkbox checked={selectedIds.length === records.length} onCheckedChange={toggleSelectAll} />
                      </TableHead>
                      {[
                        ["unique_id", "Unique ID"],
                        ["upload_status", "Status"],
                        ["source_type", "Source"],
                        ["db_sourced_year", "DB Sourced Year"],
                        ["ucdb_status", "UCDB Status"],
                        ["company_name", "Company Name"],
                        ["first_name", "First Name"],
                        ["last_name", "Last Name"],
                        ["designation", "Designation"],
                        ["department", "Department"],
                        ["designation_level", "Designation Level"],
                        ["city", "City"],
                        ["state", "State"],
                        ["country", "Country"],
                        ["std_code", "STD Code"],
                        ["mobile_number_1", "Phone 1"],
                        ["mobile_number_2", "Phone 2"],
                        ["direct_number", "Phone 3"],
                        ["phone_number", "Phone 4"],
                        ["official_email", "Official Email"],
                        ["personal_email_1", "Personal Email 1"],
                        ["personal_email_2", "Personal Email 2"],
                        ["linkedin_url", "Contact LinkedIn"],
                        ["domain_name", "Domain Name"],
                        ["website", "Website"],
                        ["industry", "Industry"],
                        ["sub_industry", "Sub Industry"],
                        ["employee_size", "Employee Size"],
                        ["turnover", "Turnover"],
                        ["company_linkedin_url", "Company LinkedIn"],
                      ].map(([field, label]) => (
                        <SortableHead
                          key={field}
                          field={field}
                          label={label}
                          sortField={sortField}
                          sortAscending={sortAscending}
                          onSort={handleSort}
                        />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedRecord(r)}>
                        <TableCell onClick={(e) => e.stopPropagation()} className="sticky left-0 bg-card">
                          <Checkbox checked={selectedIds.includes(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.unique_id || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant={r.upload_status === "existing" ? "secondary" : "outline"}>
                            {r.upload_status === "existing" ? "Updated" : "Fresh"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.source_type ? (
                            <Badge variant={r.source_type === "international" ? "secondary" : "outline"}>
                              {r.source_type === "international" ? "International" : "Domestic"}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.db_sourced_year || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.ucdb_status ? <Badge variant="outline">{r.ucdb_status}</Badge> : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.company_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{r.first_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{r.last_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.designation || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.department || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.designation_level || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.city || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.state || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.country || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.std_code || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.mobile_number_1 || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.mobile_number_2 || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.direct_number || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.phone_number || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.official_email || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.personal_email_1 || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.personal_email_2 || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.linkedin_url || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.domain_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.website || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.industry || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.sub_industry || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.employee_size || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.turnover_usd_million != null ? formatTurnoverUsdMillion(r.turnover_usd_million) : (r.turnover || "—")}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.company_linkedin_url || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {!isLoading && records.length > 0 && (
          <PaginationControls
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalRecords={pagination.totalRecords}
            startRecord={pagination.startRecord}
            endRecord={pagination.endRecord}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        )}
      </div>

      <FerventBulkUploadDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        orgId={effectiveOrgId || ""}
        onUploadStarted={() => queryClient.invalidateQueries({ queryKey: ["fervent-repository"] })}
      />

      <Dialog open={!!selectedRecord} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{[selectedRecord?.first_name, selectedRecord?.last_name].filter(Boolean).join(" ") || "Record Details"}</DialogTitle>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditingRecord(selectedRecord)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
                <DisabledAction icon={Phone} label="Call" />
                <DisabledAction icon={MessageSquare} label="WhatsApp" />
                <DisabledAction icon={GitBranch} label="Add to Pipeline" />
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ["Unique ID", selectedRecord.unique_id],
                  ["Source", selectedRecord.source_type === "international" ? "International" : selectedRecord.source_type === "domestic" ? "Domestic" : null],
                  ["DB Sourced Year", selectedRecord.db_sourced_year],
                  ["UCDB Status", selectedRecord.ucdb_status],
                  ["Company Name", selectedRecord.company_name],
                  ["First Name", selectedRecord.first_name],
                  ["Last Name", selectedRecord.last_name],
                  ["Designation", selectedRecord.designation],
                  ["Department", selectedRecord.department],
                  ["Designation Level", selectedRecord.designation_level],
                  ["City", selectedRecord.city],
                  ["State", selectedRecord.state],
                  ["Country", selectedRecord.country],
                  ["STD Code", selectedRecord.std_code],
                  ["Phone 1", selectedRecord.mobile_number_1],
                  ["Phone 2", selectedRecord.mobile_number_2],
                  ["Phone 3", selectedRecord.direct_number],
                  ["Phone 4", selectedRecord.phone_number],
                  ["Official Email", selectedRecord.official_email],
                  ["Personal Email 1", selectedRecord.personal_email_1],
                  ["Personal Email 2", selectedRecord.personal_email_2],
                  ["LinkedIn", selectedRecord.linkedin_url],
                  ["Domain Name", selectedRecord.domain_name],
                  ["Website", selectedRecord.website],
                  ["Industry", selectedRecord.industry],
                  ["Sub Industry", selectedRecord.sub_industry],
                  ["Employee Size", selectedRecord.employee_size],
                  ["Turnover", selectedRecord.turnover_usd_million != null ? formatTurnoverUsdMillion(selectedRecord.turnover_usd_million) : selectedRecord.turnover],
                  ["Company LinkedIn", selectedRecord.company_linkedin_url],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium break-all">{value || "—"}</p>
                  </div>
                ))}
              </div>

              <FerventRecordActivity
                recordId={selectedRecord.id}
                orgId={effectiveOrgId || ""}
                importJobId={selectedRecord.import_job_id}
                fallbackCreatedAt={selectedRecord.created_at}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedIds.length > 0 ? `Export Selected (${selectedIds.length})` : "Export"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Choose which fields to include in the export. All fields are selected by default.
            </p>
            <MultiSelectFilter
              options={EXPORT_COLUMNS.map((c) => c.label)}
              selected={exportFields}
              onChange={setExportFields}
              placeholder="Search fields..."
              triggerLabel={
                exportFields.length === EXPORT_COLUMNS.length
                  ? "All fields"
                  : `${exportFields.length} of ${EXPORT_COLUMNS.length} fields`
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowExportDialog(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={exporting || exportFields.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Starting..." : "Export Data"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ExportHistoryDialog open={showExportHistory} onOpenChange={setShowExportHistory} />

      <FerventImportHistory
        open={showImportHistory}
        onOpenChange={setShowImportHistory}
        orgId={effectiveOrgId || ""}
      />

      <FerventBulkEditDialog
        open={showBulkEdit}
        onOpenChange={setShowBulkEdit}
        selectedIds={selectedIds}
        orgId={effectiveOrgId || ""}
        onSaved={() => {
          setSelectedIds([]);
          queryClient.invalidateQueries({ queryKey: ["fervent-repository"] });
        }}
      />

      {editingRecord && (
        <FerventEditRecordDialog
          open={!!editingRecord}
          onOpenChange={(open) => !open && setEditingRecord(null)}
          record={editingRecord}
          orgId={effectiveOrgId || ""}
          onSaved={(updated) => {
            setSelectedRecord(updated);
            queryClient.invalidateQueries({ queryKey: ["fervent-repository"] });
            queryClient.invalidateQueries({ queryKey: ["fervent-record-activity", updated.id] });
          }}
        />
      )}
    </DashboardLayout>
  );
}
