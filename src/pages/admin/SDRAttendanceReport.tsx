import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, addMonths, subMonths, eachDayOfInterval, getDay, isAfter, isSameDay, parseISO } from "date-fns";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Download, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUrlState } from "@/hooks/useUrlState";

type Profile = { id: string; first_name: string | null; last_name: string | null; email: string | null; designation_id: string | null };
type Designation = { id: string; name: string };
type AttendanceRow = { id: string; user_id: string; date: string; status: string; sign_in_time: string | null; sign_out_time: string | null; total_hours: number | null };
type LeaveRow = { id: string; user_id: string; start_date: string; end_date: string; leave_type: string; status: string };
type Holiday = { holiday_date: string; holiday_name: string };

const LEAVE_LABELS: Record<string, string> = {
  sick_leave: "Sick",
  casual_leave: "Casual",
  earned_leave: "Earned",
  unpaid_leave: "Unpaid",
  compensatory_off: "Comp Off",
  maternity_leave: "Maternity",
  paternity_leave: "Paternity",
};

// Saturday rule: 2nd & 4th Saturdays are off; 1st, 3rd, 5th are working
function isSecondOrFourthSaturday(d: Date): boolean {
  if (getDay(d) !== 6) return false;
  const week = Math.ceil(d.getDate() / 7);
  return week === 2 || week === 4;
}

type DayKind = "working" | "weekly_off" | "holiday";

function classifyDay(d: Date, holidaySet: Set<string>): { kind: DayKind; label?: string } {
  const iso = format(d, "yyyy-MM-dd");
  if (holidaySet.has(iso)) return { kind: "holiday" };
  const dow = getDay(d);
  if (dow === 0) return { kind: "weekly_off", label: "Sun" };
  if (dow === 6 && isSecondOrFourthSaturday(d)) return { kind: "weekly_off", label: "Sat Off" };
  return { kind: "working" };
}

function nameOf(p: Profile): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unknown";
}

