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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingState } from "@/components/common/LoadingState";
import { useNotification } from "@/hooks/useNotification";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { usePagination } from "@/hooks/usePagination";
import PaginationControls from "@/components/common/PaginationControls";
import { BulkDeleteButton } from "@/components/common/BulkDeleteButton";
import { exportToCSV } from "@/utils/exportUtils";
import { FerventBulkUploadDialog } from "@/components/FerventRepository/FerventBulkUploadDialog";
import { FerventActiveUploadProgress } from "@/components/FerventRepository/FerventActiveUploadProgress";
import { useFerventActiveImportJob } from "@/hooks/useFerventActiveImportJob";
import { FerventRecordActivity } from "@/components/FerventRepository/FerventRecordActivity";
import { FerventExportHistory } from "@/components/FerventRepository/FerventExportHistory";
import { FerventImportHistory } from "@/components/FerventRepository/FerventImportHistory";
import { FerventEditRecordDialog } from "@/components/FerventRepository/FerventEditRecordDialog";
import { FerventBulkEditDialog } from "@/components/FerventRepository/FerventBulkEditDialog";
import { FerventAdvancedSearch } from "@/components/FerventRepository/FerventAdvancedSearch";
import { FerventSavedSearches } from "@/components/FerventRepository/FerventSavedSearches";
import {
  applyBooleanQuery,
  emptyBooleanQuery,
  isBooleanQueryEmpty,
  type BooleanQuery,
  type SavedSearchDefinition,
} from "@/components/FerventRepository/ferventBooleanSearch";
import { Upload, Download, Search, X, Phone, MessageSquare, GitBranch, Lock, History, Pencil, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface RepositoryRecord {
  id: string;
  unique_id: string | null;
  upload_status: string | null;
  db_sourced_year: number | null;
  ucdb_status: string | null;
  company_name: string | null;
  full_name: string | null;
  designation: string | null;
  department: string | null;
  designation_level: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  isd_code: string | null;
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
  company_linkedin_url: string | null;
  import_job_id: string | null;
  created_at: string;
}

interface RepositoryFilters {
  search: string;
  city: string;
  state: string;
  country: string;
  industry: string;
  subIndustry: string;
  designation: string;
  designationLevel: string;
  department: string;
  dbSourcedYear: string;
  ucdbStatus: string;
  website: string;
  domainName: string;
  employeeSize: string;
  turnover: string;
  matchMode: "exact" | "contains";
}

const emptyFilters: RepositoryFilters = {
  search: "", city: "", state: "", country: "", industry: "",
  subIndustry: "", designation: "", designationLevel: "", department: "", dbSourcedYear: "", ucdbStatus: "",
  website: "", domainName: "", employeeSize: "", turnover: "", matchMode: "contains",
};

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
    query = query.or(`full_name.ilike."${pattern}",company_name.ilike."${pattern}"`);
  }
  if (f.city) query = query.ilike("city", like(f.city));
  if (f.state) query = query.ilike("state", like(f.state));
  if (f.country) query = query.ilike("country", like(f.country));
  if (f.industry) query = query.ilike("industry", like(f.industry));
  if (f.subIndustry) query = query.ilike("sub_industry", like(f.subIndustry));
  if (f.designation) query = query.ilike("designation", like(f.designation));
  if (f.designationLevel) query = query.ilike("designation_level", like(f.designationLevel));
  if (f.department) query = query.ilike("department", like(f.department));
  if (f.dbSourcedYear) query = query.eq("db_sourced_year", parseInt(f.dbSourcedYear));
  if (f.ucdbStatus) query = query.ilike("ucdb_status", like(f.ucdbStatus));
  if (f.website) query = query.ilike("website", like(f.website));
  if (f.domainName) query = query.ilike("domain_name", like(f.domainName));
  if (f.employeeSize) query = query.ilike("employee_size", like(f.employeeSize));
  if (f.turnover) query = query.ilike("turnover", like(f.turnover));
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

