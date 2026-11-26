import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Labels for the industry keys the contact forms save; any other value is shown as typed. */
const INDUSTRY_LABELS: Record<string, string> = {
  manufacturing: "Manufacturing",
  it_software: "IT/Software",
  healthcare: "Healthcare",
  finance_banking: "Finance/Banking",
  retail: "Retail",
  education: "Education",
  real_estate: "Real Estate",
  hospitality: "Hospitality",
  logistics: "Logistics",
  other: "Other",
};

export const industryLabel = (value: string) => INDUSTRY_LABELS[value] ?? value;

export interface PipelineIndustryFilter {
  enabled: boolean;
  options: string[];
}

const OFF: PipelineIndustryFilter = { enabled: false, options: [] };

/**
 * Industry filter on the Pipeline in place of Targeted Product, for organisations with
 * organizations.settings.pipeline_industry_filter = true (Redefine today). Everyone else: off.
 */
export function usePipelineIndustryFilter(orgId: string | null | undefined): PipelineIndustryFilter {
  const { data } = useQuery({
    queryKey: ["pipeline-industry-filter", orgId],
    queryFn: async (): Promise<PipelineIndustryFilter> => {
      const { data: org, error } = await supabase.from("organizations").select("settings").eq("id", orgId as string).maybeSingle();
      if (error) throw error;
      if ((org?.settings as any)?.pipeline_industry_filter !== true) return OFF;
      const { data: rows, error: optErr } = await (supabase as any).rpc("contact_industry_options", { p_org_id: orgId });
      if (optErr) throw optErr;
      const options = ((rows ?? []) as any[]).map((r) => (typeof r === "string" ? r : r?.contact_industry_options)).filter(Boolean);
      return { enabled: true, options };
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
  return data ?? OFF;
}