function fmtTimeISO(t: string | null): string {
  if (!t) return "";
  return new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function SDRAttendanceReport() {
  const { effectiveOrgId } = useOrgContext();
  const [monthKey, setMonthKey] = useUrlState("month", format(startOfMonth(new Date()), "yyyy-MM"));
  const monthStart = useMemo(() => {
    const [y, m] = monthKey.split("-").map(Number);
    return y && m ? new Date(y, m - 1, 1) : startOfMonth(new Date());
  }, [monthKey]);
  const setMonthStart = (d: Date) => setMonthKey(format(startOfMonth(d), "yyyy-MM"));
  const [designationFilter, setDesignationFilter] = useUrlState<string>("desig", "SDR");

  const monthEnd = endOfMonth(monthStart);
  const monthLabel = format(monthStart, "MMMM yyyy");
  const startStr = format(monthStart, "yyyy-MM-dd");
  const endStr = format(monthEnd, "yyyy-MM-dd");
  const today = new Date();

  const { data: designations = [] } = useQuery({
    queryKey: ["designations-list", effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designations")
        .select("id, name")
        .eq("org_id", effectiveOrgId!)
        .order("name");
      if (error) throw error;
      return data as Designation[];
    },
    enabled: !!effectiveOrgId,
  });

  const { data: profiles = [], isLoading: profilesLoading } = useQuery({
    queryKey: ["sdr-profiles", effectiveOrgId, designationFilter],
    queryFn: async () => {
      // Only expect attendance from people who are active members of THIS org.
      // Org membership lives in user_roles; relying on profiles.is_active alone
      // lets a removed user reappear if the two flags ever drift out of sync.
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("org_id", effectiveOrgId!)
        .eq("is_active", true);
      if (rolesError) throw rolesError;
      const activeMemberIds = (roles ?? []).map((r) => r.user_id);
      if (activeMemberIds.length === 0) return [];

      let query = supabase
        .from("profiles")
        .select("id, first_name, last_name, email, designation_id")
        .eq("org_id", effectiveOrgId!)
        .eq("is_active", true)
        .in("id", activeMemberIds);
      if (designationFilter !== "ALL") {
        const desig = designations.find((d) => d.name === designationFilter);
        if (desig) query = query.eq("designation_id", desig.id);
        else return [];
      }
      const { data, error } = await query.order("first_name");
      if (error) throw error;
      return data as Profile[];
    },
    enabled: !!effectiveOrgId && (designationFilter === "ALL" || designations.length > 0),
  });

  const userIds = useMemo(() => profiles.map((p) => p.id), [profiles]);

  const { data: attendance = [] } = useQuery({
    queryKey: ["attendance-rows", effectiveOrgId, startStr, endStr, userIds.join(",")],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, user_id, date, status, sign_in_time, sign_out_time, total_hours")
        .eq("org_id", effectiveOrgId!)
        .in("user_id", userIds)
        .gte("date", startStr)
        .lte("date", endStr);
      if (error) throw error;
      return data as AttendanceRow[];
    },
    enabled: !!effectiveOrgId && userIds.length > 0,
  });

  const { data: leaves = [] } = useQuery({
    queryKey: ["approved-leaves", effectiveOrgId, startStr, endStr, userIds.join(",")],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from("leave_applications")
        .select("id, user_id, start_date, end_date, leave_type, status")
        .eq("org_id", effectiveOrgId!)
        .in("user_id", userIds)
        .eq("status", "approved")
        .lte("start_date", endStr)
        .gte("end_date", startStr);
      if (error) throw error;
      return data as LeaveRow[];
    },
    enabled: !!effectiveOrgId && userIds.length > 0,
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ["company-holidays", effectiveOrgId, monthStart.getFullYear()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_holidays")
        .select("holiday_date, holiday_name")
        .eq("org_id", effectiveOrgId!)
        .eq("year", monthStart.getFullYear());
      if (error) throw error;
      return data as Holiday[];
    },
    enabled: !!effectiveOrgId,
  });

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.holiday_date)), [holidays]);
  const holidayName = (iso: string) => holidays.find((h) => h.holiday_date === iso)?.holiday_name || "Holiday";

  const days = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd]);

  // Build a lookup: (user_id -> date -> attendance row)
  const attendanceMap = useMemo(() => {
    const m = new Map<string, Map<string, AttendanceRow>>();
    attendance.forEach((r) => {
      if (!m.has(r.user_id)) m.set(r.user_id, new Map());
      m.get(r.user_id)!.set(r.date, r);
    });
    return m;
  }, [attendance]);

  // Build leave lookup: (user_id -> date(iso) -> leaveType)
  const leaveMap = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    leaves.forEach((l) => {
      const start = parseISO(l.start_date);
      const end = parseISO(l.end_date);
      eachDayOfInterval({ start, end }).forEach((d) => {
        const iso = format(d, "yyyy-MM-dd");
        if (!m.has(l.user_id)) m.set(l.user_id, new Map());
        m.get(l.user_id)!.set(iso, l.leave_type);
      });
    });
    return m;
  }, [leaves]);

  type CellStatus = "present" | "half_day" | "leave" | "absent" | "weekly_off" | "holiday" | "future" | "not_started";

  function cellStatus(userId: string, d: Date, joiningDate: Date | null): { status: CellStatus; detail?: string; row?: AttendanceRow } {
    const iso = format(d, "yyyy-MM-dd");
    const dayInfo = classifyDay(d, holidaySet);
    if (dayInfo.kind === "holiday") return { status: "holiday", detail: holidayName(iso) };
    if (dayInfo.kind === "weekly_off") return { status: "weekly_off", detail: dayInfo.label };
    // Working day
    if (joiningDate && isAfter(joiningDate, d)) return { status: "not_started" };
    if (isAfter(d, today) && !isSameDay(d, today)) return { status: "future" };
    const leaveType = leaveMap.get(userId)?.get(iso);
    if (leaveType) return { status: "leave", detail: LEAVE_LABELS[leaveType] || leaveType };
    const ar = attendanceMap.get(userId)?.get(iso);
    if (ar) {
      if (ar.status === "present") return { status: "present", row: ar };
      if (ar.status === "half_day") return { status: "half_day", row: ar };
    }
    return { status: "absent" };
  }

  // For each user, joining date = earliest attendance record overall (good enough proxy)
  // Pull each user's first attendance record once
  const { data: firstAttendance = {} } = useQuery({
    queryKey: ["first-attendance", effectiveOrgId, userIds.join(",")],
    queryFn: async () => {
      if (!userIds.length) return {};
      const { data, error } = await supabase
        .from("attendance_records")
        .select("user_id, date")
        .eq("org_id", effectiveOrgId!)
        .in("user_id", userIds)
        .order("date", { ascending: true });
      if (error) throw error;
      const out: Record<string, string> = {};
      (data as { user_id: string; date: string }[]).forEach((r) => {
        if (!out[r.user_id]) out[r.user_id] = r.date;
      });
      return out;
    },
    enabled: !!effectiveOrgId && userIds.length > 0,
  });

  // Per-user summary
  const summary = profiles.map((p) => {
    const joiningISO = firstAttendance[p.id];
    const joining = joiningISO ? parseISO(joiningISO) : null;
    let present = 0, halfDay = 0, leave = 0, absent = 0, working = 0, hours = 0;
    days.forEach((d) => {
      const c = cellStatus(p.id, d, joining);
      if (c.status === "weekly_off" || c.status === "holiday" || c.status === "future" || c.status === "not_started") return;
      working += 1;
      if (c.status === "present") { present += 1; hours += Number(c.row?.total_hours || 0); }
      else if (c.status === "half_day") { halfDay += 1; hours += Number(c.row?.total_hours || 0); }
      else if (c.status === "leave") leave += 1;
      else absent += 1;
    });
    return { profile: p, present, halfDay, leave, absent, working, hours };
  });

  function downloadCSV() {
    const header = ["Employee", "Email", "Date", "Day", "Day Type", "Status", "Detail", "Sign In (IST)", "Sign Out (IST)", "Hours"];
    const rows: string[][] = [header];
    profiles.forEach((p) => {
      const joining = firstAttendance[p.id] ? parseISO(firstAttendance[p.id]) : null;
      days.forEach((d) => {
        const c = cellStatus(p.id, d, joining);
        const dayInfo = classifyDay(d, holidaySet);
        const dayType = dayInfo.kind === "holiday" ? "Holiday" : dayInfo.kind === "weekly_off" ? "Weekly Off" : "Working";
        rows.push([
          nameOf(p),
          p.email || "",
          format(d, "yyyy-MM-dd"),
          format(d, "EEEE"),
          dayType,
          c.status.toUpperCase(),
          c.detail || "",
          fmtTimeISO(c.row?.sign_in_time || null),
          fmtTimeISO(c.row?.sign_out_time || null),
          c.row?.total_hours ? Number(c.row.total_hours).toFixed(2) : "",
        ]);
      });
      rows.push([nameOf(p), p.email || "", "TOTAL", "", "", "", "", "", "", ""]);
      const s = summary.find((x) => x.profile.id === p.id)!;
      rows.push([`  Working Days`, `${s.working}`, `Present`, `${s.present}`, `Half Day`, `${s.halfDay}`, `Leave`, `${s.leave}`, `Absent`, `${s.absent}`]);
      rows.push([`  Hours Logged`, `${s.hours.toFixed(2)}`, "", "", "", "", "", "", "", ""]);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Attendance_${designationFilter}_${format(monthStart, "yyyy-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cellColor: Record<CellStatus, string> = {
    present: "bg-green-100 text-green-900 border-green-300",
    half_day: "bg-yellow-100 text-yellow-900 border-yellow-300",
    leave: "bg-blue-100 text-blue-900 border-blue-300",
    absent: "bg-red-100 text-red-900 border-red-300",
    weekly_off: "bg-gray-100 text-gray-500 border-gray-200",
    holiday: "bg-purple-100 text-purple-900 border-purple-300",
    future: "bg-white text-gray-300 border-gray-100",
    not_started: "bg-white text-gray-300 border-gray-100",
  };

  const cellChar: Record<CellStatus, string> = {
    present: "P",
    half_day: "H",
    leave: "L",
    absent: "A",
    weekly_off: "—",
    holiday: "★",
    future: "·",
    not_started: "·",
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">SDR Attendance Report</h1>
            <p className="text-muted-foreground">Monthly attendance, approved leaves & working-day breakdown</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setMonthStart(subMonths(monthStart, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="font-semibold text-lg min-w-[10rem] text-center">{monthLabel}</div>
            <Button variant="outline" size="icon" onClick={() => setMonthStart(addMonths(monthStart, 1))} disabled={isAfter(addMonths(monthStart, 1), startOfMonth(today))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Select value={designationFilter} onValueChange={setDesignationFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Designations</SelectItem>
                {designations.map((d) => (
                  <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={downloadCSV} disabled={!profiles.length}>
              <Download className="h-4 w-4 mr-2" /> Download CSV
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Employees</CardDescription>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Users className="h-5 w-5" /> {profiles.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Present-Days</CardDescription>
              <CardTitle className="text-2xl text-green-700">{summary.reduce((a, s) => a + s.present, 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Approved Leave-Days</CardDescription>
              <CardTitle className="text-2xl text-blue-700">{summary.reduce((a, s) => a + s.leave, 0)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Absent-Days</CardDescription>
              <CardTitle className="text-2xl text-red-700">{summary.reduce((a, s) => a + s.absent, 0)}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {(["present", "half_day", "leave", "absent", "weekly_off", "holiday"] as CellStatus[]).map((k) => (
            <div key={k} className="flex items-center gap-1">
              <span className={`inline-flex items-center justify-center w-6 h-6 border rounded text-[10px] font-bold ${cellColor[k]}`}>{cellChar[k]}</span>
              <span className="capitalize">{k.replace("_", " ")}</span>
            </div>
          ))}
        </div>

        {/* Per-employee grid */}
        {profilesLoading ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Loading…</CardContent></Card>
        ) : !profiles.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No employees match this filter.</CardContent></Card>
        ) : (
          <TooltipProvider delayDuration={150}>
            <Card>
              <CardContent className="p-4 overflow-x-auto">
                <table className="text-xs border-collapse min-w-full">
                  <thead>
                    <tr>
                      <th className="text-left px-2 py-2 sticky left-0 bg-card z-10 min-w-[160px]">Employee</th>
                      {days.map((d) => {
                        const di = classifyDay(d, holidaySet);
                        const isWeekly = di.kind === "weekly_off";
                        const isHol = di.kind === "holiday";
                        return (
                          <th key={d.toISOString()} className={`px-1 py-1 text-center font-medium ${isWeekly ? "text-gray-400" : isHol ? "text-purple-600" : ""}`}>
                            <div>{format(d, "d")}</div>
                            <div className="text-[9px] font-normal">{format(d, "EEEEE")}</div>
                          </th>
                        );
                      })}
                      <th className="px-2 py-1 text-center bg-muted">P</th>
                      <th className="px-2 py-1 text-center bg-muted">L</th>
                      <th className="px-2 py-1 text-center bg-muted">A</th>
                      <th className="px-2 py-1 text-center bg-muted">Hrs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s) => {
                      const joining = firstAttendance[s.profile.id] ? parseISO(firstAttendance[s.profile.id]) : null;
                      return (
                        <tr key={s.profile.id} className="border-t hover:bg-muted/30">
                          <td className="px-2 py-1 sticky left-0 bg-card z-10 font-medium whitespace-nowrap">
                            {nameOf(s.profile)}
                            <div className="text-[10px] text-muted-foreground">{s.profile.email}</div>
                          </td>
                          {days.map((d) => {
                            const c = cellStatus(s.profile.id, d, joining);
                            const tooltipText = (() => {
                              const ds = format(d, "EEE, MMM d");
                              if (c.status === "present") return `${ds}: Present  In ${fmtTimeISO(c.row?.sign_in_time || null)}  Out ${fmtTimeISO(c.row?.sign_out_time || null) || "—"}  ${c.row?.total_hours ? Number(c.row.total_hours).toFixed(2) + "h" : ""}`;
                              if (c.status === "half_day") return `${ds}: Half Day`;
                              if (c.status === "leave") return `${ds}: Leave (${c.detail})`;
                              if (c.status === "absent") return `${ds}: Absent`;
                              if (c.status === "holiday") return `${ds}: ${c.detail}`;
                              if (c.status === "weekly_off") return `${ds}: Weekly Off`;
                              if (c.status === "not_started") return `${ds}: Before joining`;
                              return `${ds}`;
                            })();
                            return (
                              <td key={d.toISOString()} className="px-0.5 py-0.5 text-center">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className={`inline-flex items-center justify-center w-6 h-6 border rounded text-[10px] font-bold cursor-default ${cellColor[c.status]}`}>
                                      {cellChar[c.status]}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>{tooltipText}</TooltipContent>
                                </Tooltip>
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-center font-semibold text-green-700">{s.present}</td>
                          <td className="px-2 py-1 text-center font-semibold text-blue-700">{s.leave}</td>
                          <td className="px-2 py-1 text-center font-semibold text-red-700">{s.absent}</td>
                          <td className="px-2 py-1 text-center font-semibold">{s.hours.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TooltipProvider>
        )}

        {/* Approved leaves detail */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Approved Leaves This Month</CardTitle>
            <CardDescription>From the leave_applications table — status = approved</CardDescription>
          </CardHeader>
          <CardContent>
            {!leaves.length ? (
              <p className="text-sm text-muted-foreground">No approved leaves in this period.</p>
            ) : (
              <div className="space-y-2">
                {leaves.map((l) => {
                  const p = profiles.find((x) => x.id === l.user_id);
                  return (
                    <div key={l.id} className="flex items-center justify-between text-sm border rounded p-2">
                      <div>
                        <span className="font-semibold">{p ? nameOf(p) : l.user_id}</span>
                        <span className="text-muted-foreground"> · {format(parseISO(l.start_date), "MMM d")} – {format(parseISO(l.end_date), "MMM d, yyyy")}</span>
                      </div>
                      <Badge variant="secondary">{LEAVE_LABELS[l.leave_type] || l.leave_type}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