export default function FerventRepository() {
  const { effectiveOrgId } = useOrgContext();
  const { data: activeImportJob } = useFerventActiveImportJob(effectiveOrgId || null);
  const hadActiveImportJob = useRef(false);
  const { canAccessFeature, loading: featureLoading } = useFeatureAccess();
  const notify = useNotification();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (activeImportJob) {
      hadActiveImportJob.current = true;
    } else if (hadActiveImportJob.current) {
      // The active job just finished (polling no longer finds a pending/
      // processing row) — refresh the table and import history to show it.
      hadActiveImportJob.current = false;
      queryClient.invalidateQueries({ queryKey: ["fervent-repository"] });
      queryClient.invalidateQueries({ queryKey: ["fervent-import-history"] });
    }
  }, [activeImportJob, queryClient]);

  const [filters, setFilters] = useState<RepositoryFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<RepositoryFilters>(emptyFilters);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RepositoryRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RepositoryRecord | null>(null);
  const [searchMode, setSearchMode] = useState<"basic" | "advanced">("basic");
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

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportingSelection = selectedIds.length > 0;
      const buildQuery = () => {
        let query = supabase.from("fervent_data_repository").select("*").eq("org_id", effectiveOrgId);
        if (exportingSelection) {
          query = query.in("id", selectedIds);
        } else if (appliedAdvancedQuery) {
          query = applyBooleanQuery(query, appliedAdvancedQuery);
        } else {
          query = applyBasicFilters(query, appliedFilters);
        }
        query = query.order(sortField, { ascending: sortAscending, nullsFirst: false });
        // Tiebreaker on the primary key so paginated .range() batches never
        // reshuffle/skip rows when sortField has duplicate values across pages.
        if (sortField !== "id") query = query.order("id", { ascending: true });
        return query;
      };

      // Supabase caps a single request at 1000 rows — page through with
      // .range() to pull the full result set, same pattern as RMPL's export.
      const PAGE_SIZE = 1000;
      const rows: RepositoryRecord[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...((data || []) as RepositoryRecord[]));
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      if (rows.length === 0) {
        notify.error("Nothing to export", exportingSelection ? "No selected records found." : "No records match the current filters.");
        return;
      }

      exportToCSV(rows, [
        { key: "unique_id", label: "Unique ID" },
        { key: "upload_status", label: "Status", format: (v: string | null) => (v === "existing" ? "Updated" : "Fresh") },
        { key: "db_sourced_year", label: "DB Sourced Year" },
        { key: "ucdb_status", label: "UCDB Status" },
        { key: "company_name", label: "Company Name" },
        { key: "full_name", label: "Full Name" },
        { key: "designation", label: "Designation" },
        { key: "department", label: "Department" },
        { key: "designation_level", label: "Designation Level" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
        { key: "country", label: "Country" },
        { key: "isd_code", label: "ISD Code" },
        { key: "std_code", label: "STD Code" },
        { key: "mobile_number_1", label: "Mobile Number 1" },
        { key: "mobile_number_2", label: "Mobile Number 2" },
        { key: "direct_number", label: "Direct Number" },
        { key: "phone_number", label: "Phone Number" },
        { key: "official_email", label: "Official Email ID" },
        { key: "personal_email_1", label: "Personal Email ID 1" },
        { key: "personal_email_2", label: "Personal Email ID 2" },
        { key: "linkedin_url", label: "Contact LinkedIn ID" },
        { key: "domain_name", label: "Domain Name" },
        { key: "website", label: "Website" },
        { key: "industry", label: "Industry" },
        { key: "sub_industry", label: "SubIndustry" },
        { key: "employee_size", label: "Employee Size" },
        { key: "turnover", label: "Turnover" },
        { key: "company_linkedin_url", label: "Company LinkedIn ID" },
      ], `fervent-database-${exportingSelection ? "selected" : "filtered"}-${new Date().toISOString().slice(0, 10)}.csv`);

      notify.success("Export ready", `${rows.length} record(s) exported${exportingSelection ? " (selected rows)" : ""}.`);

      const { data: { user } } = await supabase.auth.getUser();
      if (user && effectiveOrgId) {
        await supabase.from("fervent_activity_log").insert({
          org_id: effectiveOrgId,
          record_id: null,
          actor_id: user.id,
          action: "exported",
          detail: exportingSelection
            ? { count: rows.length, filters: { selection: `${rows.length} manually selected record(s)` } }
            : appliedAdvancedQuery
              ? { count: rows.length, filters: { advanced: JSON.stringify(appliedAdvancedQuery) } }
              : { count: rows.length, filters: appliedFilters },
        });
      }
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
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Exporting..." : selectedIds.length > 0 ? `Export Selected (${selectedIds.length})` : "Export"}
            </Button>
            <Button size="sm" onClick={() => setShowUpload(true)} disabled={!!activeImportJob}>
              <Upload className="h-4 w-4 mr-2" />
              {activeImportJob ? "Import in progress…" : "Import CSV"}
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
                  <Input placeholder="City" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="State" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Country" value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Industry" value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Sub Industry" value={filters.subIndustry} onChange={(e) => setFilters({ ...filters, subIndustry: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Designation" value={filters.designation} onChange={(e) => setFilters({ ...filters, designation: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Designation Level" value={filters.designationLevel} onChange={(e) => setFilters({ ...filters, designationLevel: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Department" value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="DB Sourced Year" type="number" value={filters.dbSourcedYear} onChange={(e) => setFilters({ ...filters, dbSourcedYear: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="UCDB Status" value={filters.ucdbStatus} onChange={(e) => setFilters({ ...filters, ucdbStatus: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Website" value={filters.website} onChange={(e) => setFilters({ ...filters, website: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Domain Name" value={filters.domainName} onChange={(e) => setFilters({ ...filters, domainName: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Employee Size" value={filters.employeeSize} onChange={(e) => setFilters({ ...filters, employeeSize: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
                  <Input placeholder="Turnover" value={filters.turnover} onChange={(e) => setFilters({ ...filters, turnover: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyFilters()} />
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
                No records found. Import a CSV to get started.
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
                        ["db_sourced_year", "DB Sourced Year"],
                        ["ucdb_status", "UCDB Status"],
                        ["company_name", "Company Name"],
                        ["full_name", "Full Name"],
                        ["designation", "Designation"],
                        ["department", "Department"],
                        ["designation_level", "Designation Level"],
                        ["city", "City"],
                        ["state", "State"],
                        ["country", "Country"],
                        ["isd_code", "ISD Code"],
                        ["std_code", "STD Code"],
                        ["mobile_number_1", "Mobile Number 1"],
                        ["mobile_number_2", "Mobile Number 2"],
                        ["direct_number", "Direct Number"],
                        ["phone_number", "Phone Number"],
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
                        <TableCell className="whitespace-nowrap">{r.db_sourced_year || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.ucdb_status ? <Badge variant="outline">{r.ucdb_status}</Badge> : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.company_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{r.full_name || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.designation || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.department || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.designation_level || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.city || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.state || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.country || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.isd_code || "—"}</TableCell>
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
                        <TableCell className="whitespace-nowrap">{r.turnover || "—"}</TableCell>
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
            <DialogTitle>{selectedRecord?.full_name || "Record Details"}</DialogTitle>
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
                  ["DB Sourced Year", selectedRecord.db_sourced_year],
                  ["UCDB Status", selectedRecord.ucdb_status],
                  ["Company Name", selectedRecord.company_name],
                  ["Designation", selectedRecord.designation],
                  ["Department", selectedRecord.department],
                  ["Designation Level", selectedRecord.designation_level],
                  ["City", selectedRecord.city],
                  ["State", selectedRecord.state],
                  ["Country", selectedRecord.country],
                  ["ISD Code", selectedRecord.isd_code],
                  ["STD Code", selectedRecord.std_code],
                  ["Mobile Number 1", selectedRecord.mobile_number_1],
                  ["Mobile Number 2", selectedRecord.mobile_number_2],
                  ["Direct Number", selectedRecord.direct_number],
                  ["Phone Number", selectedRecord.phone_number],
                  ["Official Email", selectedRecord.official_email],
                  ["Personal Email 1", selectedRecord.personal_email_1],
                  ["Personal Email 2", selectedRecord.personal_email_2],
                  ["LinkedIn", selectedRecord.linkedin_url],
                  ["Domain Name", selectedRecord.domain_name],
                  ["Website", selectedRecord.website],
                  ["Industry", selectedRecord.industry],
                  ["Sub Industry", selectedRecord.sub_industry],
                  ["Employee Size", selectedRecord.employee_size],
                  ["Turnover", selectedRecord.turnover],
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

      <FerventExportHistory
        open={showExportHistory}
        onOpenChange={setShowExportHistory}
        orgId={effectiveOrgId || ""}
      />

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
