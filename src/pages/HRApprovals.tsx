import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle, XCircle, Clock, CalendarDays, FileEdit } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useAttendanceRegularization } from "@/hooks/useAttendanceRegularization";
import { UrlTabs } from "@/components/UrlTabs";

const LEAVE_LABELS: Record<string, string> = {
  sick_leave: "Sick Leave",
  casual_leave: "Casual Leave",
  earned_leave: "Earned Leave",
  unpaid_leave: "Unpaid Leave",
  compensatory_off: "Comp Off",
  maternity_leave: "Maternity Leave",
  paternity_leave: "Paternity Leave",
};

const REG_LABELS: Record<string, string> = {
  forgot_signin: "Forgot Sign In",
  forgot_signout: "Forgot Sign Out",
  time_correction: "Time Correction",
  location_issue: "Location Issue",
  other: "Other",
};

function fmtTime(t: string | null) {
  return t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "N/A";
}

function profileName(p: any) {
  if (!p) return "Unknown";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unknown";
}

export default function HRApprovals() {
  const queryClient = useQueryClient();
  const { effectiveOrgId } = useOrgContext();
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: "leave" | "regularization" } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: user } = useQuery({
    queryKey: ["user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  // pending leaves
  const { data: pendingLeaves, isLoading: leavesLoading } = useQuery({
    queryKey: ["pending-leaves", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("leave_applications")
        .select("*")
        .eq("status", "pending")
        .order("applied_at", { ascending: false });
      if (error) throw error;
      if (!data?.length) return [];
      const userIds = [...new Set(data.map((d: any) => d.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", userIds);
      return data.map((d: any) => ({ ...d, profile: profiles?.find((p) => p.id === d.user_id) }));
    },
    enabled: !!effectiveOrgId,
  });

  const { pendingRegularizations, loadingPending, approveRegularization, rejectRegularization } = useAttendanceRegularization();

  const approveLeave = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("No user");
      const { error } = await supabase
        .from("leave_applications")
        .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["leave-applications"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] });
      toast.success("Leave approved.");
    },
    onError: (e: Error) => toast.error("Failed to approve: " + e.message),
  });

  const rejectLeave = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (!user?.id) throw new Error("No user");
      const { error } = await supabase
        .from("leave_applications")
        .update({ status: "rejected", approved_by: user.id, approved_at: new Date().toISOString(), rejection_reason: reason })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["leave-applications"] });
      toast.success("Leave rejected.");
    },
    onError: (e: Error) => toast.error("Failed to reject: " + e.message),
  });

  const handleConfirmReject = () => {
    if (!rejectTarget || !rejectReason.trim()) {
      toast.error("Reason is required");
      return;
    }
    if (rejectTarget.kind === "leave") {
      rejectLeave.mutate({ id: rejectTarget.id, reason: rejectReason });
    } else {
      rejectRegularization.mutate({ id: rejectTarget.id, reason: rejectReason });
    }
    setRejectTarget(null);
    setRejectReason("");
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">HR Approvals</h1>
          <p className="text-muted-foreground">Approve or reject team leave and attendance requests</p>
        </div>

        <UrlTabs param="tab" defaultValue="leaves" className="space-y-6">
          <TabsList>
            <TabsTrigger value="leaves" className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Leave ({pendingLeaves?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="regs" className="flex items-center gap-2">
              <FileEdit className="h-4 w-4" />
              Regularization ({pendingRegularizations?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="leaves" className="space-y-4">
            {leavesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading…</div>
            ) : !pendingLeaves?.length ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">No pending leave requests</CardContent>
              </Card>
            ) : (
              pendingLeaves.map((l: any) => (
                <Card key={l.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{profileName(l.profile)}</CardTitle>
                        <CardDescription>
                          {LEAVE_LABELS[l.leave_type] || l.leave_type} · {format(new Date(l.start_date), "MMM d")} – {format(new Date(l.end_date), "MMM d, yyyy")} ({l.total_days} days)
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        PENDING
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">{l.reason}</p>
                    {l.leave_calculation?.has_sandwich && (
                      <p className="text-xs text-yellow-700">
                        Sandwich leave: {l.leave_calculation.requested_days} working + {l.leave_calculation.weekend_days} weekend + {l.leave_calculation.holiday_days} holiday
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approveLeave.mutate(l.id)} disabled={approveLeave.isPending}>
                        <CheckCircle className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setRejectTarget({ id: l.id, kind: "leave" })}>
                        <XCircle className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="regs" className="space-y-4">
            {loadingPending ? (
              <div className="text-center py-8 text-muted-foreground">Loading…</div>
            ) : !pendingRegularizations?.length ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">No pending regularization requests</CardContent>
              </Card>
            ) : (
              pendingRegularizations.map((r) => (
                <Card key={r.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{profileName(r.profile)}</CardTitle>
                        <CardDescription>
                          {REG_LABELS[r.regularization_type]} for {format(new Date(r.attendance_date), "MMM d, yyyy")}
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> PENDING
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Original</div>
                        <div>In: {fmtTime(r.original_sign_in_time)} · Out: {fmtTime(r.original_sign_out_time)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Requested</div>
                        <div>In: {fmtTime(r.requested_sign_in_time)} · Out: {fmtTime(r.requested_sign_out_time)}</div>
                      </div>
                    </div>
                    <p className="text-sm">{r.reason}</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approveRegularization.mutate(r.id)} disabled={approveRegularization.isPending}>
                        <CheckCircle className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setRejectTarget({ id: r.id, kind: "regularization" })}>
                        <XCircle className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </UrlTabs>

        <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Provide a reason — the requester will see this.</p>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection" rows={3} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
              <Button variant="destructive" onClick={handleConfirmReject}>Reject</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
