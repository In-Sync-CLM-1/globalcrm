import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { FerventRecordActivity } from "@/components/FerventRepository/FerventRecordActivity";
import { FerventExportHistory } from "@/components/FerventRepository/FerventExportHistory";
import { Upload, Download, Search, X, Phone, MessageSquare, GitBranch, Lock, History } from "lucide-react";

interface RepositoryRecord {
  id: string;
  unique_id: string | null;
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
}

const emptyFilters: RepositoryFilters = {
  search: "", city: "", state: "", country: "", industry: "",
  subIndustry: "", designation: "", designationLevel: "", department: "", dbSourcedYear: "", ucdbStatus: "",
  website: "", domainName: "", employeeSize: "", turnover: "",
};

// PostgREST's .or() splits on unescaped commas/parens, so a raw search value
// like "Smith, Jones & Co" would otherwise be parsed as extra filter clauses.
function escapeOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
  const { canAccessFeature, loading: featureLoading } = useFeatureAccess();
  const notify = useNotification();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<RepositoryFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<RepositoryFilters>(emptyFilters);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RepositoryRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);

  const pagination = usePagination({ defaultPageSize: 25 });

  const { data, isLoading } = useQuery({
    queryKey: ["fervent-repository", effectiveOrgId, pagination.currentPage, pagination.pageSize, appliedFilters],
    queryFn: async () => {
      const offset = (pagination.currentPage - 1) * pagination.pageSize;
      let query = supabase
        .from("fervent_data_repository")
        .select("*", { count: "exact" })
        .eq("org_id", effectiveOrgId);

      if (appliedFilters.search) {
        const s = escapeOrValue(appliedFilters.search);
        query = query.or(`full_name.ilike.%${s}%,company_name.ilike.%${s}%`);
      }
      if (appliedFilters.city) query = query.ilike("city", `%${appliedFilters.city}%`);
      if (appliedFilters.state) query = query.ilike("state", `%${appliedFilters.state}%`);
      if (appliedFilters.country) query = query.ilike("country", `%${appliedFilters.country}%`);
      if (appliedFilters.industry) query = query.ilike("industry", `%${appliedFilters.industry}%`);
      if (appliedFilters.subIndustry) query = query.ilike("sub_industry", `%${appliedFilters.subIndustry}%`);
      if (appliedFilters.designation) query = query.ilike("designation", `%${appliedFilters.designation}%`);
      if (appliedFilters.designationLevel) query = query.ilike("designation_level", `%${appliedFilters.designationLevel}%`);
      if (appliedFilters.department) query = query.ilike("department", `%${appliedFilters.department}%`);
      if (appliedFilters.dbSourcedYear) query = query.eq("db_sourced_year", parseInt(appliedFilters.dbSourcedYear));
      if (appliedFilters.ucdbStatus) query = query.ilike("ucdb_status", `%${appliedFilters.ucdbStatus}%`);
      if (appliedFilters.website) query = query.ilike("website", `%${appliedFilters.website}%`);
      if (appliedFilters.domainName) query = query.ilike("domain_name", `%${appliedFilters.domainName}%`);
      if (appliedFilters.employeeSize) query = query.ilike("employee_size", `%${appliedFilters.employeeSize}%`);
      if (appliedFilters.turnover) query = query.ilike("turnover", `%${appliedFilters.turnover}%`);

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
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
    pagination.setPage(1);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    pagination.setPage(1);
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.length === records.length ? [] : records.map((r) => r.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      let query = supabase.from("fervent_data_repository").select("*").eq("org_id", effectiveOrgId);
      if (appliedFilters.search) {
        const s = escapeOrValue(appliedFilters.search);
        query = query.or(`full_name.ilike.%${s}%,company_name.ilike.%${s}%`);
      }
      if (appliedFilters.city) query = query.ilike("city", `%${appliedFilters.city}%`);
      if (appliedFilters.state) query = query.ilike("state", `%${appliedFilters.state}%`);
      if (appliedFilters.country) query = query.ilike("country", `%${appliedFilters.country}%`);
      if (appliedFilters.industry) query = query.ilike("industry", `%${appliedFilters.industry}%`);
      if (appliedFilters.subIndustry) query = query.ilike("sub_industry", `%${appliedFilters.subIndustry}%`);
      if (appliedFilters.designation) query = query.ilike("designation", `%${appliedFilters.designation}%`);
      if (appliedFilters.designationLevel) query = query.ilike("designation_level", `%${appliedFilters.designationLevel}%`);
      if (appliedFilters.department) query = query.ilike("department", `%${appliedFilters.department}%`);
      if (appliedFilters.dbSourcedYear) query = query.eq("db_sourced_year", parseInt(appliedFilters.dbSourcedYear));
      if (appliedFilters.ucdbStatus) query = query.ilike("ucdb_status", `%${appliedFilters.ucdbStatus}%`);
      if (appliedFilters.website) query = query.ilike("website", `%${appliedFilters.website}%`);
      if (appliedFilters.domainName) query = query.ilike("domain_name", `%${appliedFilters.domainName}%`);
      if (appliedFilters.employeeSize) query = query.ilike("employee_size", `%${appliedFilters.employeeSize}%`);
      if (appliedFilters.turnover) query = query.ilike("turnover", `%${appliedFilters.turnover}%`);

      const { data: rows, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) {
        notify.error("Nothing to export", "No records match the current filters.");
        return;
      }

      exportToCSV(rows, [
        { key: "unique_id", label: "Unique ID" },
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
      ], `fervent-database-${new Date().toISOString().slice(0, 10)}.csv`);

      notify.success("Export ready", `${rows.length} record(s) exported.`);

      const { data: { user } } = await supabase.auth.getUser();
      if (user && effectiveOrgId) {
        await supabase.from("fervent_activity_log").insert({
          org_id: effectiveOrgId,
          record_id: null,
          actor_id: user.id,
          action: "exported",
          detail: { count: rows.length, filters: appliedFilters },
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
            <Button variant="outline" size="sm" onClick={() => setShowExportHistory(true)}>
              <History className="h-4 w-4 mr-2" />
              Export History
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Exporting..." : "Export"}
            </Button>
            <Button size="sm" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Search className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.length} selected</span>
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
                      <TableHead className="whitespace-nowrap">Unique ID</TableHead>
                      <TableHead className="whitespace-nowrap">DB Sourced Year</TableHead>
                      <TableHead className="whitespace-nowrap">UCDB Status</TableHead>
                      <TableHead className="whitespace-nowrap">Company Name</TableHead>
                      <TableHead className="whitespace-nowrap">Full Name</TableHead>
                      <TableHead className="whitespace-nowrap">Designation</TableHead>
                      <TableHead className="whitespace-nowrap">Department</TableHead>
                      <TableHead className="whitespace-nowrap">Designation Level</TableHead>
                      <TableHead className="whitespace-nowrap">City</TableHead>
                      <TableHead className="whitespace-nowrap">State</TableHead>
                      <TableHead className="whitespace-nowrap">Country</TableHead>
                      <TableHead className="whitespace-nowrap">ISD Code</TableHead>
                      <TableHead className="whitespace-nowrap">STD Code</TableHead>
                      <TableHead className="whitespace-nowrap">Mobile Number 1</TableHead>
                      <TableHead className="whitespace-nowrap">Mobile Number 2</TableHead>
                      <TableHead className="whitespace-nowrap">Direct Number</TableHead>
                      <TableHead className="whitespace-nowrap">Phone Number</TableHead>
                      <TableHead className="whitespace-nowrap">Official Email</TableHead>
                      <TableHead className="whitespace-nowrap">Personal Email 1</TableHead>
                      <TableHead className="whitespace-nowrap">Personal Email 2</TableHead>
                      <TableHead className="whitespace-nowrap">Contact LinkedIn</TableHead>
                      <TableHead className="whitespace-nowrap">Domain Name</TableHead>
                      <TableHead className="whitespace-nowrap">Website</TableHead>
                      <TableHead className="whitespace-nowrap">Industry</TableHead>
                      <TableHead className="whitespace-nowrap">Sub Industry</TableHead>
                      <TableHead className="whitespace-nowrap">Employee Size</TableHead>
                      <TableHead className="whitespace-nowrap">Turnover</TableHead>
                      <TableHead className="whitespace-nowrap">Company LinkedIn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedRecord(r)}>
                        <TableCell onClick={(e) => e.stopPropagation()} className="sticky left-0 bg-card">
                          <Checkbox checked={selectedIds.includes(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.unique_id || "—"}</TableCell>
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
    </DashboardLayout>
  );
}
