import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useAuth } from "@/contexts/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, CheckSquare, Square, Database } from "lucide-react";

const EXPORT_TABLES: { category: string; tables: string[] }[] = [
  {
    category: "Users & Profiles",
    tables: ["profiles", "user_roles", "auth_users"],
  },
  {
    category: "Organizations",
    tables: ["organizations", "org_invites", "org_feature_access", "org_business_hours"],
  },
  {
    category: "Contacts & Pipeline",
    tables: ["contacts", "contact_activities", "contact_emails", "contact_phones", "contact_custom_fields", "pipeline_stages"],
  },
  {
    category: "Clients",
    tables: ["clients", "client_invoices", "client_documents", "client_alternate_contacts"],
  },
  {
    category: "Communication",
    tables: ["communication_templates", "email_templates", "email_conversations", "whatsapp_messages"],
  },
  {
    category: "Email Campaigns",
    tables: ["email_bulk_campaigns", "email_campaign_recipients"],
  },
  {
    category: "WhatsApp Campaigns",
    tables: ["whatsapp_bulk_campaigns", "whatsapp_campaign_recipients"],
  },
  {
    category: "Analytics",
    tables: ["campaign_analytics", "campaign_insights"],
  },
  {
    category: "Tasks & Calendar",
    tables: ["tasks", "calendar_shares", "activity_participants"],
  },
  {
    category: "Call Logs",
    tables: ["call_logs", "call_dispositions", "call_sub_dispositions", "agent_call_sessions"],
  },
  {
    category: "Support",
    tables: ["support_tickets", "support_ticket_comments", "support_ticket_history"],
  },
  {
    category: "Email Automation",
    tables: ["email_automation_rules", "email_automation_executions", "automation_ab_tests", "automation_approvals", "automation_performance_daily"],
  },
  {
    category: "Forms & Connectors",
    tables: ["forms", "connector_logs"],
  },
  {
    category: "Webhooks",
    tables: ["outbound_webhooks", "outbound_webhook_logs"],
  },
  {
    category: "Teams & Org Structure",
    tables: ["teams", "team_members", "designations", "reporting_hierarchy"],
  },
  {
    category: "Settings",
    tables: ["custom_fields", "api_keys", "api_key_usage_logs"],
  },
  {
    category: "Subscriptions & Billing",
    tables: ["organization_subscriptions", "subscription_invoices", "wallet_transactions", "service_usage_logs", "subscription_pricing"],
  },
  {
    category: "Other",
    tables: [
      "blog_posts", "bulk_import_history", "notifications",
      "external_entities", "approval_types", "approval_rules",
      "fervent_data_repository",
      "chat_conversations", "chat_messages", "chat_participants",
      "monthly_actuals_snapshot", "revenue_goals", "carry_forward_snapshot",
      "contact_lead_scores", "email_suppression_list", "email_unsubscribes",
    ],
  },
];

const ALL_TABLES = EXPORT_TABLES.flatMap((c) => c.tables);

function countCSVRows(text: string): number {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function DataExport() {
  const { isPlatformAdmin, isLoading: orgLoading } = useOrgContext();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const exportTable = useCallback(
    async (table: string): Promise<boolean> => {
      if (!session?.access_token) {
        toast.error("Not authenticated");
        return false;
      }
      setDownloading(table);
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const resp = await fetch(
          `https://${projectId}.supabase.co/functions/v1/export-table-csv`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ table }),
          }
        );

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: resp.statusText }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const text = await resp.text();
        let rowCount = parseInt(resp.headers.get("X-Row-Count") || "0", 10);
        if (!rowCount && text.length > 0) {
          rowCount = countCSVRows(text);
        }

        setRowCounts((prev) => ({ ...prev, [table]: rowCount }));

        const today = new Date().toISOString().split("T")[0];
        const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `${table}_${today}.csv`);

        toast.success(`${table} exported`, {
          description: `${rowCount.toLocaleString()} rows`,
        });
        return true;
      } catch (err: any) {
        toast.error(`Failed to export ${table}`, { description: err.message });
        return false;
      } finally {
        setDownloading(null);
      }
    },
    [session]
  );

  if (!orgLoading && !isPlatformAdmin) {
    navigate("/dashboard");
    return null;
  }

  const toggleTable = (table: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(table) ? next.delete(table) : next.add(table);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === ALL_TABLES.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(ALL_TABLES));
    }
  };



  const bulkExport = async () => {
    if (selected.size === 0) {
      toast.warning("No tables selected");
      return;
    }
    setBulkDownloading(true);
    let successCount = 0;
    for (const table of selected) {
      const ok = await exportTable(table);
      if (ok) successCount++;
    }
    setBulkDownloading(false);
    toast.success("Bulk export complete", {
      description: `${successCount}/${selected.size} tables exported`,
    });
  };

  const allSelected = selected.size === ALL_TABLES.length;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Database className="h-6 w-6 text-primary" />
              Data Export
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Export database tables as CSV files. Platform admin only.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={toggleAll}>
              {allSelected ? (
                <><Square className="h-4 w-4 mr-1" /> Deselect All</>
              ) : (
                <><CheckSquare className="h-4 w-4 mr-1" /> Select All</>
              )}
            </Button>
            <Button
              size="sm"
              onClick={bulkExport}
              disabled={selected.size === 0 || bulkDownloading}
            >
              {bulkDownloading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Download Selected ({selected.size})
            </Button>
          </div>
        </div>

        {/* Table Grid */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {EXPORT_TABLES.map((cat) => (
            <Card key={cat.category}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{cat.category}</CardTitle>
                <CardDescription className="text-xs">
                  {cat.tables.length} table{cat.tables.length > 1 ? "s" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {cat.tables.map((table) => (
                  <div
                    key={table}
                    className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={selected.has(table)}
                        onCheckedChange={() => toggleTable(table)}
                        id={table}
                      />
                      <label
                        htmlFor={table}
                        className="text-sm font-mono truncate cursor-pointer"
                      >
                        {table}
                      </label>
                      {rowCounts[table] !== undefined && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {rowCounts[table].toLocaleString()} rows
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => exportTable(table)}
                      disabled={downloading === table}
                    >
                      {downloading === table ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
