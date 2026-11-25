import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export const GAMING_ORG_ID = "f07a3fa9-3a30-43bb-af2a-4c35bda2fce8";
/** Ajimos is the GlobalCRM organisation above (the Gaming CRM org); callers dial from their own phones and save outcomes by hand. */
export const AJIMOS_ORG_ID = GAMING_ORG_ID;

/** Daily targets shown on the caller dashboard. */
export const DAILY_TARGETS = { calls: 100 };


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
  /** Calls the In-Sync Phone app reported (answered or not). */
  phone_calls: number;
}

export interface HourlyRow {
  day: string;
  hour: number;
  calls: number;
  new_dials: number;
  connected_calls: number;
  clean_calls: number;
  phone_calls: number;
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
  talk_secs: number;
  phone_calls: number;
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
      talk_secs: t.talk_secs + (r.talk_secs ?? 0),
      phone_calls: t.phone_calls + (r.phone_calls ?? 0),
    }),
    { work_secs: 0, idle_secs: 0, calls: 0, new_dials: 0, connected_calls: 0, clean_calls: 0, registrations: 0, activations: 0, talk_secs: 0, phone_calls: 0 },
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

/** One caller's one day, counted from saved outcomes. */
export interface DayOutcomes {
  agent_id: string;
  day: string;
  total: number;
  connected: number;
  interested: number;
  follow_up: number;
  registered: number;
  activated: number;
  not_interested: number;
}

export function useDayOutcomes(orgId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["gaming-day-outcomes", orgId, from, to],
    queryFn: async (): Promise<DayOutcomes[]> => {
      const { data, error } = await supabase.rpc("gaming_caller_day_outcomes" as never, { _org: orgId, _from: from, _to: to } as never);
      if (error) throw error;
      return (data ?? []) as DayOutcomes[];
    },
    enabled: !!orgId && !!from && !!to,
  });
}

export interface Dispo { id: string; name: string; category: string | null; description: string | null }
export interface SubDispo { id: string; name: string; disposition_id: string }

/** The org's disposition list, in the order the workflow reads (conversion outcomes first). */
const DISPO_ORDER = [
  // Ajimos list (Nov 2026)
  "Interested", "Registration", "Deposit", "Follow-up", "Not Interested", "Unreachable", "Wrong Contact", "Existing Customer", "Technical Issue", "Do Not Contact",
  // Original gaming list
  "Registered", "Activated", "Interested", "Callback Requested", "Already Registered", "Not Interested", "Not Connected", "Wrong Number", "Language Barrier", "Do Not Call"];

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

export interface CallerWithHistory extends Caller { active: boolean }

/** Every caller the organisation has had; people no longer active keep their past calls in the reports. */
export function useCallersWithHistory(orgId: string) {
  return useQuery({
    queryKey: ["gaming-callers-history", orgId],
    queryFn: async (): Promise<CallerWithHistory[]> => {
      const { data: roles } = await supabase.from("user_roles").select("user_id, is_active").eq("org_id", orgId).eq("role", "sales_agent");
      const active = new Map<string, boolean>();
      for (const r of roles ?? []) active.set(r.user_id, (active.get(r.user_id) ?? false) || r.is_active === true);
      if (!active.size) return [];
      const { data } = await supabase.from("profiles").select("id, first_name, last_name").in("id", [...active.keys()]).order("first_name");
      return (data ?? []).map((p) => {
        const on = active.get(p.id) ?? false;
        return { id: p.id, active: on, name: [p.first_name, p.last_name].filter(Boolean).join(" ") + (on ? "" : " (inactive)") };
      });
    },
    enabled: !!orgId,
  });
}

export type OutcomeTotals = Omit<DayOutcomes, "agent_id" | "day">;
export const sumOutcomes = (rows: DayOutcomes[]): OutcomeTotals =>
  rows.reduce<OutcomeTotals>((t, r) => ({
    total: t.total + r.total, connected: t.connected + r.connected, interested: t.interested + r.interested, follow_up: t.follow_up + r.follow_up,
    registered: t.registered + r.registered, activated: t.activated + r.activated, not_interested: t.not_interested + r.not_interested,
  }), { total: 0, connected: 0, interested: 0, follow_up: 0, registered: 0, activated: 0, not_interested: 0 });
