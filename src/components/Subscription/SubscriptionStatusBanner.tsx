import { useQuery } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Clock, Lock, Gift } from "lucide-react";

const TRIAL_DAYS = 14;

export default function SubscriptionStatusBanner() {
  const { effectiveOrgId } = useOrgContext();

  const { data: subscription } = useQuery({
    queryKey: ["subscription-status", effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_subscriptions")
        .select("subscription_status, grace_period_end, readonly_period_end, lockout_date, wallet_balance, wallet_minimum_balance")
        .eq("org_id", effectiveOrgId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
    refetchInterval: 60000, // Refetch every minute
  });

  // Trial reminder — informational only, same rule as every org (no lockout
  // when the 14 days run out; the overdue-invoice ladder below is the only
  // thing that ever actually restricts access). Only shown once the trial
  // has actually ended, so it reads as a nudge rather than a daily nag.
  const { data: trialInfo } = useQuery({
    queryKey: ["subscription-trial-check", effectiveOrgId],
    queryFn: async () => {
      const [{ data: org }, { data: paidInvoice }] = await Promise.all([
        supabase.from("organizations").select("created_at").eq("id", effectiveOrgId).maybeSingle(),
        supabase.from("subscription_invoices").select("id").eq("org_id", effectiveOrgId).eq("payment_status", "paid").limit(1).maybeSingle(),
      ]);
      if (!org?.created_at || paidInvoice) return null;
      const trialEndsAt = addDays(new Date(org.created_at), TRIAL_DAYS);
      const daysLeft = differenceInCalendarDays(trialEndsAt, new Date());
      return daysLeft < 0 ? { trialEndsAt } : null;
    },
    enabled: !!effectiveOrgId && subscription?.subscription_status === "active",
  });

  if (!subscription) return null;

  if (subscription.subscription_status === "active") {
    if (!trialInfo) return null;
    return (
      <div className="mx-6 mt-4">
        <Alert>
          <Gift className="h-4 w-4" />
          <AlertTitle>Your free trial ended {format(trialInfo.trialEndsAt, "d MMM yyyy")}</AlertTitle>
          <AlertDescription>
            Everything still works — <Link to="/billing" className="underline underline-offset-2">subscribe on the Billing page</Link> whenever you're ready.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const getAlertConfig = () => {
    switch (subscription.subscription_status) {
      case "suspended_grace":
        return {
          variant: "default" as const,
          icon: Clock,
          title: "Payment Overdue - Grace Period",
          description: `Your payment is overdue. Please make payment before ${subscription.grace_period_end} to avoid service interruption.`,
        };
      case "suspended_readonly":
        return {
          variant: "destructive" as const,
          icon: AlertCircle,
          title: "Services Limited - Payment Required",
          description: `Your account is in read-only mode. Pay now to restore full access before ${subscription.readonly_period_end}.`,
        };
      case "suspended_locked":
        return {
          variant: "destructive" as const,
          icon: Lock,
          title: "Account Locked - Immediate Payment Required",
          description: "Your account is locked due to payment overdue. Make payment immediately to restore access.",
        };
      default:
        return null;
    }
  };

  const alertConfig = getAlertConfig();
  if (!alertConfig) return null;

  const Icon = alertConfig.icon;

  return (
    <div className="mx-6 mt-4">
      <Alert variant={alertConfig.variant}>
        <Icon className="h-4 w-4" />
        <AlertTitle>{alertConfig.title}</AlertTitle>
        <AlertDescription>
          {alertConfig.description}
        </AlertDescription>
      </Alert>
    </div>
  );
}