import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, IndianRupee, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";

const PRESET_AMOUNTS = [500, 1000, 2000, 5000];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  /** Minimum top-up amount in rupees (excluding GST). Default ₹500. */
  minAmount?: number;
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

let scriptLoadingPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;
  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoadingPromise = null;
      reject(new Error("Failed to load Razorpay script"));
    };
    document.body.appendChild(s);
  });
  return scriptLoadingPromise;
}

export function TopUpWalletDialog({ open, onOpenChange, orgId, minAmount = 500 }: Props) {
  const notify = useNotification();
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(PRESET_AMOUNTS[1]);
  const [submitting, setSubmitting] = useState(false);

  // Active pricing for GST display
  const { data: pricing } = useQuery({
    queryKey: ["subscription-pricing-active"],
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

  // Current user (for Razorpay prefill)
  const { data: profile } = useQuery({
    queryKey: ["topup-profile", orgId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("id", user.id)
        .maybeSingle();
      return { email: user.email, ...(data || {}) };
    },
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      loadRazorpayScript().catch(() => undefined);
    }
  }, [open]);

  const gstPct = Number(pricing?.gst_percentage ?? 18);
  const gst = +(amount * (gstPct / 100)).toFixed(2);
  const total = +(amount + gst).toFixed(2);

  async function handleSubmit() {
    if (amount < minAmount) {
      notify.error("Amount too low", `Minimum top-up is ₹${minAmount}.`);
      return;
    }
    setSubmitting(true);
    try {
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay failed to load");

      const { data: order, error: orderErr } = await supabase.functions.invoke("create-razorpay-order", {
        body: { org_id: orgId, amount, type: "wallet_topup" },
      });
      if (orderErr) throw orderErr;
      if (!order?.order_id) throw new Error("Order creation failed");

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount_in_paise,
        currency: order.currency,
        name: "globalcrm",
        description: "Wallet top-up",
        order_id: order.order_id,
        prefill: {
          name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" "),
          email: profile?.email || "",
          contact: profile?.phone || "",
        },
        notes: { org_id: orgId, type: "wallet_topup" },
        theme: { color: "#2563eb" },
        handler: async (resp: any) => {
          try {
            const { data: verifyData, error: verifyErr } = await supabase.functions.invoke(
              "verify-razorpay-payment",
              {
                body: {
                  razorpay_order_id: resp.razorpay_order_id,
                  razorpay_payment_id: resp.razorpay_payment_id,
                  razorpay_signature: resp.razorpay_signature,
                  payment_transaction_id: order.payment_transaction_id,
                },
              },
            );
            if (verifyErr) throw verifyErr;
            if (verifyData?.error) throw new Error(verifyData.error);
            notify.success("Wallet topped up", `₹${amount.toFixed(2)} added to your wallet.`);
            qc.invalidateQueries({ queryKey: ["iedup-subscription"] });
            qc.invalidateQueries({ queryKey: ["iedup-data-counts"] });
            onOpenChange(false);
          } catch (e: any) {
            notify.error("Payment verification failed", e?.message || "Could not verify payment.");
          }
        },
        modal: {
          ondismiss: () => {
            // User closed Razorpay modal — leave the dialog open so they can retry.
          },
        },
      });
      rzp.on("payment.failed", (resp: any) => {
        notify.error("Payment failed", resp?.error?.description || "Razorpay reported a failure.");
      });
      rzp.open();
    } catch (e: any) {
      notify.error("Could not start payment", e?.message || "Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Top up wallet
          </DialogTitle>
          <DialogDescription>
            AI calls deduct ₹3 per minute; WhatsApp utility messages deduct ₹0.20 each. Choose how much to add.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-4 gap-2">
            {PRESET_AMOUNTS.map((p) => (
              <Button
                key={p}
                variant={amount === p ? "default" : "outline"}
                size="sm"
                onClick={() => setAmount(p)}
              >
                ₹{p}
              </Button>
            ))}
          </div>

          <div>
            <Label htmlFor="topup-amount">Custom amount (₹)</Label>
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="topup-amount"
                type="number"
                min={minAmount}
                step={100}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                className="pl-8"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Minimum ₹{minAmount}.</p>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span>Top-up amount</span>
              <span>₹{amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>GST ({gstPct}%)</span>
              <span>₹{gst.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
              <span>You pay</span>
              <span>₹{total.toFixed(2)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ₹{amount.toFixed(2)} goes to the wallet — GST is paid to the government and is not part of the wallet balance.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || amount < minAmount}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening payment…
              </>
            ) : (
              <>Pay ₹{total.toFixed(2)}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
