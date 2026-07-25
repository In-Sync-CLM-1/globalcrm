import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, isToday, isTomorrow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building, CalendarClock, Phone, Presentation, AlertTriangle } from "lucide-react";

// How far back an untouched commitment still counts as "needs action",
// and how far ahead we pull upcoming ones.
const OVERDUE_WINDOW_DAYS = 30;
const UPCOMING_WINDOW_DAYS = 14;

interface EnquiryRow {
  activityId: string;
  contactId: string;
  name: string;
  company: string | null;
  subject: string | null;
  activityType: string | null;
  dueAt: string;
  stageName: string | null;
  stageColor: string | null;
}

/**
 * The pipeline board ranks cards by `updated_at` inside a 500-row window, which
 * buries the handful of people who actually asked for something. This strip is
 * fetched on its own — driven by open commitments, not recency — so a booked demo
 * or a promised callback can never fall off the board.
 */
export function EnquiriesStrip({ orgId }: { orgId: string | undefined }) {
  const navigate = useNavigate();

  const { data: enquiries, isLoading } = useQuery({
    queryKey: ["pipeline-enquiries", orgId],
    queryFn: async (): Promise<EnquiryRow[]> => {
      const from = new Date(Date.now() - OVERDUE_WINDOW_DAYS * 86400_000).toISOString();
      const to = new Date(Date.now() + UPCOMING_WINDOW_DAYS * 86400_000).toISOString();

      const { data, error } = await supabase
        .from("contact_activities")
        .select(
          `id, contact_id, activity_type, subject, scheduled_at, next_action_date,
           contacts!inner(id, first_name, last_name, company, pipeline_stage_id)`
        )
        .eq("org_id", orgId!)
        .is("completed_at", null)
        .or(
          `and(scheduled_at.gte.${from},scheduled_at.lte.${to}),` +
            `and(next_action_date.gte.${from},next_action_date.lte.${to})`
        )
        .limit(200);

      if (error) throw error;

      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, name, color")
        .eq("org_id", orgId!);
      const stageById = new Map((stages ?? []).map((s: any) => [s.id, s]));

      // One row per contact — the soonest thing still owed to them.
      const bestByContact = new Map<string, EnquiryRow>();
      for (const a of (data ?? []) as any[]) {
        const c = a.contacts;
        if (!c) continue;
        const dueAt = a.scheduled_at ?? a.next_action_date;
        if (!dueAt) continue;
        const stage = c.pipeline_stage_id ? stageById.get(c.pipeline_stage_id) : null;
        const row: EnquiryRow = {
          activityId: a.id,
          contactId: c.id,
          name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed",
          company: c.company,
          subject: a.subject,
          activityType: a.activity_type,
          dueAt,
          stageName: stage?.name ?? null,
          stageColor: stage?.color ?? null,
        };
        const existing = bestByContact.get(c.id);
        if (!existing || new Date(dueAt) < new Date(existing.dueAt)) {
          bestByContact.set(c.id, row);
        }
      }

      // Overdue first, then soonest.
      const now = Date.now();
      return [...bestByContact.values()].sort((a, b) => {
        const aOver = new Date(a.dueAt).getTime() < now;
        const bOver = new Date(b.dueAt).getTime() < now;
        if (aOver !== bOver) return aOver ? -1 : 1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
    },
    enabled: !!orgId,
  });

  const overdueCount = useMemo(
    () => (enquiries ?? []).filter((e) => new Date(e.dueAt).getTime() < Date.now()).length,
    [enquiries]
  );

  if (isLoading || !enquiries || enquiries.length === 0) return null;

  return (
    <Card className="mb-4 border-primary/40 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-primary" />
          <span>
            {enquiries.length} {enquiries.length === 1 ? "enquiry needs" : "enquiries need"} your action
          </span>
          {overdueCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {overdueCount} overdue
            </Badge>
          )}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            People who asked for a demo or a callback — pinned here regardless of stage.
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex gap-3 overflow-x-auto pb-2">
        {enquiries.map((e) => {
          const due = new Date(e.dueAt);
          const isOverdue = due.getTime() < Date.now();
          const isDemo = /demo/i.test(`${e.subject ?? ""} ${e.activityType ?? ""}`);
          const when = isToday(due)
            ? `Today ${format(due, "h:mm a")}`
            : isTomorrow(due)
            ? `Tomorrow ${format(due, "h:mm a")}`
            : format(due, "d MMM, h:mm a");

          return (
            <Card
              key={e.activityId}
              onClick={() => navigate(`/contacts/${e.contactId}`)}
              className={`w-72 flex-shrink-0 cursor-pointer transition-shadow hover:shadow-md ${
                isOverdue ? "border-destructive/50" : ""
              }`}
            >
              <CardContent className="space-y-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-tight">{e.name}</p>
                  <Badge variant={isDemo ? "default" : "secondary"} className="shrink-0 gap-1 text-[10px]">
                    {isDemo ? <Presentation className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                    {isDemo ? "Demo" : "Callback"}
                  </Badge>
                </div>

                {e.company && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building className="h-3 w-3 shrink-0" />
                    <span className="truncate">{e.company}</span>
                  </div>
                )}

                {e.subject && <p className="truncate text-xs text-muted-foreground">{e.subject}</p>}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className={`text-xs font-medium ${isOverdue ? "text-destructive" : "text-foreground"}`}>
                    {isOverdue ? "Overdue · " : ""}
                    {when}
                  </span>
                  {e.stageName && (
                    <Badge
                      variant="outline"
                      className="shrink-0 text-[10px]"
                      style={e.stageColor ? { borderColor: e.stageColor, color: e.stageColor } : undefined}
                    >
                      {e.stageName}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
