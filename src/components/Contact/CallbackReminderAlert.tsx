import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Phone, Clock, User, Building2, Mail, X, BellRing, Loader2, Check, Trash2 } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useCallbackReminders } from "@/hooks/useCallbackReminders";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useGamingAccess } from "@/hooks/useGamingAccess";

interface CallbackAlert {
  id: string;
  type: "notification" | "direct";
  title: string;
  message: string;
  contact_id?: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  contact_company: string | null;
  next_action_date: string;
  action_url: string | null;
}

export function CallbackReminderAlert() {
  const gaming = useGamingAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notifications, markAsRead } = useNotifications();
  const { dueReminders, markReminderShown, triggerEdgeFunctionCheck } = useCallbackReminders();
  const [currentAlert, setCurrentAlert] = useState<CallbackAlert | null>(null);
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set());
  const [shownDirectIds, setShownDirectIds] = useState<Set<string>>(new Set());
  const [isCallingLoading, setIsCallingLoading] = useState(false);
  const hasTriggeredEdgeFunction = useRef(false);

  // Trigger edge function check on mount (once)
  useEffect(() => {
    if (!hasTriggeredEdgeFunction.current) {
      hasTriggeredEdgeFunction.current = true;
      triggerEdgeFunctionCheck();
    }
  }, [triggerEdgeFunctionCheck]);

  // Helper to extract contact ID from action_url
  const getContactIdFromUrl = (url: string | null): string | null => {
    if (!url) return null;
    const match = url.match(/\/contacts\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  };

  // Find urgent callback notifications that haven't been snoozed
  useEffect(() => {
    if (currentAlert) return; // Don't show another if one is already showing

    // First, check notifications from useNotifications
    const urgentNotification = notifications.find(
      (n) =>
        !n.is_read &&
        (n.type === "next_action_urgent" || n.type === "callback_reminder") &&
        n.metadata?.is_callback_reminder &&
        !snoozedIds.has(n.id)
    );

    if (urgentNotification) {
      setCurrentAlert({
        id: urgentNotification.id,
        type: "notification",
        title: urgentNotification.title,
        message: urgentNotification.message,
        contact_name: urgentNotification.metadata?.contact_name || "Unknown Contact",
        contact_phone: urgentNotification.metadata?.contact_phone || null,
        contact_email: urgentNotification.metadata?.contact_email || null,
        contact_company: urgentNotification.metadata?.contact_company || null,
        next_action_date: urgentNotification.metadata?.next_action_date || "",
        action_url: urgentNotification.action_url,
      });
      playNotificationSound();
      return;
    }

    // Second, check direct database reminders
    const dueReminder = dueReminders.find(
      (r) => !snoozedIds.has(`direct-${r.id}`) && !shownDirectIds.has(r.id)
    );

    if (dueReminder) {
      console.log('[CallbackReminderAlert] Showing direct reminder for:', dueReminder.contact_name);
      setCurrentAlert({
        id: `direct-${dueReminder.id}`,
        type: "direct",
        title: "Callback Reminder",
        message: dueReminder.next_action_notes || dueReminder.subject || "Time to follow up with this contact",
        contact_id: dueReminder.contact_id,
        contact_name: dueReminder.contact_name,
        contact_phone: dueReminder.contact_phone,
        contact_email: dueReminder.contact_email,
        contact_company: dueReminder.contact_company,
        next_action_date: dueReminder.next_action_date,
        action_url: `/contacts/${dueReminder.contact_id}`,
      });
      // Mark as shown so we don't show it again in this session
      setShownDirectIds((prev) => new Set(prev).add(dueReminder.id));
      // Mark in database
      markReminderShown(dueReminder.id);
      playNotificationSound();
    }
  }, [notifications, dueReminders, snoozedIds, currentAlert, shownDirectIds, markReminderShown]);

  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      
      setTimeout(() => {
        oscillator.frequency.value = 1000;
      }, 150);
      
      setTimeout(() => {
        oscillator.stop();
      }, 300);
    } catch (err) {
      console.log('Audio notification not supported');
    }
  };

  const handleCallNow = async () => {
    if (!currentAlert?.contact_phone) return;
    
    setIsCallingLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single();

      if (!profile?.phone) {
        toast({
          title: "No Phone Configured",
          description: "Please configure your phone number in your profile to use click-to-call. Opening phone dialer instead.",
          variant: "destructive",
        });
        if (!String(currentAlert.contact_phone).includes("•")) window.location.href = `tel:${currentAlert.contact_phone}`;
        setIsCallingLoading(false);
        return;
      }

      const contactId = currentAlert.contact_id || getContactIdFromUrl(currentAlert.action_url);

      const { data, error } = await supabase.functions.invoke('exotel-make-call', {
        body: {
          contactId,
          agentPhoneNumber: profile.phone,
          customerPhoneNumber: currentAlert.contact_phone,
        },
      });

      if (error) throw error;

      toast({
        title: "Call Initiated",
        description: `Calling ${currentAlert.contact_name || 'contact'}. You will receive a call shortly.`,
      });

      if (currentAlert.action_url) {
        navigate(currentAlert.action_url);
      }
      
      handleDismissInternal();
    } catch (error: any) {
      console.error('Error making call:', error);
      toast({
        title: "Call Failed",
        description: error.message || "Could not initiate call. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCallingLoading(false);
    }
  };

  const handleViewContact = () => {
    if (currentAlert?.action_url) {
      navigate(currentAlert.action_url);
    }
    handleDismissInternal();
  };

  const handleSnooze = () => {
    if (currentAlert) {
      setSnoozedIds((prev) => new Set(prev).add(currentAlert.id));
      // Re-alert after 15 minutes
      setTimeout(() => {
        setSnoozedIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(currentAlert.id);
          return newSet;
        });
      }, 15 * 60 * 1000);
    }
    setCurrentAlert(null);
  };

  // Mark the activity as done (complete it)
  const handleMarkAsDone = async () => {
    if (!currentAlert) return;
    
    try {
      let activityId: string | null = null;
      
      if (currentAlert.type === "direct") {
        activityId = currentAlert.id.replace("direct-", "");
      } else if (currentAlert.type === "notification") {
        // Extract activity_id from the notification's entity_id
        const notification = notifications.find(n => n.id === currentAlert.id);
        if (notification?.entity_id && notification?.entity_type === 'contact_activity') {
          activityId = notification.entity_id;
        }
      }
      
      if (activityId) {
        // Mark activity as completed
        const { error } = await supabase
          .from("contact_activities")
          .update({ 
            completed_at: new Date().toISOString(),
            next_action_date: null,
            reminder_sent: true 
          })
          .eq("id", activityId);
        
        if (error) throw error;
        
        // Also delete all related notifications for this activity
        await supabase
          .from("notifications")
          .delete()
          .eq("entity_id", activityId)
          .eq("entity_type", "contact_activity");
      }
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["callback-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["contact-activities"] });
      
      toast({
        title: "Marked as Done",
        description: "The callback has been marked as completed.",
      });
      
      handleDismissInternal();
    } catch (error: any) {
      console.error("Error marking as done:", error);
      toast({
        title: "Error",
        description: "Failed to mark as done. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Remove the reminder (clear next_action_date without completing)
  const handleRemoveReminder = async () => {
    if (!currentAlert) return;
    
    try {
      let activityId: string | null = null;
      
      if (currentAlert.type === "direct") {
        activityId = currentAlert.id.replace("direct-", "");
      } else if (currentAlert.type === "notification") {
        // Extract activity_id from the notification's entity_id
        const notification = notifications.find(n => n.id === currentAlert.id);
        if (notification?.entity_id && notification?.entity_type === 'contact_activity') {
          activityId = notification.entity_id;
        }
      }
      
      if (activityId) {
        const { error } = await supabase
          .from("contact_activities")
          .update({ 
            next_action_date: null,
            reminder_sent: true 
          })
          .eq("id", activityId);
        
        if (error) throw error;
        
        // Also delete all related notifications for this activity
        await supabase
          .from("notifications")
          .delete()
          .eq("entity_id", activityId)
          .eq("entity_type", "contact_activity");
      }
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["callback-reminders"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["contact-activities"] });
      
      toast({
        title: "Reminder Removed",
        description: "The callback reminder has been removed.",
      });
      
      handleDismissInternal();
    } catch (error: any) {
      console.error("Error removing reminder:", error);
      toast({
        title: "Error",
        description: "Failed to remove reminder. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDismissInternal = useCallback(() => {
    if (currentAlert) {
      if (currentAlert.type === "notification") {
        markAsRead(currentAlert.id);
      }
    }
    setCurrentAlert(null);
  }, [currentAlert, markAsRead]);

  const handleDismiss = () => {
    handleDismissInternal();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (!currentAlert) return null;

  return (
    <AlertDialog open={!!currentAlert} onOpenChange={() => {}}>
      <AlertDialogContent className="max-w-md border-2 border-primary/20 shadow-2xl">
        <AlertDialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-full animate-pulse">
                <BellRing className="h-5 w-5 text-primary" />
              </div>
              <AlertDialogTitle className="text-lg">
                Callback Reminder
              </AlertDialogTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-4">
              <div className="bg-accent/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-foreground">
                      {currentAlert.contact_name}
                    </h3>
                    {currentAlert.contact_company && (
                      <div className="flex items-center gap-1 text-muted-foreground text-sm">
                        <Building2 className="h-3 w-3" />
                        {currentAlert.contact_company}
                      </div>
                    )}
                  </div>
                </div>

                {currentAlert.contact_phone && (
                  <div className="flex items-center gap-2 text-foreground">
                    <Phone className="h-4 w-4 text-primary" />
                    {gaming.masked ? (
                      <span>{gaming.phone(currentAlert.contact_phone)}</span>
                    ) : (
                      <a
                        href={`tel:${currentAlert.contact_phone}`}
                        className="hover:text-primary transition-colors"
                      >
                        {currentAlert.contact_phone}
                      </a>
                    )}
                  </div>
                )}

                {currentAlert.contact_email && (
                  <div className="flex items-center gap-2 text-foreground">
                    <Mail className="h-4 w-4 text-primary" />
                    <span className="text-sm truncate">
                      {gaming.email(currentAlert.contact_email)}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 text-foreground border-t pt-3 mt-3">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    Scheduled: {formatDate(currentAlert.next_action_date)}
                  </span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">{currentAlert.message}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSnooze}
              >
                Snooze 15 min
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleViewContact}
              >
                View Contact
              </Button>
              {currentAlert.contact_phone && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleCallNow}
                  disabled={isCallingLoading}
                >
                  {isCallingLoading ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Phone className="h-4 w-4 mr-1" />
                  )}
                  {isCallingLoading ? "..." : "Call Now"}
                </Button>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-green-600 hover:bg-green-100 hover:text-green-700"
                onClick={handleMarkAsDone}
                title="Mark as Done"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                onClick={handleRemoveReminder}
                title="Remove Reminder"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
