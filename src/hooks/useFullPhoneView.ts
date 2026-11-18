import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** True when the signed-in user's organisation shows full phone numbers (organisation setting, off by default). */
export function useFullPhoneViewEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["full-phone-view-enabled"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("full_phone_view_enabled" as never);
      if (error) return false;
      return data === true;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data === true;
}

export interface FullPhones {
  /** contact id -> the contact's own phone */
  contact: Record<string, string>;
  /** contact id -> primary phone from the extra phones list */
  primary: Record<string, string>;
  /** extra phone row id -> full number */
  byPhoneId: Record<string, string>;
}

/**
 * Full phone numbers from the server for the given contacts. The server only returns contacts the user may
 * see (callers: assigned to them; admins and managers: all in the organisation) and logs every view.
 * Returns empty maps when the organisation does not use this.
 */
export function useFullPhones(contactIds: string[]) {
  const enabled = useFullPhoneViewEnabled();
  const key = [...contactIds].sort().join(",");
  const { data } = useQuery({
    queryKey: ["full-phones", key],
    enabled: enabled && contactIds.length > 0,
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
    queryFn: async (): Promise<FullPhones> => {
      const out: FullPhones = { contact: {}, primary: {}, byPhoneId: {} };
      for (let i = 0; i < contactIds.length; i += 200) {
        const { data, error } = await supabase.rpc("view_contact_phones" as never, { _ids: contactIds.slice(i, i + 200) } as never);
        if (error) throw error;
        ((data ?? []) as { contact_id: string; phone: string | null; is_contact_phone: boolean; is_primary: boolean; phone_id: string | null }[]).forEach((r) => {
          if (!r.phone) return;
          if (r.is_contact_phone) out.contact[r.contact_id] = r.phone;
          if (r.phone_id) out.byPhoneId[r.phone_id] = r.phone;
          if (!r.is_contact_phone && r.is_primary) out.primary[r.contact_id] = r.phone;
        });
      }
      return out;
    },
  });
  const empty: FullPhones = { contact: {}, primary: {}, byPhoneId: {} };
  return { enabled, phones: data ?? empty, phoneFor: (id: string) => (data?.primary[id] ?? data?.contact[id]) ?? null };
}
