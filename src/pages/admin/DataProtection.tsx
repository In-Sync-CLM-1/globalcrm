import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useNotification } from "@/hooks/useNotification";
import {
  ShieldCheck, FileText, CheckCircle2, AlertTriangle, KeyRound, Eye,
  Database, ClipboardList, Download, Lock, Trash2, Clock,
} from "lucide-react";

type DataRequest = {
  id: string; request_type: string; status: string; requester_identifier: string;
  contact_id: string | null; details: string | null; due_date: string;
  created_at: string; completed_at: string | null; source: string | null;
};
type Consent = {
  id: string; data_principal_identifier: string; consent_version: string; purpose: string;
  channels: string[]; status: string; consented_at: string; withdrawn_at: string | null; source: string | null;
};
type AuditRow = {
  id: string; user_id: string | null; table_name: string; column_name: string;
  contact_id: string | null; purpose: string; accessed_at: string;
};
type Breach = {
  id: string; title: string; description: string; impact: string; remedial_steps: string;
  contact_info: string; affected_count: number | null; triggered_at: string;
};

const REQUEST_LABEL: Record<string, string> = {
  access: "Data Access", correction: "Correction", erasure: "Erasure", nomination: "Nomination",
};
const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function DataProtection() {
  const { effectiveOrgId } = useOrgContext();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const notify = useNotification();
  // The DPDP tables/columns are newer than the committed Supabase types; use a
  // loosely-typed client for them (auth stays fully typed via `supabase`).
  const sb = supabase as any;

  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [settings, setSettings] = useState({
    dpo_name: "", dpo_email: "", dpo_phone: "", grievance_email: "",
    privacy_policy_url: "", data_retention_days: 2555,
  });
  const [breachForm, setBreachForm] = useState({
    title: "", description: "", impact: "", remedial_steps: "", contact_info: "",
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [submittingBreach, setSubmittingBreach] = useState(false);

  useEffect(() => {
    if (!effectiveOrgId) return;
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOrgId]);

  async function loadAll() {
    if (!effectiveOrgId) return;
    const [rq, cs, au, br, st] = await Promise.all([
      sb.from("data_requests").select("*").eq("org_id", effectiveOrgId).order("created_at", { ascending: false }).limit(200),
      sb.from("consent_records").select("*").eq("org_id", effectiveOrgId).order("consented_at", { ascending: false }).limit(200),
      sb.from("pii_access_log").select("*").eq("org_id", effectiveOrgId).order("accessed_at", { ascending: false }).limit(500),
      sb.from("data_breach_notifications").select("*").eq("org_id", effectiveOrgId).order("triggered_at", { ascending: false }).limit(100),
      sb.from("organization_settings").select("dpo_name,dpo_email,dpo_phone,grievance_email,privacy_policy_url,data_retention_days").eq("org_id", effectiveOrgId).maybeSingle(),
    ]);
    setRequests((rq.data as DataRequest[]) || []);
    setConsents((cs.data as Consent[]) || []);
    setAudit((au.data as AuditRow[]) || []);
    setBreaches((br.data as Breach[]) || []);
    if (st.data) setSettings({
      dpo_name: st.data.dpo_name || "", dpo_email: st.data.dpo_email || "",
      dpo_phone: st.data.dpo_phone || "", grievance_email: st.data.grievance_email || "",
      privacy_policy_url: st.data.privacy_policy_url || "",
      data_retention_days: st.data.data_retention_days ?? 2555,
    });
  }

  const stats = useMemo(() => ({
    pending: requests.filter((r) => r.status === "pending").length,
    overdue: requests.filter((r) => r.status !== "completed" && r.status !== "rejected" && new Date(r.due_date) < new Date()).length,
    consents: consents.length,
    withdrawn: consents.filter((c) => c.status === "withdrawn").length,
    breaches: breaches.length,
    audits: audit.length,
  }), [requests, consents, breaches, audit]);

  async function updateRequest(r: DataRequest, status: string) {
    // Erasure that is being completed runs the audited anonymisation RPC.
    if (status === "completed" && r.request_type === "erasure" && r.contact_id) {
      const { error } = await sb.rpc("erase_contact_pii", { p_contact_id: r.contact_id, p_request_id: r.id } as never);
      if (error) { notify.error("Erasure failed", error); return; }
      notify.success("Personal data erased", "The contact's PII was anonymised and the request closed.");
    } else {
      const patch: Record<string, unknown> = { status };
      if (status === "completed") patch.completed_at = new Date().toISOString();
      const { error } = await sb.from("data_requests").update(patch).eq("id", r.id);
      if (error) { notify.error("Update failed", error); return; }
    }
    void loadAll();
  }

  async function saveSettings() {
    if (!effectiveOrgId) return;
    setSavingSettings(true);
    const { error } = await sb.from("organization_settings")
      .update({ ...settings }).eq("org_id", effectiveOrgId);
    setSavingSettings(false);
    if (error) { notify.error("Could not save", error); return; }
    notify.success("Saved", "Data-protection settings updated.");
  }

  async function submitBreach() {
    if (!effectiveOrgId) return;
    if (!breachForm.title || !breachForm.description || !breachForm.impact || !breachForm.remedial_steps) {
      notify.error("Missing details", "Title, description, impact and remedial steps are required."); return;
    }
    setSubmittingBreach(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await sb.from("data_breach_notifications").insert({
      org_id: effectiveOrgId, ...breachForm,
      contact_info: breachForm.contact_info || settings.dpo_email || "dpo@in-sync.co.in",
      triggered_by: user?.id ?? null,
    });
    setSubmittingBreach(false);
    if (error) { notify.error("Could not record breach", error); return; }
    setBreachForm({ title: "", description: "", impact: "", remedial_steps: "", contact_info: "" });
    notify.success("Breach recorded", "The breach notification has been logged.");
    void loadAll();
  }

  function exportAudit() {
    const head = ["accessed_at", "user_id", "table_name", "column_name", "contact_id", "purpose"];
    const rows = audit.map((a) => [a.accessed_at, a.user_id ?? "", a.table_name, a.column_name, a.contact_id ?? "", a.purpose]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `pii-access-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (roleLoading) {
    return <DashboardLayout><div className="p-8 text-muted-foreground">Loading…</div></DashboardLayout>;
  }
  if (!isAdmin) {
    return <DashboardLayout><div className="p-8">
      <h1 className="text-2xl font-bold">Data Protection</h1>
      <p className="text-muted-foreground mt-2">This area is restricted to organization admins.</p>
    </div></DashboardLayout>;
  }

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-100 text-amber-800", in_progress: "bg-blue-100 text-blue-800",
      completed: "bg-emerald-100 text-emerald-800", rejected: "bg-red-100 text-red-800",
      granted: "bg-emerald-100 text-emerald-800", withdrawn: "bg-red-100 text-red-800",
    };
    return <Badge className={map[s] || "bg-muted text-foreground"}>{s.replace("_", " ")}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Data Protection</h1>
            <p className="text-muted-foreground">DPDP Act, 2023 — consent, data-principal rights, audit & retention</p>
          </div>
        </div>

        {/* stat strip */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Stat icon={<ClipboardList className="h-4 w-4" />} label="Pending requests" value={stats.pending} />
          <Stat icon={<Clock className="h-4 w-4" />} label="Overdue" value={stats.overdue} danger={stats.overdue > 0} />
          <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Consents on file" value={stats.consents} />
          <Stat icon={<Trash2 className="h-4 w-4" />} label="Withdrawn" value={stats.withdrawn} />
          <Stat icon={<Eye className="h-4 w-4" />} label="PII accesses" value={stats.audits} />
          <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Breaches" value={stats.breaches} danger={stats.breaches > 0} />
        </div>

        <Tabs defaultValue="requests">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="requests"><ClipboardList className="h-4 w-4 mr-1" />Data Requests</TabsTrigger>
            <TabsTrigger value="consent"><FileText className="h-4 w-4 mr-1" />Consent</TabsTrigger>
            <TabsTrigger value="audit"><Eye className="h-4 w-4 mr-1" />PII Audit</TabsTrigger>
            <TabsTrigger value="breach"><AlertTriangle className="h-4 w-4 mr-1" />Breach</TabsTrigger>
            <TabsTrigger value="encryption"><KeyRound className="h-4 w-4 mr-1" />Encryption</TabsTrigger>
            <TabsTrigger value="settings"><Database className="h-4 w-4 mr-1" />Settings</TabsTrigger>
          </TabsList>

          {/* ---- DATA REQUESTS ---- */}
          <TabsContent value="requests" className="space-y-3">
            {requests.length === 0 && <Empty icon={<CheckCircle2 />} text="No data-principal requests yet." />}
            {requests.map((r) => {
              const overdue = r.status !== "completed" && r.status !== "rejected" && new Date(r.due_date) < new Date();
              return (
                <Card key={r.id}>
                  <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{REQUEST_LABEL[r.request_type] || r.request_type}</span>
                        {statusBadge(r.status)}
                        {overdue && <Badge className="bg-red-100 text-red-800">Overdue</Badge>}
                        {r.request_type === "erasure" && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="text-sm text-muted-foreground">{r.requester_identifier}</div>
                      <div className="text-xs text-muted-foreground">Filed {fmt(r.created_at)} · Due {fmt(r.due_date)}</div>
                      {r.details && <div className="text-sm mt-1">{r.details}</div>}
                    </div>
                    <div className="flex gap-2">
                      {r.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => updateRequest(r, "in_progress")}>Start</Button>
                      )}
                      {r.status !== "completed" && r.status !== "rejected" && (
                        <Button size="sm" onClick={() => updateRequest(r, "completed")}>
                          {r.request_type === "erasure" ? "Erase & complete" : "Complete"}
                        </Button>
                      )}
                      {r.status === "pending" && (
                        <Button size="sm" variant="ghost" onClick={() => updateRequest(r, "rejected")}>Reject</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          {/* ---- CONSENT ---- */}
          <TabsContent value="consent">
            <Card>
              <CardHeader><CardTitle>Consent records</CardTitle>
                <CardDescription>Every consent captured, the purpose, channels and version agreed.</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto">
                {consents.length === 0 ? <Empty icon={<FileText />} text="No consent records yet." /> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-3">Data principal</th><th className="pr-3">Purpose</th>
                      <th className="pr-3">Channels</th><th className="pr-3">Version</th>
                      <th className="pr-3">Status</th><th className="pr-3">When</th></tr></thead>
                    <tbody>
                      {consents.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">{c.data_principal_identifier}</td>
                          <td className="pr-3">{c.purpose}</td>
                          <td className="pr-3">{(c.channels || []).join(", ")}</td>
                          <td className="pr-3">v{c.consent_version}</td>
                          <td className="pr-3">{statusBadge(c.status)}</td>
                          <td className="pr-3 text-muted-foreground">{fmt(c.consented_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- PII AUDIT ---- */}
          <TabsContent value="audit">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>PII access audit</CardTitle>
                  <CardDescription>Every decryption / access of personal data, logged automatically.</CardDescription></div>
                <Button variant="outline" size="sm" onClick={exportAudit}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {audit.length === 0 ? <Empty icon={<Eye />} text="No PII access recorded yet." /> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-3">When</th><th className="pr-3">User</th>
                      <th className="pr-3">Table</th><th className="pr-3">Field</th>
                      <th className="pr-3">Contact</th><th className="pr-3">Purpose</th></tr></thead>
                    <tbody>
                      {audit.slice(0, 200).map((a) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 text-muted-foreground">{fmt(a.accessed_at)}</td>
                          <td className="pr-3 font-mono text-xs">{(a.user_id || "system").slice(0, 8)}</td>
                          <td className="pr-3">{a.table_name}</td>
                          <td className="pr-3">{a.column_name}</td>
                          <td className="pr-3 font-mono text-xs">{a.contact_id ? a.contact_id.slice(0, 8) : "—"}</td>
                          <td className="pr-3"><Badge variant="outline">{a.purpose}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- BREACH ---- */}
          <TabsContent value="breach" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Report a data breach</CardTitle>
                <CardDescription>As required by the DPDP Act, breach notices must be in clear, plain language.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Title</Label>
                    <Input value={breachForm.title} onChange={(e) => setBreachForm({ ...breachForm, title: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Contact (DPO)</Label>
                    <Input value={breachForm.contact_info} placeholder={settings.dpo_email || "dpo@in-sync.co.in"}
                      onChange={(e) => setBreachForm({ ...breachForm, contact_info: e.target.value })} /></div>
                </div>
                <div className="space-y-1"><Label>What happened</Label>
                  <Textarea value={breachForm.description} onChange={(e) => setBreachForm({ ...breachForm, description: e.target.value })} /></div>
                <div className="space-y-1"><Label>Impact on data principals</Label>
                  <Textarea value={breachForm.impact} onChange={(e) => setBreachForm({ ...breachForm, impact: e.target.value })} /></div>
                <div className="space-y-1"><Label>Remedial steps taken</Label>
                  <Textarea value={breachForm.remedial_steps} onChange={(e) => setBreachForm({ ...breachForm, remedial_steps: e.target.value })} /></div>
                <Button variant="destructive" disabled={submittingBreach} onClick={submitBreach}>
                  {submittingBreach ? "Recording…" : "Record breach notification"}
                </Button>
              </CardContent>
            </Card>
            {breaches.length > 0 && (
              <Card><CardHeader><CardTitle>Past breach notifications</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {breaches.map((b) => (
                    <div key={b.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{b.title}</span>
                        <span className="text-xs text-muted-foreground">{fmt(b.triggered_at)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{b.description}</p>
                    </div>
                  ))}
                </CardContent></Card>
            )}
          </TabsContent>

          {/* ---- ENCRYPTION ---- */}
          <TabsContent value="encryption" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />PII encryption</CardTitle>
                <CardDescription>Personal data is encrypted with AES-256 and decrypted only through audited access.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" /><span className="font-medium">Encryption key configured (held in Supabase Vault)</span>
                </div>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
                  <li>Contact email and phone are encrypted at rest with AES-256; the key lives in the vault, never in code or logs.</li>
                  <li>Decryption runs only through an authorized server function, and <span className="font-medium text-foreground">every access is written to the audit log</span>.</li>
                  <li>Data is hosted in India and encrypted at rest at the database layer.</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- SETTINGS ---- */}
          <TabsContent value="settings">
            <Card>
              <CardHeader><CardTitle>Data-protection settings</CardTitle>
                <CardDescription>Your Data Protection Officer, grievance contact, privacy policy and retention.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>DPO name</Label>
                    <Input value={settings.dpo_name} onChange={(e) => setSettings({ ...settings, dpo_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label>DPO email</Label>
                    <Input value={settings.dpo_email} onChange={(e) => setSettings({ ...settings, dpo_email: e.target.value })} /></div>
                  <div className="space-y-1"><Label>DPO phone</Label>
                    <Input value={settings.dpo_phone} onChange={(e) => setSettings({ ...settings, dpo_phone: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Grievance email</Label>
                    <Input value={settings.grievance_email} onChange={(e) => setSettings({ ...settings, grievance_email: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Privacy policy URL</Label>
                    <Input value={settings.privacy_policy_url} onChange={(e) => setSettings({ ...settings, privacy_policy_url: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Retention period (days)</Label>
                    <Input type="number" value={settings.data_retention_days}
                      onChange={(e) => setSettings({ ...settings, data_retention_days: Number(e.target.value) })} />
                    <p className="text-xs text-muted-foreground">Contacts untouched beyond this window are anonymised automatically.</p></div>
                </div>
                <Button disabled={savingSettings} onClick={saveSettings}>{savingSettings ? "Saving…" : "Save settings"}</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Stat({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: number; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}{label}</div>
        <div className={`text-2xl font-bold mt-1 ${danger ? "text-red-600" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <div className="h-8 w-8 mb-2 text-emerald-500">{icon}</div>
      <p>{text}</p>
    </div>
  );
}
