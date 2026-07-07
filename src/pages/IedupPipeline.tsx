import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Play,
  Pause,
  Upload,
  Download,
  Trash2,
  Phone,
  Plus,
  X,
  Clock,
  Loader2,
  UserPlus,
} from "lucide-react";
import { IEDUP_ORG_ID } from "@/hooks/useIsIedup";
import { useNotification } from "@/hooks/useNotification";

interface WindowSlot {
  start_min: number;
  end_min: number;
}

interface BeneficiaryRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name_hi: string | null;
  phone: string | null;
  do_not_call: boolean | null;
  status: string | null;
  created_at: string | null;
  pipeline_stage_id?: string | null;
  last_call_at?: string | null;
  attempts?: number;
  connected?: number;
  action?: string | null;
  disposition?: string | null;
}

function callCapExhausted(b: BeneficiaryRow): boolean {
  if (b.do_not_call) return true;
  if ((b.connected || 0) > 0) return true;
  if ((b.attempts || 0) >= 3) return true;
  return false;
}

interface UploadRow {
  name_en: string;
  number: string;
  name_hi: string;
  action: string;
}

// Selectable actions = the IEDUP pipeline stages. Setting one on import triggers
// that stage's automation (call or the mapped WhatsApp template).
const IEDUP_ACTIONS = [
  "Call",
  "Send WhatsApp - After certificate",
  "Send WhatsApp - After registration & payment verification",
  "Send WhatsApp - Payment failed",
  "Send WhatsApp - Add help desk number",
  "Send WhatsApp - Photo rejected",
  "Attendance",
  "Short Attendance",
];

const CSV_TEMPLATE = `name,number,action\nVibhu Dixit,+917607359820,Call\n`;

const PAGE_SIZE = 50;

