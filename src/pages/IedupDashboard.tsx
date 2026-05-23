import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { TopUpWalletDialog } from "@/components/Subscription/TopUpWalletDialog";
import {
  Users as UsersIcon,
  PhoneCall,
  MessageSquare,
  IndianRupee,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useIsIedup, IEDUP_ORG_ID } from "@/hooks/useIsIedup";

const REFRESH_MS = 30_000;

export default function IedupDashboard() {
  const { isLoading: orgLoading } = useIsIedup();
  const [topUpOpen, setTopUpOpen] = useState(false);

  // Data counts
  const { data: dataCounts, refetch: refetchData } = useQuery({
    queryKey: ["iedup-data-counts"],
    queryFn: async () => {
      const [total, called, dnc] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", IEDUP_ORG_ID),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", IEDUP_ORG_ID).not("last_contacted_at", "is", null),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", IEDUP_ORG_ID).eq("do_not_call", true),
      ]);
      const totalN = total.count || 0;
      const calledN = called.count || 0;
      const dncN = dnc.count || 0;
      return { total: totalN, called: calledN, pending: Math.max(0, totalN - calledN - dncN), dnc: dncN };
    },
    refetchInterval: REFRESH_MS,
  });

  // Call summary
  const { data: callSummary, refetch: refetchCalls } = useQuery({
    queryKey: ["iedup-call-summary"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("call_logs")
        .select("status, conversation_duration, call_duration")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("caller_type", "ai");

      const all = rows || [];
      const placed = all.length;
      const connected = all.filter((r) => Number(r.conversation_duration || 0) >= 5).length;
      const noAnswer = all.filter((r) => ["no-answer", "busy", "canceled"].includes(String(r.status))).length;
      const failed = all.filter((r) => ["failed", "error"].includes(String(r.status))).length;
      const totalSec = all.reduce((acc, r) => acc + Number(r.conversation_duration || 0), 0);
      const avgSec = placed > 0 ? Math.round(totalSec / placed) : 0;
      const totalMin = Math.ceil(totalSec / 60);
      const costRupees = totalMin * 3;
      return { placed, connected, noAnswer, failed, avgSec, totalMin, costRupees };
    },
    refetchInterval: REFRESH_MS,
  });

  // Message summary
  const { data: msgSummary, refetch: refetchMsgs } = useQuery({
    queryKey: ["iedup-msg-summary"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("whatsapp_logs")
        .select("status, cost_charged")
        .eq("org_id", IEDUP_ORG_ID);
      const all = rows || [];
      const queued = all.filter((r) => r.status === "queued").length;
      const sent = all.filter((r) => r.status === "sent").length;
      const delivered = all.filter((r) => r.status === "delivered").length;
      const read = all.filter((r) => r.status === "read").length;
      const failed = all.filter((r) => r.status === "failed").length;
      const cost = all.reduce((acc, r) => acc + Number(r.cost_charged || 0), 0);
      return { queued, sent, delivered, read, failed, cost };
    },
    refetchInterval: REFRESH_MS,
  });

  // Wallet & subscription
  const { data: sub } = useQuery({
    queryKey: ["iedup-subscription"],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_subscriptions")
        .select("*")
        .eq("org_id", IEDUP_ORG_ID)
        .maybeSingle();
      return data;
    },
    refetchInterval: REFRESH_MS,
  });

  // Settings (dialing active flag)
  const { data: settings } = useQuery({
    queryKey: ["iedup-org-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_settings")
        .select("dialing_active, calling_windows, updated_at")
        .eq("org_id", IEDUP_ORG_ID)
        .maybeSingle();
      return data;
    },
    refetchInterval: REFRESH_MS,
  });

  useEffect(() => {
    const t = setInterval(() => {
      refetchData();
      refetchCalls();
      refetchMsgs();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refetchData, refetchCalls, refetchMsgs]);

  if (orgLoading) {
    return <DashboardLayout><div className="p-6">Loading…</div></DashboardLayout>;
  }

  const trialDaysLeft = sub?.billing_cycle_start
    ? daysBetween(new Date(), new Date(sub.next_billing_date))
    : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">IEDUP Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              CM YUVA training notifications — calls and WhatsApp messages at a glance.
            </p>
          </div>
          <Badge variant={settings?.dialing_active ? "default" : "secondary"} className="text-sm">
            {settings?.dialing_active ? "Dialing ON" : "Dialing OFF"}
          </Badge>
        </div>

        {/* Data count */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Beneficiary data
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={<UsersIcon size={18} />} label="Total" value={dataCounts?.total ?? "—"} />
            <StatCard icon={<Clock size={18} />} label="Pending" value={dataCounts?.pending ?? "—"} />
            <StatCard icon={<CheckCircle2 size={18} />} label="Called" value={dataCounts?.called ?? "—"} />
            <StatCard icon={<XCircle size={18} />} label="Do not call" value={dataCounts?.dnc ?? "—"} />
          </div>
        </section>

        {/* Call summary */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Call summary (all time)
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={<PhoneCall size={18} />} label="Placed" value={callSummary?.placed ?? "—"} />
            <StatCard icon={<CheckCircle2 size={18} />} label="Connected" value={callSummary?.connected ?? "—"} />
            <StatCard icon={<AlertTriangle size={18} />} label="No answer / busy" value={callSummary?.noAnswer ?? "—"} />
            <StatCard icon={<XCircle size={18} />} label="Failed" value={callSummary?.failed ?? "—"} />
            <StatCard icon={<Clock size={18} />} label="Avg duration" value={callSummary ? `${callSummary.avgSec}s` : "—"} />
            <StatCard icon={<IndianRupee size={18} />} label="Call cost" value={callSummary ? `₹${callSummary.costRupees}` : "—"} />
          </div>
        </section>

        {/* Message summary */}
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            WhatsApp messages
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={<MessageSquare size={18} />} label="Queued" value={msgSummary?.queued ?? "—"} />
            <StatCard icon={<MessageSquare size={18} />} label="Sent" value={msgSummary?.sent ?? "—"} />
            <StatCard icon={<CheckCircle2 size={18} />} label="Delivered" value={msgSummary?.delivered ?? "—"} />
            <StatCard icon={<CheckCircle2 size={18} />} label="Read" value={msgSummary?.read ?? "—"} />
            <StatCard icon={<XCircle size={18} />} label="Failed" value={msgSummary?.failed ?? "—"} />
            <StatCard icon={<IndianRupee size={18} />} label="Message cost" value={msgSummary ? `₹${msgSummary.cost.toFixed(2)}` : "—"} />
          </div>
        </section>

        {/* Wallet / subscription strip */}
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Wallet balance</p>
                <p className="text-lg font-semibold">₹{Number(sub?.wallet_balance ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Trial / next billing</p>
                <p className="text-lg font-semibold">
                  {sub?.next_billing_date
                    ? `${trialDaysLeft != null ? `${trialDaysLeft} days` : "—"} (${sub.next_billing_date})`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="text-lg font-semibold capitalize">{sub?.subscription_status || "—"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/pipeline">Manage queue</Link>
              </Button>
              <Button size="sm" onClick={() => setTopUpOpen(true)}>
                Top up wallet
              </Button>
            </div>
          </CardContent>
        </Card>

        <TopUpWalletDialog
          open={topUpOpen}
          onOpenChange={setTopUpOpen}
          orgId={IEDUP_ORG_ID}
        />
      </div>
    </DashboardLayout>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
