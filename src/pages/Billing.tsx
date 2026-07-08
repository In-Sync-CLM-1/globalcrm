import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { TopUpWalletDialog } from "@/components/Subscription/TopUpWalletDialog";
import { ManualPaymentDetails } from "@/components/Subscription/ManualPaymentDetails";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, addDays, differenceInCalendarDays } from "date-fns";
import { Wallet, Users, CalendarClock, Loader2, CheckCircle2, IndianRupee, Receipt, TrendingUp, FileText } from "lucide-react";

declare global { interface Window { Razorpay?: any } }

const TRIAL_DAYS = 14;

const PLANS = [
  { id: "quarterly" as const, label: "Quarterly", months: 3, note: "Billed every 3 months" },
  { id: "annual" as const, label: "Annual", months: 12, note: "Billed once a year" },
];

function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined" || window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(); s.onerror = () => reject(new Error("Razorpay failed to load"));
    document.body.appendChild(s);
  });
}

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

export default function Billing() {
  const { effectiveOrgId, isLoading: orgLoading } = useOrgContext();
  const notify = useNotification();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<"quarterly" | "annual">("quarterly");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [showManualPay, setShowManualPay] = useState(false);

  useEffect(() => { loadRazorpay().catch(() => undefined); }, []);

  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ["billing-subscription", effectiveOrgId],
    queryFn: async () => (await supabase.from("organization_subscriptions").select("*").eq("org_id", effectiveOrgId).maybeSingle()).data,
    enabled: !!effectiveOrgId,
  });

  const { data: pricing } = useQuery({
    queryKey: ["billing-pricing"],
    queryFn: async () => (await supabase.from("subscription_pricing").select("per_user_monthly_cost, gst_percentage, min_wallet_balance").eq("is_active", true).maybeSingle()).data,
  });

  const { data: usage } = useQuery({
    queryKey: ["billing-usage", effectiveOrgId],
    queryFn: async () => {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const { data } = await supabase.from("service_usage_logs").select("service_type, quantity, cost").eq("org_id", effectiveOrgId).gte("created_at", monthStart.toISOString());
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  const { data: txns } = useQuery({
    queryKey: ["billing-txns", effectiveOrgId],
    queryFn: async () => (await supabase.from("wallet_transactions").select("id, transaction_type, amount, balance_after, description, created_at").eq("org_id", effectiveOrgId).order("created_at", { ascending: false }).limit(25)).data || [],
    enabled: !!effectiveOrgId,
  });

  const { data: invoices } = useQuery({
    queryKey: ["billing-invoices", effectiveOrgId],
    queryFn: async () => (await supabase.from("subscription_invoices").select("*").eq("org_id", effectiveOrgId).order("created_at", { ascending: false }).limit(25)).data || [],
    enabled: !!effectiveOrgId,
  });

  const { data: org } = useQuery({
    queryKey: ["billing-org", effectiveOrgId],
    queryFn: async () => (await supabase.from("organizations").select("created_at").eq("id", effectiveOrgId).maybeSingle()).data,
    enabled: !!effectiveOrgId,
  });

  const perUser = Number(pricing?.per_user_monthly_cost ?? 799);
  const gstPct = Number(pricing?.gst_percentage ?? 18);
  const seats = Math.max(1, Number(sub?.user_count ?? 1));
  const months = period === "annual" ? 12 : 3;
  const base = seats * perUser * months;
  const gst = +(base * gstPct / 100).toFixed(2);
  const total = +(base + gst).toFixed(2);

  // Trial is informational only, same as every other org (Fervent included):
  // no separate lockout state. A trial "ends" the moment the org has ever
  // paid, or 14 days after signup, whichever comes first — after that the
  // existing overdue-invoice ladder (grace -> read-only -> locked) is the
  // only enforcement that ever applies. Read off organization_subscriptions.
  // last_payment_date, not the invoices table — an invoice-ledger insert can
  // fail independently of the payment itself succeeding (see
  // SubscriptionStatusBanner for the incident that surfaced this).
  const hasEverPaid = !!sub?.last_payment_date;
  const trialEndsAt = org?.created_at ? addDays(new Date(org.created_at), TRIAL_DAYS) : null;
  const daysLeftInTrial = trialEndsAt ? differenceInCalendarDays(trialEndsAt, new Date()) : null;
  const inTrial = !hasEverPaid && daysLeftInTrial !== null && daysLeftInTrial >= 0;
  const trialEnded = !hasEverPaid && daysLeftInTrial !== null && daysLeftInTrial < 0;

  const usageSummary = useMemo(() => {
    const rows = usage || [];
    const calc = (type: string) => {
      const f = rows.filter((r: any) => r.service_type === type);
      return { count: f.reduce((a: number, r: any) => a + Number(r.quantity || 0), 0), cost: f.reduce((a: number, r: any) => a + Number(r.cost || 0), 0) };
    };
    return { call: calc("call"), whatsapp: calc("whatsapp") };
  }, [usage]);

  async function paySubscription() {
    if (!effectiveOrgId) return;
    setPaying(true);
    try {
      await loadRazorpay();
      if (!window.Razorpay) throw new Error("Razorpay not available");
      const { data: order, error } = await supabase.functions.invoke("create-razorpay-order", {
        body: { org_id: effectiveOrgId, amount: base, type: "subscription", billing_period: period },
      });
      if (error) throw error;
      if (!order?.order_id) throw new Error(order?.error || "Could not start payment");

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount_in_paise,
        currency: order.currency,
        name: "globalcrm",
        description: `${PLANS.find((p) => p.id === period)!.label} subscription — ${seats} user${seats > 1 ? "s" : ""}`,
        order_id: order.order_id,
        notes: { org_id: effectiveOrgId, type: "subscription", billing_period: period },
        theme: { color: "#2563eb" },
        handler: async (resp: any) => {
          try {
            const { data: v, error: vErr } = await supabase.functions.invoke("verify-razorpay-payment", {
              body: {
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
                payment_transaction_id: order.payment_transaction_id,
              },
            });
            if (vErr) throw vErr;
            if (v?.error) throw new Error(v.error);
            notify.success("Subscription active", `${PLANS.find((p) => p.id === period)!.label} plan activated.`);
            qc.invalidateQueries({ queryKey: ["billing-subscription"] });
          } catch (e: any) {
            notify.error("Verification failed", e?.message || "Could not verify payment.");
          }
        },
      });
      rzp.on("payment.failed", (r: any) => {
        notify.error("Payment failed", r?.error?.description || "Razorpay reported a failure.");
        setShowManualPay(true);
      });
      rzp.open();
    } catch (e: any) {
      notify.error("Could not start payment", e?.message || "Try again in a moment.");
      setShowManualPay(true);
    } finally {
      setPaying(false);
    }
  }

  if (orgLoading || subLoading) {
    return <DashboardLayout><LoadingState message="Loading billing…" /></DashboardLayout>;
  }

  const status = String(sub?.subscription_status || "—");
  const balance = Number(sub?.wallet_balance ?? 0);
  const nextBilling = sub?.next_billing_date ? format(new Date(sub.next_billing_date), "d MMM yyyy") : "—";

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">Your subscription, wallet, and usage in one place.</p>
        </div>

        {/* Snapshot */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SnapCard icon={<Wallet size={16} />} tone="blue" label="Wallet balance" value={inr(balance)}
            hint={balance <= 500 ? "At the ₹500 reserve — calls & messages are paused until you top up" : balance <= 1000 ? "Low balance" : undefined} />
          <SnapCard icon={<CheckCircle2 size={16} />} tone="emerald" label="Subscription"
            value={<span className="capitalize">{inTrial ? "Trial" : trialEnded ? "Trial ended" : status}</span>}
            hint={
              inTrial ? `${daysLeftInTrial} day${daysLeftInTrial === 1 ? "" : "s"} left · ends ${format(trialEndsAt!, "d MMM yyyy")}`
              : trialEnded ? `Trial ended ${format(trialEndsAt!, "d MMM yyyy")} · subscribe below`
              : `${seats} user${seats > 1 ? "s" : ""} × ${inr(perUser)}/mo`
            } />
          <SnapCard icon={<CalendarClock size={16} />} tone="violet" label="Next billing" value={nextBilling} />
        </div>

        {/* Subscription */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Subscription plan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users size={15} /> Charged on <span className="font-medium text-foreground">{seats}</span> user{seats > 1 ? "s" : ""} created · <span className="font-medium text-foreground">{inr(perUser)}</span> per user / month
              {inTrial && <> · <span className="font-medium text-foreground">{daysLeftInTrial} day{daysLeftInTrial === 1 ? "" : "s"}</span> left in your 14-day free trial</>}
              {trialEnded && <> · your 14-day free trial ended <span className="font-medium text-foreground">{format(trialEndsAt!, "d MMM yyyy")}</span></>}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PLANS.map((p) => {
                const m = p.months; const b = seats * perUser * m; const t = +(b + b * gstPct / 100).toFixed(2);
                const active = period === p.id;
                return (
                  <button key={p.id} onClick={() => setPeriod(p.id)}
                    className={`rounded-lg border p-4 text-left transition-all ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-primary/40"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{p.label}</span>
                      {active && <Badge>Selected</Badge>}
                    </div>
                    <p className="mt-1 text-2xl font-bold">{inr(t)}</p>
                    <p className="text-xs text-muted-foreground">{p.note} · incl. {gstPct}% GST</p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <Row label={`Subscription (${seats} × ${inr(perUser)} × ${months} mo)`} value={inr(base)} />
              <Row label={`GST (${gstPct}%)`} value={inr(gst)} muted />
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>You pay</span><span>{inr(total)}</span></div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button onClick={paySubscription} disabled={paying} className="w-full sm:w-auto">
                {paying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening payment…</> : <>Pay {inr(total)} · {PLANS.find((p) => p.id === period)!.label}</>}
              </Button>
              <button type="button" onClick={() => setShowManualPay((v) => !v)}
                className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline">
                Card or UPI not working? Pay by bank transfer / UPI instead
              </button>
            </div>

            {showManualPay && <ManualPaymentDetails amount={total} purpose="subscription payment" />}
          </CardContent>
        </Card>

        {/* Wallet */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Wallet (calls & WhatsApp)</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Balance <span className="text-lg font-semibold text-foreground">{inr(balance)}</span>
              <p className="mt-1 text-xs">AI calls deduct ₹3/min; WhatsApp messages deduct ₹0.20 (utility) or ₹1 (marketing) each. Calls & messages pause once the balance reaches the ₹500 reserve. Minimum recharge ₹5,000.</p>
            </div>
            <Button variant="outline" onClick={() => setTopUpOpen(true)} className="gap-2"><IndianRupee className="h-4 w-4" /> Add funds</Button>
          </CardContent>
        </Card>

        {/* Detail tabs */}
        <Tabs defaultValue="usage">
          <TabsList>
            <TabsTrigger value="usage" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Usage</TabsTrigger>
            <TabsTrigger value="transactions" className="gap-1.5"><Receipt className="h-4 w-4" /> Transactions</TabsTrigger>
            <TabsTrigger value="invoices" className="gap-1.5"><FileText className="h-4 w-4" /> Invoices</TabsTrigger>
          </TabsList>

          <TabsContent value="usage">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>This month</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell>AI calls (minutes)</TableCell><TableCell className="text-right">{usageSummary.call.count}</TableCell><TableCell className="text-right">{inr(usageSummary.call.cost)}</TableCell></TableRow>
                  <TableRow><TableCell>WhatsApp messages</TableCell><TableCell className="text-right">{usageSummary.whatsapp.count}</TableCell><TableCell className="text-right">{inr(usageSummary.whatsapp.cost)}</TableCell></TableRow>
                  <TableRow className="border-t-2"><TableCell className="font-semibold">Total spent</TableCell><TableCell /><TableCell className="text-right font-semibold">{inr(usageSummary.call.cost + usageSummary.whatsapp.cost)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="transactions">
            <Card><CardContent className="p-0">
              {(txns || []).length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(txns || []).map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">{format(new Date(t.created_at), "d MMM, HH:mm")}</TableCell>
                        <TableCell className="text-xs">{Number(t.amount) >= 0 ? <Badge className="bg-emerald-100 text-emerald-700">Credit</Badge> : <Badge variant="secondary">Debit</Badge>}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">{t.description}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${Number(t.amount) >= 0 ? "text-emerald-600" : ""}`}>{Number(t.amount) >= 0 ? "+" : ""}{inr(Number(t.amount))}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{inr(Number(t.balance_after))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card><CardContent className="p-0">
              {(invoices || []).length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No invoices yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(invoices || []).map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell className="text-xs">{inv.created_at ? format(new Date(inv.created_at), "d MMM yyyy") : "—"}</TableCell>
                        <TableCell className="text-right">{inr(Number(inv.total_amount ?? inv.amount ?? inv.total ?? 0))}</TableCell>
                        <TableCell><Badge variant={(inv.payment_status ?? inv.status) === "paid" ? "default" : "secondary"} className="capitalize">{inv.payment_status ?? inv.status ?? "—"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <TopUpWalletDialog open={topUpOpen} onOpenChange={setTopUpOpen} orgId={effectiveOrgId || ""} />
    </DashboardLayout>
  );
}

const TONES: Record<string, string> = {
  blue: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
  emerald: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
  violet: "text-violet-600 bg-violet-100 dark:bg-violet-900/30",
};
function SnapCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; tone: string }) {
  return (
    <Card><CardContent className="flex items-start gap-3 p-4">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONES[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-amber-600">{hint}</p>}
      </div>
    </CardContent></Card>
  );
}
function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}><span>{label}</span><span>{value}</span></div>;
}
