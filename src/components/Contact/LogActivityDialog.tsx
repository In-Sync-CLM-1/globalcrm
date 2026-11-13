import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ParticipantSelector } from "./ParticipantSelector";
import { useNotification } from "@/hooks/useNotification";
import { Plus, X } from "lucide-react";
import { ActivityData } from "@/types/common";

interface CallDisposition {
  id: string;
  name: string;
}

interface CallSubDisposition {
  id: string;
  disposition_id: string;
  name: string;
}

interface LogActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  defaultActivityType?: string;
  onActivityLogged?: () => void;
}

export function LogActivityDialog({
  open,
  onOpenChange,
  contactId,
  defaultActivityType = "note",
  onActivityLogged,
}: LogActivityDialogProps) {
  const notify = useNotification();
  const [loading, setLoading] = useState(false);
  const [dispositions, setDispositions] = useState<CallDisposition[]>([]);
  const [subDispositions, setSubDispositions] = useState<CallSubDisposition[]>([]);
  const [filteredSubDispositions, setFilteredSubDispositions] = useState<CallSubDisposition[]>([]);

  const [formData, setFormData] = useState({
    activity_type: defaultActivityType,
    subject: "",
    description: "",
    call_disposition_id: "",
    call_sub_disposition_id: "",
    call_duration: "",
    next_action_date: null as Date | null,
    next_action_notes: "",
    send_email_reminder: true,
    show_popup_alert: true,
  });

  const [meetingConfig, setMeetingConfig] = useState({
    scheduledAt: null as Date | null,
    duration: 30,
    internalParticipants: [] as string[],
    externalParticipants: [] as { email: string; name: string }[],
  });

  const [orgId, setOrgId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setFormData(prev => ({ ...prev, activity_type: defaultActivityType }));
      fetchOrgId();
    }
  }, [open, defaultActivityType]);

  const fetchOrgId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();
      if (profile?.org_id) {
        setOrgId(profile.org_id);
      }
    }
  };

  useEffect(() => {
    if (formData.call_disposition_id) {
      const filtered = subDispositions.filter(
        sub => sub.disposition_id === formData.call_disposition_id
      );
      setFilteredSubDispositions(filtered);
    } else {
      setFilteredSubDispositions([]);
    }
  }, [formData.call_disposition_id, subDispositions]);

  const { data: dispositionsData } = useQuery({
    queryKey: ['call-dispositions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_dispositions")
        .select("id, name")
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const { data: subDispositionsData } = useQuery({
    queryKey: ['call-sub-dispositions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_sub_dispositions")
        .select("*")
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  useEffect(() => {
    if (dispositionsData) setDispositions(dispositionsData);
    if (subDispositionsData) setSubDispositions(subDispositionsData);
  }, [dispositionsData, subDispositionsData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!profile?.org_id) throw new Error("Organization not found");

      const activityData: any = { // Database insert allows flexible schema
        contact_id: contactId,
        org_id: profile.org_id,
        activity_type: formData.activity_type,
        subject: formData.subject || null,
        description: formData.description || null,
        call_disposition_id: formData.call_disposition_id || null,
        call_sub_disposition_id: formData.call_sub_disposition_id || null,
        call_duration: formData.call_duration ? parseInt(formData.call_duration) * 60 : null,
        created_by: user.id,
        next_action_date: formData.next_action_date?.toISOString() || null,
        next_action_notes: formData.next_action_notes || null,
        morning_reminder_sent: false,
        pre_action_reminder_sent: false,
      };

      // For meetings: add meeting-specific fields
      if (formData.activity_type === 'meeting') {
        activityData.scheduled_at = meetingConfig.scheduledAt?.toISOString();
        activityData.meeting_duration_minutes = meetingConfig.duration;
        activityData.completed_at = meetingConfig.scheduledAt ? null : new Date().toISOString();
      } else {
        activityData.completed_at = new Date().toISOString();
      }

      const { data: activity, error: activityError } = await supabase
        .from("contact_activities")
        .insert([activityData])
        .select()
        .single();

      if (activityError) throw activityError;

      // For meetings: handle participants
      if (formData.activity_type === 'meeting') {
        const participants = [];

        // Add internal participants
        let skippedParticipants = 0;
        for (const userId of meetingConfig.internalParticipants) {
          const { data: userProfile } = await supabase
            .from('profiles')
            .select('first_name, last_name, email')
            .eq('id', userId)
            .single();

          if (userProfile) {
            if (userProfile.email) {
              participants.push({
                activity_id: activity.id,
                user_id: userId,
                email: userProfile.email,
                name: `${userProfile.first_name} ${userProfile.last_name || ''}`.trim(),
                org_id: profile.org_id
              });
            } else {
              skippedParticipants++;
            }
          }
        }

        // Show warning if participants were skipped
        if (skippedParticipants > 0) {
          notify.info("Warning", `${skippedParticipants} team member(s) skipped (no email address configured)`);
        }

        // Add external participants
        for (const external of meetingConfig.externalParticipants) {
          if (external.email && external.name) {
            // Try to link to contact
            const { data: contact } = await supabase
              .from('contacts')
              .select('id')
              .eq('email', external.email)
              .eq('org_id', profile.org_id)
              .maybeSingle();

            participants.push({
              activity_id: activity.id,
              contact_id: contact?.id || null,
              email: external.email,
              name: external.name,
              org_id: profile.org_id
            });
          }
        }

        // Insert participants
        if (participants.length > 0) {
          const { error: participantsError } = await supabase
            .from('activity_participants')
            .insert(participants);

          if (participantsError) {
            console.error('Failed to add participants:', participantsError);
          }
        }
      }

      const description = formData.activity_type === 'meeting'
        ? "Meeting created successfully"
        : "Activity has been logged successfully";
      
      notify.success("Activity logged", description);

      resetForm();
      onOpenChange(false);
      if (onActivityLogged) onActivityLogged();
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      activity_type: "note",
      subject: "",
      description: "",
      call_disposition_id: "",
      call_sub_disposition_id: "",
      call_duration: "",
      next_action_date: null,
      next_action_notes: "",
      send_email_reminder: true,
      show_popup_alert: true,
    });
    setMeetingConfig({
      scheduledAt: null,
      duration: 30,
      internalParticipants: [],
      externalParticipants: [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Log Activity</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto px-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activity_type">Activity Type *</Label>
              <Select
                value={formData.activity_type}
                onValueChange={(value) => setFormData({ ...formData, activity_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Phone Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="e.g., Follow-up call"
              />
            </div>

            {formData.activity_type === "call" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="call_duration">Duration (minutes)</Label>
                  <Input
                    id="call_duration"
                    type="number"
                    min="0"
                    value={formData.call_duration}
                    onChange={(e) => setFormData({ ...formData, call_duration: e.target.value })}
                    placeholder="5"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="disposition">Call Disposition</Label>
                  <Select
                    value={formData.call_disposition_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, call_disposition_id: value, call_sub_disposition_id: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select disposition" />
                    </SelectTrigger>
                    <SelectContent>
                      {dispositions.map((disp) => (
                        <SelectItem key={disp.id} value={disp.id}>
                          {disp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {filteredSubDispositions.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="sub_disposition">Sub-Disposition</Label>
                    <Select
                      value={formData.call_sub_disposition_id}
                      onValueChange={(value) =>
                        setFormData({ ...formData, call_sub_disposition_id: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select sub-disposition" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredSubDispositions.map((subDisp) => (
                          <SelectItem key={subDisp.id} value={subDisp.id}>
                            {subDisp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {formData.activity_type === "meeting" && (
              <>
                <div className="space-y-2">
                  <Label>When *</Label>
                  <RadioGroup
                    value={meetingConfig.scheduledAt ? "scheduled" : "now"}
                    onValueChange={(value) => {
                      if (value === "now") {
                        setMeetingConfig({ ...meetingConfig, scheduledAt: null });
                      } else {
                        setMeetingConfig({ ...meetingConfig, scheduledAt: new Date() });
                      }
                    }}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="now" id="meeting-now" />
                      <Label htmlFor="meeting-now" className="font-normal">Start immediately</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="scheduled" id="meeting-scheduled" />
                      <Label htmlFor="meeting-scheduled" className="font-normal">Schedule for later</Label>
                    </div>
                  </RadioGroup>
                  
                  {meetingConfig.scheduledAt && (
                    <DateTimePicker
                      value={meetingConfig.scheduledAt}
                      onChange={(date) => setMeetingConfig({ ...meetingConfig, scheduledAt: date })}
                      minDate={new Date()}
                      label="Select date and time"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Duration (minutes) *</Label>
                  <Select
                    value={meetingConfig.duration.toString()}
                    onValueChange={(value) => setMeetingConfig({ ...meetingConfig, duration: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

{orgId && (
                  <div className="space-y-2">
                    <Label>Invite team members</Label>
                    <ParticipantSelector
                      orgId={orgId}
                      selectedUserIds={meetingConfig.internalParticipants}
                      onChange={(userIds) => setMeetingConfig({ ...meetingConfig, internalParticipants: userIds })}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>External participants</Label>
                  <div className="space-y-2">
                    {meetingConfig.externalParticipants.map((p, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          placeholder="Name"
                          value={p.name}
                          onChange={(e) => {
                            const updated = [...meetingConfig.externalParticipants];
                            updated[idx].name = e.target.value;
                            setMeetingConfig({ ...meetingConfig, externalParticipants: updated });
                          }}
                        />
                        <Input
                          type="email"
                          placeholder="Email"
                          value={p.email}
                          onChange={(e) => {
                            const updated = [...meetingConfig.externalParticipants];
                            updated[idx].email = e.target.value;
                            setMeetingConfig({ ...meetingConfig, externalParticipants: updated });
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const updated = meetingConfig.externalParticipants.filter((_, i) => i !== idx);
                            setMeetingConfig({ ...meetingConfig, externalParticipants: updated });
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMeetingConfig({
                          ...meetingConfig,
                          externalParticipants: [...meetingConfig.externalParticipants, { email: '', name: '' }]
                        });
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add external participant
                    </Button>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                placeholder="Add details about this activity..."
              />
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label className="text-base font-semibold">Schedule Next Action (Optional)</Label>
              
              <DateTimePicker
                label="Next Action Date & Time"
                value={formData.next_action_date}
                onChange={(date) => setFormData({ ...formData, next_action_date: date })}
                minDate={new Date()}
              />
              
              {formData.next_action_date && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="next_action_notes">Next Action Notes</Label>
                    <Textarea
                      id="next_action_notes"
                      value={formData.next_action_notes}
                      onChange={(e) => setFormData({ ...formData, next_action_notes: e.target.value })}
                      rows={2}
                      placeholder="e.g., Follow up on proposal discussion, Send pricing details..."
                    />
                  </div>

                  {/* Reminder Options */}
                  <div className="space-y-3 bg-accent/30 rounded-lg p-3">
                    <Label className="text-sm font-medium">Reminder Options</Label>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">📧</span>
                        <Label htmlFor="email_reminder" className="font-normal text-sm">
                          Send email reminder
                        </Label>
                      </div>
                      <Switch
                        id="email_reminder"
                        checked={formData.send_email_reminder}
                        onCheckedChange={(checked) => 
                          setFormData({ ...formData, send_email_reminder: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🔔</span>
                        <Label htmlFor="popup_alert" className="font-normal text-sm">
                          Show popup alert in CRM
                        </Label>
                      </div>
                      <Switch
                        id="popup_alert"
                        checked={formData.show_popup_alert}
                        onCheckedChange={(checked) => 
                          setFormData({ ...formData, show_popup_alert: checked })
                        }
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You'll receive reminders at 9 AM on the day and 1 hour before the scheduled time.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sticky footer with buttons */}
          <div className="flex gap-2 px-6 py-4 border-t bg-background mt-auto">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Saving..." : "Log Activity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
