import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export const GAMING_ORG_ID = "f07a3fa9-3a30-43bb-af2a-4c35bda2fce8";

/** Daily targets shown on the caller dashboard. */
export const DAILY_TARGETS = { calls: 100, clean: 35, registrations: 8, activations: 4 };


export interface DayStat {
  agent_id: string;
  day: string;
  login_at: string | null;
  logout_at: string | null;
  work_secs: number;
  idle_secs: number;
  calls: number;
  new_dials: number;
  connected_calls: number;
  clean_calls: number;
  registrations: number;
  activations: number;
  talk_secs: number;
}

export interface HourlyRow {
  day: string;
  hour: number;
  calls: number;
  new_dials: number;
  connected_calls: number;
  clean_calls: number;
}

export interface DispoCount {
  agent_id: string;
  disposition_id: string | null;
  sub_disposition_id: string | null;
  calls: number;
}

export interface Totals {
  work_secs: number;
  idle_secs: number;
  calls: number;
  new_dials: number;
  connected_calls: number;
  clean_calls: number;
  registrations: number;
  activations: number;
}

export const sumStats = (rows: DayStat[]): Totals =>
  rows.reduce<Totals>(
    (t, r) => ({
      work_secs: t.work_secs + r.work_secs,
      idle_secs: t.idle_secs + r.idle_secs,
      calls: t.calls + r.calls,
      new_dials: t.new_dials + r.new_dials,
      connected_calls: t.connected_calls + r.connected_calls,
      clean_calls: t.clean_calls + r.clean_calls,
      registrations: t.registrations + r.registrations,
      activations: t.activations + r.activations,
    }),
    { work_secs: 0, idle_secs: 0, calls: 0, new_dials: 0, connected_calls: 0, clean_calls: 0, registrations: 0, activations: 0 },
  );

export const pct = (num: number, den: number) => (den > 0 ? Math.round((100 * num) / den) : 0);

export function fmtHM(secs: number): string {
  const m = Math.round(secs / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

export function useDayStats(orgId: string, from: string, to: string, agentId?: string | null) {
  return useQuery({
    queryKey: ["gaming-day-stats", orgId, from, to, agentId ?? "all"],
    queryFn: async (): Promise<DayStat[]> => {
      const { data, error } = await supabase.rpc("gaming_caller_day_stats" as never, {
        _org: orgId, _from: from, _to: to, _agent: agentId ?? null,
      } as never);
      if (error) throw error;
      return (data ?? []) as DayStat[];
    },
    enabled: !!orgId && !!from && !!to,
  });
}

export function useHourlyCounts(orgId: string, from: string, to: string, agentId?: string | null) {
  return useQuery({
    queryKey: ["gaming-hourly-counts", orgId, from, to, agentId ?? "all"],
    queryFn: async (): Promise<HourlyRow[]> => {
      const { data, error } = await supabase.rpc("gaming_hourly_counts" as never, {
        _org: orgId, _from: from, _to: to, _agent: agentId ?? null,
      } as never);
      if (error) throw error;
      return (data ?? []) as HourlyRow[];
    },
    enabled: !!orgId && !!from && !!to,
  });
}

export function useDispoCounts(orgId: string, from: string, to: string, agentId?: string | null) {
  return useQuery({
    queryKey: ["gaming-dispo-counts", orgId, from, to, agentId ?? "all"],
    queryFn: async (): Promise<DispoCount[]> => {
      const { data, error } = await supabase.rpc("gaming_disposition_counts" as never, {
        _org: orgId, _from: from, _to: to, _agent: agentId ?? null,
      } as never);
      if (error) throw error;
      return (data ?? []) as DispoCount[];
    },
    enabled: !!orgId && !!from && !!to,
  });
}

export interface Dispo { id: string; name: string; category: string | null; description: string | null }
export interface SubDispo { id: string; name: string; disposition_id: string }

/** The org's disposition list, in the order the workflow reads (conversion outcomes first). */
const DISPO_ORDER = ["Registered", "Activated", "Interested", "Callback Requested", "Already Registered", "Not Interested", "Not Connected", "Wrong Number", "Language Barrier", "Do Not Call"];

export function useDispositionCatalog(orgId: string) {
  return useQuery({
    queryKey: ["gaming-dispo-catalog", orgId],
    queryFn: async () => {
      const [d, s] = await Promise.all([
        supabase.from("call_dispositions").select("id, name, category, description").eq("org_id", orgId).eq("is_active", true),
        supabase.from("call_sub_dispositions").select("id, name, disposition_id").eq("org_id", orgId).eq("is_active", true),
      ]);
      const dispositions = ((d.data ?? []) as Dispo[]).sort((a, b) => DISPO_ORDER.indexOf(a.name) - DISPO_ORDER.indexOf(b.name));
      return { dispositions, subs: (s.data ?? []) as SubDispo[] };
    },
    enabled: !!orgId,
  });
}

export interface Caller { id: string; name: string }

export function useCallers(orgId: string) {
  return useQuery({
    queryKey: ["gaming-callers", orgId],
    queryFn: async (): Promise<Caller[]> => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("org_id", orgId).eq("role", "sales_agent").eq("is_active", true);
      const ids = (roles ?? []).map((r) => r.user_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id, first_name, last_name").in("id", ids).order("first_name");
      return (data ?? []).map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" ") }));
    },
    enabled: !!orgId,
  });
}

/** Most recent day that has call data, so the dashboards open on a day with something to show. */
export function useLatestCallDay(orgId: string, agentId?: string | null) {
  return useQuery({
    queryKey: ["gaming-latest-day", orgId, agentId ?? "all"],
    queryFn: async (): Promise<string | null> => {
      let q = supabase.from("call_logs").select("started_at").eq("org_id", orgId).eq("caller_type", "human").order("started_at", { ascending: false }).limit(1);
      if (agentId) q = q.eq("agent_id", agentId);
      const { data } = await q;
      const at = data?.[0]?.started_at;
      return at ? new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null;
    },
    enabled: !!orgId,
  });
}