export default function IedupPipeline() {
  const notify = useNotification();
  const qc = useQueryClient();

  // Org settings
  const { data: settings } = useQuery({
    queryKey: ["iedup-org-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_settings")
        .select("dialing_active, calling_windows")
        .eq("org_id", IEDUP_ORG_ID)
        .maybeSingle();
      return data;
    },
  });

  // Filter + pagination state (declared before the query that reads them).
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [hideCalled, setHideCalled] = useState(false);
  const [page, setPage] = useState(0);

  // Beneficiaries list — server-side paginated (one page at a time + exact total).
  const { data: pageData, refetch: refetchList } = useQuery({
    queryKey: ["iedup-beneficiaries", page, filterFrom, filterTo],
    queryFn: async () => {
      let q = supabase
        .from("contacts")
        .select("id, first_name, last_name, name_hi, phone, do_not_call, status, created_at, pipeline_stage_id", { count: "exact" })
        .eq("org_id", IEDUP_ORG_ID);
      if (filterFrom) q = q.gte("created_at", filterFrom);
      if (filterTo) q = q.lte("created_at", `${filterTo}T23:59:59.999`);
      const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data || []) as BeneficiaryRow[];
      const total = count || 0;
      if (rows.length === 0) return { rows, total };

      const ids = rows.map((r) => r.id);
      const [callsRes, statsRes, stagesRes, dispoRes] = await Promise.all([
        supabase
          .from("call_logs")
          .select("contact_id, started_at")
          .eq("org_id", IEDUP_ORG_ID)
          .in("contact_id", ids)
          .not("started_at", "is", null)
          .order("started_at", { ascending: false }),
        supabase.rpc("contact_ai_call_stats", { p_contact_ids: ids }),
        // Action = the contact's pipeline stage (the "Send WhatsApp - …" / "Call" action).
        supabase.from("pipeline_stages").select("id, name").eq("org_id", IEDUP_ORG_ID),
        // Disposition = latest call/WhatsApp outcome from the shared view.
        supabase.from("contact_latest_disposition").select("contact_id, disposition_name").eq("org_id", IEDUP_ORG_ID).in("contact_id", ids),
      ]);

      const latest = new Map<string, string>();
      for (const c of callsRes.data || []) {
        const cid = (c as any).contact_id as string;
        if (cid && !latest.has(cid)) latest.set(cid, (c as any).started_at as string);
      }
      const stats = new Map<string, { attempts: number; connected: number }>();
      for (const s of (statsRes.data || []) as Array<{ contact_id: string; attempts: number; connected: number }>) {
        stats.set(s.contact_id, { attempts: Number(s.attempts), connected: Number(s.connected) });
      }
      const stageName = new Map<string, string>();
      for (const s of (stagesRes.data || []) as Array<{ id: string; name: string }>) {
        stageName.set(s.id, s.name);
      }
      const dispo = new Map<string, string>();
      for (const d of (dispoRes.data || []) as Array<{ contact_id: string; disposition_name: string }>) {
        if (d.contact_id && d.disposition_name) dispo.set(d.contact_id, d.disposition_name);
      }
      return {
        total,
        rows: rows.map((r) => ({
          ...r,
          last_call_at: latest.get(r.id) ?? null,
          attempts: stats.get(r.id)?.attempts || 0,
          connected: stats.get(r.id)?.connected || 0,
          action: r.pipeline_stage_id ? (stageName.get(r.pipeline_stage_id) ?? null) : null,
          disposition: dispo.get(r.id) ?? null,
        })),
      };
    },
    refetchInterval: 30_000,
  });
  const beneficiaries = (pageData?.rows ?? []) as BeneficiaryRow[];
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Upload state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [transliterating, setTransliterating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual-add state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualNameEn, setManualNameEn] = useState("");
  const [manualNameHi, setManualNameHi] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [manualTransliterating, setManualTransliterating] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  // Filter + selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialing, setBulkDialing] = useState(false);

  // Calling window editor state
  const [windowsDraft, setWindowsDraft] = useState<WindowSlot[]>([]);
  const [windowsDirty, setWindowsDirty] = useState(false);
  useEffect(() => {
    if (settings?.calling_windows) {
      setWindowsDraft(Array.isArray(settings.calling_windows) ? (settings.calling_windows as WindowSlot[]) : []);
      setWindowsDirty(false);
    }
  }, [settings?.calling_windows]);

  const dialingActive = settings?.dialing_active ?? false;

  function handleDownloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "iedup_beneficiaries_template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    Papa.parse<{ name?: string; number?: string; action?: string }>(f, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const rows: UploadRow[] = (res.data || [])
          .map((r) => ({
            name_en: String(r.name || "").trim(),
            number: normalizePhone(String(r.number || "")),
            name_hi: "",
            action: String(r.action || "").trim(),
          }))
          .filter((r) => r.name_en && r.number);
        if (rows.length === 0) {
          notify.error("Empty file", "No valid rows found. Make sure the file has 'name' and 'number' columns.");
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
        // Devanagari conversion happens AFTER import (background job), so the
        // upload is instant and isn't capped by the converter's 500-name limit.
        // Seed name_hi with the English name as a placeholder until converted.
        setUploadRows(rows.map((r) => ({ ...r, name_hi: r.name_en })));
        setUploadOpen(true);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      error: (err) => {
        notify.error("Could not read file", err.message);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
    });
  }

  async function handleImport() {
    if (uploadRows.length === 0) return;
    setImporting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("You must be signed in to import.");

      // Resolve the chosen Action to its pipeline stage so the import sets the
      // stage (which fires that stage's automation via the enqueue trigger).
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("is_active", true);
      const stageMap = new Map(
        (stages || []).map((s: any) => [String(s.name).trim().toLowerCase(), s.id as string]),
      );

      const inserts = uploadRows.map((r) => {
        const parts = r.name_en.trim().split(/\s+/);
        return {
          org_id: IEDUP_ORG_ID,
          created_by: userId,
          first_name: parts[0] || r.name_en,
          last_name: parts.slice(1).join(" ") || null,
          name_hi: r.name_hi || r.name_en,
          phone: r.number,
          product: "CM YUVA",
          source: "iedup_csv_upload",
          pipeline_stage_id: r.action ? (stageMap.get(r.action.trim().toLowerCase()) || null) : null,
        };
      });
      const { error } = await supabase.from("contacts").insert(inserts);
      if (error) throw error;
      notify.success(
        "Beneficiaries imported",
        `${inserts.length} row(s) added. Hindi names are being converted in the background.`,
      );
      // Kick off Devanagari conversion now (fire-and-forget); a cron also catches up.
      supabase.functions.invoke("transliterate-pending", { body: { org_id: IEDUP_ORG_ID } }).catch(() => undefined);
      setUploadOpen(false);
      setUploadRows([]);
      refetchList();
      qc.invalidateQueries({ queryKey: ["iedup-data-counts"] });
    } catch (err: any) {
      notify.error("Import failed", err.message || "Could not save beneficiaries.");
    } finally {
      setImporting(false);
    }
  }

  async function toggleDialing(start: boolean) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-bulk-call", {
        body: { action: start ? "start" : "stop", org_id: IEDUP_ORG_ID },
      });
      if (error) throw error;
      notify.success(
        start ? "Dialing started" : "Dialing stopped",
        start ? "Calls will begin during the next calling-window tick." : "No new calls will be placed.",
      );
      if (start) {
        // Trigger an immediate cron tick so dialing begins now (if we're in window)
        supabase.functions.invoke("ai-bulk-call", { body: {} }).catch(() => undefined);
      }
      qc.invalidateQueries({ queryKey: ["iedup-org-settings"] });
    } catch (err: any) {
      notify.error("Could not change dialing state", err.message);
    }
  }

  async function dialNow(row: BeneficiaryRow) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-bulk-call", {
        body: {
          action: "test_call",
          org_id: IEDUP_ORG_ID,
          contact_id: row.id,
          phone: row.phone,
        },
      });
      if (error) throw error;
      notify.success("Call placed", `Dialing ${row.phone} now.`);
      refetchList();
    } catch (err: any) {
      notify.error("Dial failed", err.message);
    }
  }

  function openManualDialog() {
    setManualNameEn("");
    setManualNameHi("");
    setManualNumber("");
    setManualOpen(true);
  }

  async function transliterateManualName() {
    const name = manualNameEn.trim();
    if (!name) return;
    setManualTransliterating(true);
    try {
      const { data } = await supabase.functions.invoke("transliterate-names", {
        body: { names: [name] },
      });
      const hi = (data?.names_hi?.[0] as string) || name;
      setManualNameHi(hi);
    } catch {
      setManualNameHi(name);
    } finally {
      setManualTransliterating(false);
    }
  }

  async function saveManualBeneficiary() {
    const name = manualNameEn.trim();
    const num = normalizePhone(manualNumber);
    if (!name || !num) {
      notify.error("Missing details", "Both name and number are required.");
      return;
    }
    setManualSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("You must be signed in to add a beneficiary.");
      const parts = name.split(/\s+/);
      const { error } = await supabase.from("contacts").insert({
        org_id: IEDUP_ORG_ID,
        created_by: userId,
        first_name: parts[0] || name,
        last_name: parts.slice(1).join(" ") || null,
        name_hi: (manualNameHi || name).trim(),
        phone: num,
        product: "CM YUVA",
        source: "iedup_manual_add",
      });
      if (error) throw error;
      notify.success("Beneficiary added", `${name} is in the pipeline.`);
      setManualOpen(false);
      refetchList();
      qc.invalidateQueries({ queryKey: ["iedup-data-counts"] });
    } catch (err: any) {
      notify.error("Could not add", err.message || "Save failed.");
    } finally {
      setManualSaving(false);
    }
  }

  // Derived: filtered beneficiaries (by upload date and call status)
  // Date range is filtered server-side (see the query); only the derived
  // "hide ineligible" toggle is applied to the current page here.
  const filteredBeneficiaries = useMemo(() => {
    const all = beneficiaries;
    return hideCalled ? all.filter((b) => !callCapExhausted(b)) : all;
  }, [beneficiaries, hideCalled]);

  // Reset to the first page (and clear selection) when a server-side filter changes.
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [filterFrom, filterTo]);

  // Keep the page in range if the total shrinks (e.g. after deletes).
  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(totalPages - 1);
  }, [totalPages, page]);

  const selectableFiltered = filteredBeneficiaries.filter((b) => b.phone && !callCapExhausted(b));
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((b) => selectedIds.has(b.id));
  const someFilteredSelected =
    !allFilteredSelected && selectableFiltered.some((b) => selectedIds.has(b.id));

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableFiltered.map((b) => b.id)));
    }
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearFilters() {
    setFilterFrom("");
    setFilterTo("");
    setHideCalled(false);
  }

  async function dialSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDialing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-bulk-call", {
        body: { action: "enqueue", org_id: IEDUP_ORG_ID, contact_ids: ids },
      });
      if (error) throw error;
      const queued = (data as any)?.queued ?? 0;
      const skipped = (data as any)?.skipped ?? 0;
      notify.success(
        "Calls queued",
        `${queued} contact${queued === 1 ? "" : "s"} queued${skipped > 0 ? ` (${skipped} skipped — no phone or marked do-not-call)` : ""}.`,
      );
      // Kick off an immediate cron tick so dialing starts inside the calling window
      supabase.functions.invoke("ai-bulk-call", { body: {} }).catch(() => undefined);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["iedup-org-settings"] });
      refetchList();
    } catch (err: any) {
      notify.error("Could not queue calls", err.message || "Try again.");
    } finally {
      setBulkDialing(false);
    }
  }

  async function deleteRow(row: BeneficiaryRow) {
    if (!confirm(`Delete ${row.first_name || row.phone}? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from("contacts").delete().eq("id", row.id);
      if (error) throw error;
      notify.success("Deleted", "Beneficiary removed.");
      refetchList();
    } catch (err: any) {
      notify.error("Delete failed", err.message);
    }
  }

  function addWindow() {
    setWindowsDraft((prev) => [...prev, { start_min: 660, end_min: 810 }]);
    setWindowsDirty(true);
  }
  function removeWindow(i: number) {
    setWindowsDraft((prev) => prev.filter((_, idx) => idx !== i));
    setWindowsDirty(true);
  }
  function updateWindow(i: number, field: "start_min" | "end_min", v: string) {
    const mins = parseTimeToMinutes(v);
    setWindowsDraft((prev) =>
      prev.map((w, idx) => (idx === i ? { ...w, [field]: mins } : w)),
    );
    setWindowsDirty(true);
  }
  async function saveWindows() {
    try {
      const { error } = await supabase
        .from("organization_settings")
        .upsert(
          {
            org_id: IEDUP_ORG_ID,
            calling_windows: windowsDraft,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "org_id" },
        );
      if (error) throw error;
      notify.success("Calling windows saved");
      setWindowsDirty(false);
      qc.invalidateQueries({ queryKey: ["iedup-org-settings"] });
    } catch (err: any) {
      notify.error("Could not save windows", err.message);
    }
  }

  const statusReason = useMemo(() => {
    if (!dialingActive) return "Dialing stopped by admin.";
    if (windowsDraft.length === 0) return "Dialing on, but no calling windows configured.";
    const m = istMinutesNow();
    for (const w of windowsDraft) {
      if (m >= w.start_min && m < w.end_min) return `Dialing on — inside window ${fmt(w.start_min)}–${fmt(w.end_min)} IST.`;
    }
    const nextStart = windowsDraft
      .map((w) => w.start_min)
      .filter((s) => s > m)
      .sort((a, b) => a - b)[0];
    if (nextStart != null) return `Dialing on — resumes at ${fmt(nextStart)} IST.`;
    return "Dialing on — resumes at the next window.";
  }, [dialingActive, windowsDraft]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header + controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Pipeline</h1>
            <p className="text-sm text-muted-foreground">{statusReason}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={openManualDialog}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add beneficiary
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={handleFilePicked}
            />
            <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              CSV template
            </Button>
            {dialingActive ? (
              <Button variant="destructive" size="sm" onClick={() => toggleDialing(false)}>
                <Pause className="mr-2 h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => toggleDialing(true)}>
                <Play className="mr-2 h-4 w-4" />
                Start
              </Button>
            )}
          </div>
        </div>

        {/* Calling window editor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Calling windows (IST)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {windowsDraft.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No windows configured. Add one to allow the dialer to run.
              </p>
            )}
            {windowsDraft.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="time"
                  value={fmt(w.start_min)}
                  onChange={(e) => updateWindow(i, "start_min", e.target.value)}
                  className="w-32"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={fmt(w.end_min)}
                  onChange={(e) => updateWindow(i, "end_min", e.target.value)}
                  className="w-32"
                />
                <Button variant="ghost" size="icon" onClick={() => removeWindow(i)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={addWindow}>
                <Plus className="mr-2 h-4 w-4" />
                Add window
              </Button>
              {windowsDirty && (
                <Button size="sm" onClick={saveWindows}>Save</Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Beneficiaries table */}
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Beneficiaries</span>
              <Badge variant="secondary">{total} total</Badge>
            </CardTitle>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="from" className="text-xs">Uploaded from</Label>
                <Input
                  id="from"
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="h-8 w-40"
                />
              </div>
              <div>
                <Label htmlFor="to" className="text-xs">Uploaded to</Label>
                <Input
                  id="to"
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="h-8 w-40"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={hideCalled}
                  onCheckedChange={(v) => setHideCalled(!!v)}
                />
                Hide ineligible (connected or capped)
              </label>
              {(filterFrom || filterTo || hideCalled) && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      size="sm"
                      onClick={dialSelected}
                      disabled={bulkDialing}
                    >
                      {bulkDialing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Queuing…
                        </>
                      ) : (
                        <>
                          <Phone className="mr-2 h-4 w-4" />
                          Call selected ({selectedIds.size})
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {total === 0 ? (
              <p className="text-sm text-muted-foreground">
                No beneficiaries yet. Click "Add beneficiary" or "Upload CSV" to add some.
              </p>
            ) : filteredBeneficiaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rows match the current filter. <Button variant="link" className="h-auto p-0" onClick={clearFilters}>Clear filters</Button>
              </p>
            ) : (
              <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox
                          checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                          onCheckedChange={toggleAll}
                          aria-label="Select all visible rows"
                        />
                      </TableHead>
                      <TableHead>Name (EN)</TableHead>
                      <TableHead>Name (HI)</TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>Disposition</TableHead>
                      <TableHead>Last call</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBeneficiaries.map((b) => {
                      const capDone = callCapExhausted(b);
                      const attempts = b.attempts || 0;
                      const connected = (b.connected || 0) > 0;
                      return (
                        <TableRow key={b.id} data-state={selectedIds.has(b.id) ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(b.id)}
                              onCheckedChange={() => toggleOne(b.id)}
                              disabled={!b.phone || capDone}
                              aria-label={`Select ${b.first_name || b.phone}`}
                            />
                          </TableCell>
                          <TableCell>{[b.first_name, b.last_name].filter(Boolean).join(" ")}</TableCell>
                          <TableCell className="font-medium">{b.name_hi || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{b.phone}</TableCell>
                          <TableCell>
                            {b.action ? (
                              <Badge variant="outline" className="whitespace-nowrap">{b.action}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>
                            {b.disposition ? (
                              <Badge variant="secondary" className="whitespace-nowrap">{b.disposition}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {b.last_call_at ? new Date(b.last_call_at).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!b.phone || capDone}
                                title={
                                  connected
                                    ? "Already connected — no further calls"
                                    : attempts >= 3
                                      ? "3-attempt cap reached"
                                      : "Dial now"
                                }
                                onClick={() => dialNow(b)}
                              >
                                <Phone className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => deleteRow(b)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between pt-3 text-sm">
                <span className="text-muted-foreground">
                  Page {page + 1} of {totalPages} · {total} total
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Manual add dialog */}
        <Dialog open={manualOpen} onOpenChange={setManualOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add a beneficiary</DialogTitle>
              <DialogDescription>
                Enter name and number. The Hindi spelling is auto-generated so the AI agent pronounces it correctly — you can edit it before saving.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="manual-name">Name (English)</Label>
                <Input
                  id="manual-name"
                  value={manualNameEn}
                  onChange={(e) => setManualNameEn(e.target.value)}
                  onBlur={() => {
                    if (manualNameEn.trim() && !manualNameHi.trim()) transliterateManualName();
                  }}
                  placeholder="Vibhu Dixit"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="manual-name-hi" className="flex items-center gap-2">
                  Name (Hindi){" "}
                  {manualTransliterating && <Loader2 className="h-3 w-3 animate-spin" />}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={transliterateManualName}
                    disabled={!manualNameEn.trim() || manualTransliterating}
                  >
                    Regenerate
                  </Button>
                </Label>
                <Input
                  id="manual-name-hi"
                  value={manualNameHi}
                  onChange={(e) => setManualNameHi(e.target.value)}
                  placeholder="विभु दीक्षित"
                />
              </div>
              <div>
                <Label htmlFor="manual-number">Number</Label>
                <Input
                  id="manual-number"
                  value={manualNumber}
                  onChange={(e) => setManualNumber(e.target.value)}
                  placeholder="+91 9876543210"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManualOpen(false)} disabled={manualSaving}>
                Cancel
              </Button>
              <Button onClick={saveManualBeneficiary} disabled={manualSaving || manualTransliterating}>
                {manualSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>Save</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Upload preview dialog */}
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Preview beneficiaries</DialogTitle>
              <DialogDescription>
                Review the Hindi names below. Click any Hindi cell to correct the spelling before importing.
                {transliterating && (
                  <span className="ml-2 inline-flex items-center gap-1 text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" /> Generating Hindi names…
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name (EN)</TableHead>
                    <TableHead>Name (HI) — editable</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.name_en}</TableCell>
                      <TableCell>
                        <Input
                          value={r.name_hi}
                          onChange={(e) =>
                            setUploadRows((prev) =>
                              prev.map((x, idx) => (idx === i ? { ...x, name_hi: e.target.value } : x)),
                            )
                          }
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{r.number}</TableCell>
                      <TableCell>
                        <select
                          value={IEDUP_ACTIONS.includes(r.action) ? r.action : ""}
                          onChange={(e) =>
                            setUploadRows((prev) =>
                              prev.map((x, idx) => (idx === i ? { ...x, action: e.target.value } : x)),
                            )
                          }
                          className="h-8 rounded-md border bg-background px-2 text-sm"
                        >
                          <option value="">— none —</option>
                          {IEDUP_ACTIONS.map((a) => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing || transliterating}>
                {importing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                  </>
                ) : (
                  <>Import {uploadRows.length} row{uploadRows.length === 1 ? "" : "s"}</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function normalizePhone(p: string): string {
  const t = p.trim();
  if (!t) return "";
  if (t.startsWith("+")) return t;
  const digits = t.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return t;
}

function fmt(min: number): string {
  if (!Number.isFinite(min)) return "00:00";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function istMinutesNow(): number {
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMin + 5 * 60 + 30) % (24 * 60);
}
