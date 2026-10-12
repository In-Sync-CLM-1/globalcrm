import { useState } from "react";
import { Copy, Check, Mail, MessageCircle, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import upiQr from "@/assets/upi-qr.png";

/**
 * Company collection account shown to customers as a manual fallback when an
 * online (Razorpay) payment cannot be completed — e.g. card declined, UPI
 * timeout, or the gateway blocking the domain. These details are intentionally
 * public: they are the company's receiving account for subscription / wallet
 * payments.
 *
 * Manual payments are NOT auto-reconciled. After paying, the customer sends
 * proof to ops, and a Platform Admin records it via RecordOfflinePaymentDialog
 * (record-offline-payment), which credits the wallet / settles the invoice and
 * lifts any account lock.
 */
const UPI_ID = "7738919680-4@ybl";

const OPS_WHATSAPP = "917738919680";
const OPS_WHATSAPP_DISPLAY = "+91 77389 19680";
const OPS_EMAIL = "a@in-sync.co.in";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

function CopyField({ label, value, display }: { label: string; value: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm font-medium">{display ?? value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

interface Props {
  /** Total amount to pay (GST-inclusive), in rupees. */
  amount: number;
  /** What the payment is for — shown in the share-proof instruction. */
  purpose?: string;
  className?: string;
}

export function ManualPaymentDetails({ amount, purpose = "payment", className }: Props) {
  const waText = encodeURIComponent(
    `Hi, I've made a manual ${purpose} of ${inr(amount)} for my globalcrm account. Sharing the payment proof for activation.`,
  );
  return (
    <div className={cn("rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/20", className)}>
      <div className="flex items-start gap-2">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Pay directly via UPI</p>
          <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-300/80">
            If the online payment won't go through, pay {inr(amount)} using the UPI QR or ID below and send us the receipt — we'll activate your account manually.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center rounded-md border bg-background p-3 text-center">
        <p className="mb-2 text-sm font-medium">Scan to pay by UPI</p>
        <img src={upiQr} alt="UPI QR code" className="h-44 w-44 rounded-md object-contain" />
        <div className="mt-2 w-full max-w-xs text-left">
          <CopyField label="UPI ID" value={UPI_ID} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Google Pay · PhonePe · Paytm · any UPI app</p>
      </div>

      <div className="mt-3 rounded-md border bg-background p-3">
        <p className="text-xs font-medium">After paying, send the payment screenshot / UPI reference so we can activate you:</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`https://wa.me/${OPS_WHATSAPP}?text=${waText}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp {OPS_WHATSAPP_DISPLAY}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`mailto:${OPS_EMAIL}?subject=${encodeURIComponent("Manual payment proof — globalcrm")}`}>
              <Mail className="h-4 w-4 text-blue-600" /> {OPS_EMAIL}
            </a>
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Include your registered email or organisation name. Activation is done manually after we confirm the payment.
        </p>
      </div>
    </div>
  );
}
