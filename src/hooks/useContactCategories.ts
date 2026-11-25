import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const NONE: string[] = [];

/**
 * Contact categories offered to an organisation: organizations.settings.contact_categories.options.
 * Organisations without that setting (everyone but RMPL today) get an empty list and see no change.
 */
export function useContactCategories(orgId: string | null | undefined): string[] {
  const { data } = useQuery({
    queryKey: ["contact-categories", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("settings").eq("id", orgId as string).maybeSingle();
      if (error) throw error;
      const options = (data?.settings as any)?.contact_categories?.options;
      return Array.isArray(options) ? (options as string[]) : NONE;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
  return data ?? NONE;
}
