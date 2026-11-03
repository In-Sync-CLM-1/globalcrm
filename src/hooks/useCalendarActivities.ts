import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { CalendarEvent, CalendarEventType, CalendarFilters, TaskStatus, ViewMode } from "@/types/calendar";
import { startOfMonth, endOfMonth, addDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { useEffect, useState } from "react";

// IST timezone
const IST_TIMEZONE = "Asia/Kolkata";

interface UseCalendarActivitiesOptions {
  currentDate: Date;
  filters?: CalendarFilters;
  viewMode?: ViewMode;
  selectedUserIds?: string[];
}

export function useCalendarActivities({ currentDate, filters, viewMode = 'all', selectedUserIds }: UseCalendarActivitiesOptions) {
  const { effectiveOrgId } = useOrgContext();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Get current user ID for filtering tasks
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);
    };
    getUser();
  }, []);

  // Extend range to include days from adjacent months that might be visible
  const rangeStart = addDays(startOfMonth(currentDate), -7);
  const rangeEnd = addDays(endOfMonth(currentDate), 7);

  // Determine which user IDs to fetch for (current user + selected shared calendars)
  const userIdsToFetch = selectedUserIds && selectedUserIds.length > 0 
    ? selectedUserIds 
    : currentUserId ? [currentUserId] : [];

  // Fetch user profiles for names
  const { data: userProfiles = [] } = useQuery({
    queryKey: ["user-profiles", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .eq("org_id", effectiveOrgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  const getUserName = (userId: string): string => {
    const user = userProfiles.find(u => u.id === userId);
    return user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown' : 'Unknown';
  };

  const { data: activities = [], isLoading: activitiesLoading } = useQuery({
    queryKey: ["calendar-activities", effectiveOrgId, rangeStart.toISOString(), rangeEnd.toISOString(), userIdsToFetch],
    queryFn: async () => {
      if (!effectiveOrgId || userIdsToFetch.length === 0) return [];

      // 1. Activities the user created
      const created = supabase
        .from("contact_activities")
        .select(`
          id,
          activity_type,
          subject,
          description,
          scheduled_at,
          next_action_date,
          completed_at,
          duration_minutes,
          meeting_link,
          contact_id,
          created_by,
          recurring_pattern_id,
          priority,
          contacts:contact_id (
            first_name,
            last_name,
            assigned_to
          ),
          creator:created_by (
            first_name,
            last_name
          )
        `)
        .eq("org_id", effectiveOrgId)
        .in("created_by", userIdsToFetch)
        .or(`scheduled_at.gte.${rangeStart.toISOString()},next_action_date.gte.${rangeStart.toISOString()}`)
        .or(`scheduled_at.lte.${rangeEnd.toISOString()},next_action_date.lte.${rangeEnd.toISOString()}`);

      // 2. Activities tied to contacts assigned to the user (manager scheduled it for them)
      const { data: assignedContacts } = await supabase
        .from("contacts")
        .select("id")
        .eq("org_id", effectiveOrgId)
        .in("assigned_to", userIdsToFetch);
      const assignedContactIds = (assignedContacts ?? []).map((c: any) => c.id);

      const [createdRes, assignedRes] = await Promise.all([
        created,
        assignedContactIds.length === 0
          ? Promise.resolve({ data: [] as any[], error: null })
          : supabase
              .from("contact_activities")
              .select(`
                id,
                activity_type,
                subject,
                description,
                scheduled_at,
                next_action_date,
                completed_at,
                duration_minutes,
                meeting_link,
                contact_id,
                created_by,
                recurring_pattern_id,
                priority,
                contacts:contact_id (
                  first_name,
                  last_name,
                  assigned_to
                ),
                creator:created_by (
                  first_name,
                  last_name
                )
              `)
              .eq("org_id", effectiveOrgId)
              .in("contact_id", assignedContactIds)
              .or(`scheduled_at.gte.${rangeStart.toISOString()},next_action_date.gte.${rangeStart.toISOString()}`)
              .or(`scheduled_at.lte.${rangeEnd.toISOString()},next_action_date.lte.${rangeEnd.toISOString()}`),
      ]);

      if (createdRes.error) throw createdRes.error;
      if (assignedRes.error) throw assignedRes.error;

      // Merge + dedupe by id
      const byId = new Map<string, any>();
      for (const row of [...(createdRes.data ?? []), ...(assignedRes.data ?? [])]) {
        byId.set(row.id, row);
      }
      return Array.from(byId.values());
    },
    enabled: !!effectiveOrgId && userIdsToFetch.length > 0 && viewMode !== 'tasks',
  });

  // Fetch tasks for selected users
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["calendar-tasks", effectiveOrgId, rangeStart.toISOString(), rangeEnd.toISOString(), userIdsToFetch],
    queryFn: async () => {
      if (!effectiveOrgId || userIdsToFetch.length === 0) return [];

      const { data, error } = await supabase
        .from("tasks")
        .select(`
          id,
          title,
          description,
          due_date,
          status,
          priority,
          assigned_to,
          recurring_pattern_id,
          assignee:assigned_to (
            first_name,
            last_name
          )
        `)
        .eq("org_id", effectiveOrgId)
        .in("assigned_to", userIdsToFetch)
        .gte("due_date", rangeStart.toISOString())
        .lte("due_date", rangeEnd.toISOString());

      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId && userIdsToFetch.length > 0 && viewMode !== 'activities',
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Normalize activities to CalendarEvent format
  // Convert UTC dates from database to IST for display
  const normalizedActivities: CalendarEvent[] = activities.map((activity: any) => {
    const dateTimeUtc = activity.scheduled_at || activity.next_action_date;
    // A call activity carries the NEXT call the agent promised in next_action_date
    // (a callback) while completed_at records the call that just ended. The
    // calendar entry stands for the upcoming callback, so it stays open (and
    // visible) until its day has passed.
    const isCallback = !activity.scheduled_at && !!activity.next_action_date;
    const callbackStillDue = isCallback && new Date(activity.next_action_date).getTime() >= startOfToday.getTime();
    // Convert UTC to IST for display
    const dateTimeIST = toZonedTime(new Date(dateTimeUtc), IST_TIMEZONE);
    const contactName = activity.contacts 
      ? `${activity.contacts.first_name || ''} ${activity.contacts.last_name || ''}`.trim()
      : undefined;
    const assignedToName = activity.creator
      ? `${activity.creator.first_name || ''} ${activity.creator.last_name || ''}`.trim()
      : undefined;

    return {
      id: activity.id,
      type: mapActivityType(activity.activity_type),
      title: isCallback ? `Callback${contactName ? ` – ${contactName}` : ''}` : (activity.subject || activity.activity_type),
      dateTime: dateTimeIST,
      duration: activity.duration_minutes,
      contactId: activity.contact_id,
      contactName,
      isCompleted: !!activity.completed_at && !callbackStillDue,
      source: 'activity' as const,
      description: activity.description,
      meetingLink: activity.meeting_link,
      assignedTo: activity.created_by,
      assignedToName,
      recurringPatternId: activity.recurring_pattern_id,
      isRecurring: !!activity.recurring_pattern_id,
      priority: activity.priority,
      isAllDay: false,
      ownerId: activity.created_by,
      ownerName: getUserName(activity.created_by),
    };
  }).filter((e: CalendarEvent) => e.dateTime);

  // Helper to check if a date has a specific time (not midnight)
  const hasSpecificTime = (date: Date): boolean => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return !(hours === 0 && minutes === 0);
  };

  // Normalize tasks to CalendarEvent format
  // Convert UTC dates from database to IST for display
  const normalizedTasks: CalendarEvent[] = tasks.map((task: any) => {
    const assignedToName = task.assignee
      ? `${task.assignee.first_name || ''} ${task.assignee.last_name || ''}`.trim()
      : undefined;
    
    // Convert UTC to IST for display
    const taskDateTimeIST = toZonedTime(new Date(task.due_date), IST_TIMEZONE);

    return {
      id: task.id,
      type: 'task' as CalendarEventType,
      title: task.title,
      dateTime: taskDateTimeIST,
      contactId: undefined,
      contactName: undefined,
      isCompleted: task.status === 'completed',
      source: 'task' as const,
      description: task.description,
      priority: task.priority,
      assignedTo: task.assigned_to,
      assignedToName,
      taskStatus: task.status as TaskStatus,
      recurringPatternId: task.recurring_pattern_id,
      isRecurring: !!task.recurring_pattern_id,
      isAllDay: !hasSpecificTime(taskDateTimeIST),
      ownerId: task.assigned_to,
      ownerName: getUserName(task.assigned_to),
    };
  });

  // Combine and filter events
  let allEvents = [...normalizedActivities, ...normalizedTasks];

  if (filters) {
    if (filters.types.length > 0) {
      allEvents = allEvents.filter(e => filters.types.includes(e.type));
    }
    if (!filters.showCompleted) {
      allEvents = allEvents.filter(e => !e.isCompleted);
    }
    if (filters.assignedTo) {
      allEvents = allEvents.filter(e => e.assignedTo === filters.assignedTo);
    }
  }

  // Group events by date string for easy lookup (using local timezone)
  const eventsByDate = allEvents.reduce((acc, event) => {
    const dateKey = format(event.dateTime, 'yyyy-MM-dd');
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  // Sort events within each date: all-day (tasks) first, then by time
  Object.keys(eventsByDate).forEach(dateKey => {
    eventsByDate[dateKey].sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      if (a.isAllDay && b.isAllDay) return a.title.localeCompare(b.title);
      return a.dateTime.getTime() - b.dateTime.getTime();
    });
  });

  return {
    events: allEvents,
    eventsByDate,
    isLoading: activitiesLoading || tasksLoading,
    currentUserId,
  };
}

function mapActivityType(activityType: string): CalendarEventType {
  const typeMap: Record<string, CalendarEventType> = {
    'meeting': 'meeting',
    'call': 'call',
    'email': 'email',
    'note': 'note',
    'follow_up': 'follow_up',
    'visit': 'visit',
    'task': 'task',
  };
  return typeMap[activityType.toLowerCase()] || 'note';
}
