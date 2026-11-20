import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// True when organizations.settings.billing.mode = 'monthly_postpaid': the org's
// AI usage is billed monthly, so there is no prepaid wallet to show or top up.
export function isBilledMonthlySettings(settings: unknown): boolean {
  return (settings as any)?.billing?.mode === "monthly_postpaid";
}

export function useBilledMonthly(orgId: string | null | undefined) {
  const { data } = useQuery({
    queryKey: ["org-billed-monthly", orgId],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("settings").eq("id", orgId as string).maybeSingle();
      return isBilledMonthlySettings(data?.settings);
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
  return data === true;
}
