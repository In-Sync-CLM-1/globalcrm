import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, IndianRupee, Wallet, ReceiptText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: { id: string; name: string } | null;
  onRecorded?: () => void;
}

type PaymentFor = "wallet" | "subscription";

const METHODS = [
  { value: "bank_transfer", label: "Bank transfer (NEFT/RTGS/IMPS)" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "card_machine", label: "Card machine (POS)" },
  { value: "other", label: "Other" },
];

const BILLING_PERIODS = [
  { value: "quarterly", label: "Quarterly (3 months)" },
  { value: "annual", label: "Annual (12 months)" },
  { value: "monthly", label: "Monthly" },
];

export function RecordOfflinePaymentDialog({ open, onOpenChange, org, onRecorded }: Props) {
  const notify = useNotification();
  const [paymentFor, setPaymentFor] = useState<PaymentFor>("wallet");
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("bank_transfer");
  const [reference, setReference] = useState<string>("");
  const [billingPeriod, setBillingPeriod] = useState<string>("quarterly");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Active GST rate — the entered amount is GST-inclusive; we show how much of it
  // is GST and how much actually lands in the wallet.
  const { data: pricing } = useQuery({
    queryKey: ["offline-pay-pricing"],
    queryFn: async () => {
      const { data } = await supabase
        .from("subscription_pricing")
        .select("gst_percentage")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });
  const gstPct = Number(pricing?.gst_percentage ?? 18);
  const base = amount > 0 ? +(amount / (1 + gstPct / 100)).toFixed(2) : 0;
  const gst = +(amount - base).toFixed(2);
  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Reset the form each time the dialog opens for a fresh org.
  useEffect(() => {
    if (open) {
      setPaymentFor("wallet");
      setAmount(0);
      setMethod("bank_transfer");
      setReference("");
      setBillingPeriod("quarterly");
      setNotes("");
    }
  }, [open]);

  async function handleSubmit() {
    if (!org) return;
    if (!(amount > 0)) {
      notify.error("Amount required", "Enter the amount actually received.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("record-offline-payment", {
        body: {
          org_id: org.id,
          payment_for: paymentFor,
          amount,
          method,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          billing_period: paymentFor === "subscription" ? billingPeriod : undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      notify.success(
        "Payment recorded",
        paymentFor === "wallet"
          ? `${inr(base)} (excl. GST) added to ${org.name}'s wallet.`
          : `${org.name}'s subscription marked paid and reactivated.`
      );
      onRecorded?.();
      onOpenChange(false);
    } catch (e: any) {
      notify.error("Could not record payment", e?.message || "Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-5 w-5" />
            Record offline payment
          </DialogTitle>
          <DialogDescription>
            Log a payment received outside Razorpay (bank transfer, UPI, cheque, cash) for{" "}
            <span className="font-medium text-foreground">{org?.name}</span>. This credits the
            account immediately and restores access if the org was locked. No minimum applies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* What the money is for */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentFor("wallet")}
              className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all ${
                paymentFor === "wallet" ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-primary/40"
              }`}
            >
              <Wallet className="h-4 w-4" />
              <span>
                <span className="font-medium">Wallet top-up</span>
                <span className="block text-xs text-muted-foreground">Calls & WhatsApp credit</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPaymentFor("subscription")}
              className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all ${
                paymentFor === "subscription" ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-primary/40"
              }`}
            >
              <ReceiptText className="h-4 w-4" />
              <span>
                <span className="font-medium">Subscription</span>
                <span className="block text-xs text-muted-foreground">Reactivates the account</span>
              </span>
            </button>
          </div>

          <div>
            <Label htmlFor="offline-amount">Amount received — incl. GST (₹)</Label>
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="offline-amount"
                type="number"
                min={1}
                step={100}
                value={amount || ""}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                className="pl-8"
                placeholder="0"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Enter the total the client actually paid, GST included. No minimum for offline payments.</p>
          </div>

          {amount > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span>Amount received</span>
                <span>{inr(amount)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST ({gstPct}%)</span>
                <span>−{inr(gst)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                <span>{paymentFor === "wallet" ? "Credited to wallet" : "Applied to subscription"}</span>
                <span>{paymentFor === "wallet" ? inr(base) : inr(amount)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {paymentFor === "wallet"
                  ? "GST is paid to the government and is not part of the spendable wallet balance."
                  : "The subscription invoice total already includes GST, so the full amount is applied."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {paymentFor === "subscription" && (
              <div>
                <Label>Billing period</Label>
                <Select value={billingPeriod} onValueChange={setBillingPeriod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BILLING_PERIODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="offline-reference">Reference (UTR / cheque no.)</Label>
            <Input
              id="offline-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UTR123456789 / Cheque 004521"
            />
          </div>

          <div>
            <Label htmlFor="offline-notes">Notes (optional)</Label>
            <Textarea
              id="offline-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth keeping on record"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !(amount > 0)}>
            {submitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording…</>
            ) : (
              <>Record ₹{(amount || 0).toLocaleString("en-IN")}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
