import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { CalendarView } from "@/components/Calendar/CalendarView";
import { CalendarSidebar } from "@/components/Calendar/CalendarSidebar";
import { CreateCalendarActivityDialog } from "@/components/Calendar/CreateCalendarActivityDialog";
import { EditCalendarActivityDialog } from "@/components/Calendar/EditCalendarActivityDialog";
import { CalendarFiltersComponent } from "@/components/Calendar/CalendarFilters";
import { CalendarViewToggle, ViewMode } from "@/components/Calendar/CalendarViewToggle";
import { ShareCalendarDialog } from "@/components/Calendar/ShareCalendarDialog";
import { SharedCalendarsSelector } from "@/components/Calendar/SharedCalendarsSelector";
import { useCalendarActivities } from "@/hooks/useCalendarActivities";
import { useOrgContext } from "@/hooks/useOrgContext";
import { CalendarEvent, CalendarFilters } from "@/types/calendar";
import { Button } from "@/components/ui/button";
import { Plus, Calendar as CalendarIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useUrlState } from "@/hooks/useUrlState";
import { useUrlObjectState } from "@/hooks/useUrlState";
import { format, parseISO, isValid } from "date-fns";

export default function Calendar() {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { effectiveOrgId } = useOrgContext();
  
  const [currentDateKey, setCurrentDateKey] = useUrlState("date", format(new Date(), "yyyy-MM-dd"));
  const currentDate = useMemo(() => {
    const d = parseISO(currentDateKey);
    return isValid(d) ? d : new Date();
  }, [currentDateKey]);
  const setCurrentDate = (d: Date) => setCurrentDateKey(format(d, "yyyy-MM-dd"));
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [viewMode, setViewMode] = useUrlState<ViewMode>("view", 'all');
  const [selectedUserIds, setSelectedUserIds] = useUrlState("users", [] as string[]);
  const [filters, setFilters] = useUrlObjectState<CalendarFilters>("cf", {
    types: [],
    showCompleted: true,
  });
  const [deleteEvent, setDeleteEvent] = useState<CalendarEvent | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const { events, eventsByDate, isLoading, currentUserId } = useCalendarActivities({
    currentDate,
    filters,
    viewMode,
    selectedUserIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ["company-holidays", effectiveOrgId, currentDate.getFullYear()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_holidays")
        .select("holiday_date, holiday_name, is_optional")
        .eq("org_id", effectiveOrgId!)
        .eq("year", currentDate.getFullYear());
      if (error) throw error;
      return data as { holiday_date: string; holiday_name: string; is_optional: boolean }[];
    },
    enabled: !!effectiveOrgId,
  });

  const holidaysByDate = useMemo(() => {
    const m: Record<string, { name: string; is_optional: boolean }> = {};
    holidays.forEach((h) => { m[h.holiday_date] = { name: h.holiday_name, is_optional: !!h.is_optional }; });
    return m;
  }, [holidays]);

  // Initialize selectedUserIds with current user when available
  useEffect(() => {
    if (currentUserId && selectedUserIds.length === 0) {
      setSelectedUserIds([currentUserId]);
    }
  }, [currentUserId, selectedUserIds.length]);

  // Mark activity/task as complete
  const markCompleteMutation = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      if (event.source === "task") {
        const { error } = await supabase
          .from("tasks")
          .update({ status: "completed" })
          .eq("id", event.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("contact_activities")
          .update({ completed_at: new Date().toISOString() })
          .eq("id", event.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      notify.success("Completed", "Activity marked as complete");
      queryClient.invalidateQueries({ queryKey: ["calendar-activities"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-tasks"] });
    },
    onError: (error: any) => {
      notify.error("Error", error.message);
    },
  });

  // Delete activity/task
  const deleteMutation = useMutation({
    mutationFn: async (event: CalendarEvent) => {
      if (event.source === "task") {
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("id", event.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("contact_activities")
          .delete()
          .eq("id", event.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      notify.success("Deleted", "Activity has been removed");
      queryClient.invalidateQueries({ queryKey: ["calendar-activities"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-tasks"] });
      setDeleteEvent(null);
    },
    onError: (error: any) => {
      notify.error("Error", error.message);
    },
  });

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    if (isMobile) {
      setShowMobileSidebar(true);
    }
  };

  const handleCreateActivity = () => {
    setShowCreateDialog(true);
    if (isMobile) {
      setShowMobileSidebar(false);
    }
  };

  const handleEdit = (event: CalendarEvent) => {
    // Only allow editing own events
    if (event.ownerId && event.ownerId !== currentUserId) {
      notify.error("Cannot edit", "You can only edit your own calendar items");
      return;
    }
    setEditEvent(event);
  };

  const handleDelete = (event: CalendarEvent) => {
    // Only allow deleting own events
    if (event.ownerId && event.ownerId !== currentUserId) {
      notify.error("Cannot delete", "You can only delete your own calendar items");
      return;
    }
    setDeleteEvent(event);
  };

  const handleMarkComplete = (event: CalendarEvent) => {
    // Only allow completing own events
    if (event.ownerId && event.ownerId !== currentUserId) {
      notify.error("Cannot modify", "You can only modify your own calendar items");
      return;
    }
    markCompleteMutation.mutate(event);
  };

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CalendarIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Calendar</h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                View and manage your activities
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarViewToggle value={viewMode} onChange={setViewMode} />
            <SharedCalendarsSelector 
              selectedUserIds={selectedUserIds} 
              onChange={setSelectedUserIds} 
            />
            <CalendarFiltersComponent filters={filters} onFiltersChange={setFilters} />
            <ShareCalendarDialog />
            <Button onClick={handleCreateActivity} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Create Activity</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Calendar Grid */}
          <div className="flex-1 p-4 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading calendar...</div>
              </div>
            ) : (
              <CalendarView
                currentDate={currentDate}
                onDateChange={setCurrentDate}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                eventsByDate={eventsByDate}
                holidaysByDate={holidaysByDate}
                showMultipleOwners={selectedUserIds.length > 1}
              />
            )}
          </div>

          {/* Sidebar - Desktop */}
          {!isMobile && (
            <div className="w-80 border-l border-border hidden lg:block">
              <CalendarSidebar
                selectedDate={selectedDate}
                events={events}
                onCreateActivity={handleCreateActivity}
                onMarkComplete={handleMarkComplete}
                onEdit={handleEdit}
                onDelete={handleDelete}
                currentUserId={currentUserId}
              />
            </div>
          )}
        </div>

        {/* Mobile Sidebar Sheet */}
        {isMobile && (
          <Sheet open={showMobileSidebar} onOpenChange={setShowMobileSidebar}>
            <SheetContent side="right" className="w-full sm:w-96 p-0">
              <CalendarSidebar
                selectedDate={selectedDate}
                events={events}
                onCreateActivity={handleCreateActivity}
                onMarkComplete={handleMarkComplete}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onClose={() => setShowMobileSidebar(false)}
                isMobile
                currentUserId={currentUserId}
              />
            </SheetContent>
          </Sheet>
        )}

        {/* Create Activity Dialog */}
        <CreateCalendarActivityDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          selectedDate={selectedDate}
        />

        {/* Edit Activity Dialog */}
        <EditCalendarActivityDialog
          event={editEvent}
          open={!!editEvent}
          onOpenChange={(open) => !open && setEditEvent(null)}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          open={!!deleteEvent}
          onOpenChange={(open) => !open && setDeleteEvent(null)}
          title="Delete Activity"
          description={`Are you sure you want to delete "${deleteEvent?.title}"? This action cannot be undone.`}
          confirmText="Delete"
          onConfirm={() => deleteEvent && deleteMutation.mutate(deleteEvent)}
          variant="destructive"
        />
      </div>
    </DashboardLayout>
  );
}
