import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Phone, PhoneCall, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/common/LoadingState";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { DAILY_TARGETS, fmtClock, fmtHM, sumOutcomes, useCallers, useDayOutcomes, useHourlyCounts } from "./gamingStats";
import { PeriodSwitch, StatCard, VolumeCard, connectRate, usePeriod } from "./simpleDashboard";

/** Ajimos caller: their own figures, the day's target, callbacks and one chart. */
export function GamingCallerDashboard({ orgId }: { orgId: string }) {
  const { canAccessFeature } = useFeatureAccess();
  const showAttendance = canAccessFeature("attendance");
  const { period, setPeriod, from, to, prevFrom, prevTo, versus } = usePeriod();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const { data: callers = [] } = useCallers(orgId);
  const me = callers.find((c) => c.id === userId);
  const now = useDayOutcomes(orgId, from, to);
  const before = useDayOutcomes(orgId, prevFrom, prevTo);
  const hourly = useHourlyCounts(orgId, from, to, userId ?? "00000000-0000-0000-0000-000000000000");
  const mine = (now.data ?? []).filter((r) => r.agent_id === userId);
  const t = sumOutcomes(mine);
  const p = before.data ? sumOutcomes(before.data.filter((r) => r.agent_id === userId)) : undefined;

  const attendance = useQuery({
    queryKey: ["gaming-my-attendance", userId, to],
    queryFn: async () => {
      const { data } = await supabase.from("attendance_records").select("sign_in_time, sign_out_time, total_hours").eq("user_id", userId!).eq("date", to).maybeSingle();
      return data;
    },
    enabled: !!userId && showAttendance,
  });

  const callbacks = useQuery({
    queryKey: ["gaming-my-callbacks", userId],
    queryFn: async () => {
      const { data } = await supabase.from("contact_activities")
        .select("id, contact_id, subject, scheduled_at")
        .eq("org_id", orgId).eq("created_by", userId!).eq("activity_type", "call").is("completed_at", null)
        .order("scheduled_at", { ascending: true }).limit(8);
      return data ?? [];
    },
    enabled: !!userId,
  });

  if (!userId) return <LoadingState message="Loading your dashboard..." />;
  const left = DAILY_TARGETS.calls - t.total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Hello{me ? `, ${me.name.split(" ")[0]}` : ""}</h1>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Calls" value={t.total} prev={p?.total} versus={versus} icon={Phone}
          hint={period === "today" ? (left > 0 ? `Target ${DAILY_TARGETS.calls}: ${left} to go` : `Target ${DAILY_TARGETS.calls} met`) : undefined} />
        <StatCard label="Connected" value={t.connected} prev={p?.connected} versus={versus} icon={PhoneCall} hint={`${connectRate(t.connected, t.total)} of calls`} />
        <StatCard label="Registered" value={t.registered} prev={p?.registered} versus={versus} icon={UserCheck} />
        <StatCard label="Activated" value={t.activated} prev={p?.activated} versus={versus} icon={BadgeCheck} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {showAttendance && (
          <Card className="rounded-xl p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">Your hours today</h2>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
              <div><p className="text-xs text-muted-foreground">Start</p><p className="font-medium tabular-nums">{fmtClock(attendance.data?.sign_in_time ?? null)}</p></div>
              <div><p className="text-xs text-muted-foreground">End</p><p className="font-medium tabular-nums">{fmtClock(attendance.data?.sign_out_time ?? null)}</p></div>
              <div><p className="text-xs text-muted-foreground">Hours</p><p className="font-medium tabular-nums">{attendance.data?.total_hours ? fmtHM(attendance.data.total_hours * 3600) : "—"}</p></div>
              <Link to="/attendance" className="ml-auto self-end text-sm text-primary underline">My attendance</Link>
            </div>
          </Card>
        )}
        <Card className="rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Callbacks waiting for you</h2>
          {(callbacks.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No callbacks scheduled.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(callbacks.data ?? []).map((cb) => (
                <li key={cb.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/contacts/${cb.contact_id}`} className="flex items-center gap-2 text-foreground hover:underline"><Phone size={14} className="text-muted-foreground" />{(cb.subject ?? "").replace("Callback — ", "")}</Link>
                  <span className="tabular-nums text-muted-foreground">{cb.scheduled_at ? new Date(cb.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <VolumeCard period={period} from={from} to={to} hourly={hourly.data ?? []} days={mine} />

      <Link to="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">View your reports <ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}
