import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Link to the Android app on this site (public/downloads). */
export const PHONE_APP_DOWNLOAD_URL = "/downloads/insync-phone.apk";

export interface PhoneAppStatus {
  enabled: boolean;
  installed?: boolean;
  device_name?: string | null;
  last_sync_at?: string | null;
  connected?: boolean;
}

/**
 * The In-Sync Phone app (Android): is it switched on for my organisation, and is my phone connected?
 * Organisations without organizations.settings.phone_app.enabled get { enabled: false } and see no change.
 */
export function usePhoneAppStatus() {
  return useQuery({
    queryKey: ["my-phone-app-status"],
    queryFn: async (): Promise<PhoneAppStatus> => {
      const { data, error } = await supabase.rpc("my_phone_app_status" as never);
      if (error) return { enabled: false };
      return (data ?? { enabled: false }) as PhoneAppStatus;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export interface TeamPhone {
  user_id: string;
  device_name: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
  connected: boolean;
  call_log_allowed: boolean;
}

/** Managers: each caller's phone and when it last checked in. */
export function useTeamPhones(enabled: boolean) {
  return useQuery({
    queryKey: ["phone-app-team-status"],
    queryFn: async (): Promise<TeamPhone[]> => {
      const { data, error } = await supabase.rpc("phone_app_team_status" as never);
      if (error) throw error;
      return (data ?? []) as TeamPhone[];
    },
    enabled,
    refetchInterval: 60_000,
  });
}
