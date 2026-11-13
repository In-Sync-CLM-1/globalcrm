import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotification } from "@/hooks/useNotification";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { format } from "date-fns";
import { updateContactStageToContacted } from "@/utils/pipelineStageUtils";

interface CallDisposition {
  id: string;
  name: string;
  category: string;
}

const DEMO_BOOKED_NAME = "Demo Booked";

interface CallSubDisposition {
  id: string;
  disposition_id: string;
  name: string;
}

interface PostCallDispositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callLogId: string;
  contactId: string | null;
  callDuration: number;
  onDispositionSaved?: () => void;
}

export function PostCallDispositionDialog({
  open,
  onOpenChange,
  callLogId,
  contactId,
  callDuration,
  onDispositionSaved,
}: PostCallDispositionDialogProps) {
  const notify = useNotification();
  const [loading, setLoading] = useState(false);
  const [dispositions, setDispositions] = useState<CallDisposition[]>([]);
  const [subDispositions, setSubDispositions] = useState<CallSubDisposition[]>([]);
  const [filteredSubDispositions, setFilteredSubDispositions] = useState<CallSubDisposition[]>([]);

  const [formData, setFormData] = useState({
    disposition_id: "",
    sub_disposition_id: "",
    notes: "",
  });
  const [callbackDateTime, setCallbackDateTime] = useState<Date | null>(null);
  const [selectedDispositionCategory, setSelectedDispositionCategory] = useState<string>("");
  const [selectedDispositionName, setSelectedDispositionName] = useState<string>("");
  const [demoDate, setDemoDate] = useState<string>("");
  const [demoTime, setDemoTime] = useState<string>("");


  useEffect(() => {
    if (formData.disposition_id) {
      const filtered = subDispositions.filter(
        sub => sub.disposition_id === formData.disposition_id
      );
      setFilteredSubDispositions(filtered);
    } else {
      setFilteredSubDispositions([]);
    }
  }, [formData.disposition_id, subDispositions]);

  const { data: dispositionsData } = useQuery({
    queryKey: ['call-dispositions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_dispositions")
        .select("id, name, category")
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
    
    if (!formData.disposition_id) {
      notify.error("Disposition required", new Error("Please select a call disposition"));
      return;
    }

    if (selectedDispositionName === DEMO_BOOKED_NAME && (!demoDate || !demoTime)) {
      notify.error("Demo details required", new Error("Please enter the demo date and time"));
      return;
    }

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

      // Update call log with disposition
      const { error: callLogError } = await supabase
        .from("call_logs")
        .update({
          disposition_id: formData.disposition_id,
          sub_disposition_id: formData.sub_disposition_id || null,
          notes: formData.notes || null,
        })
        .eq("id", callLogId);

      if (callLogError) throw callLogError;

      // Create contact activity if contact exists
      if (contactId) {
        const isDemoBooked = selectedDispositionName === DEMO_BOOKED_NAME;
        const demoNote = isDemoBooked
          ? `Demo booked for ${demoDate} at ${demoTime}`
          : null;

        const activityData: any = {
          contact_id: contactId,
          org_id: profile.org_id,
          activity_type: "call",
          subject: isDemoBooked ? "Demo booked" : "Call completed",
          description: formData.notes || demoNote || `Call duration: ${Math.floor(callDuration / 60)}m ${callDuration % 60}s`,
          call_disposition_id: formData.disposition_id,
          call_sub_disposition_id: formData.sub_disposition_id || null,
          call_duration: callDuration,
          created_by: user.id,
          completed_at: new Date().toISOString(),
          next_action_date: callbackDateTime?.toISOString() || null,
          next_action_notes: callbackDateTime ? `Callback scheduled for ${format(callbackDateTime, "PPP 'at' p")}` : null,
          demo_date: isDemoBooked ? demoDate : null,
          demo_time: isDemoBooked ? demoTime : null,
        };

        const { data: activity, error: activityError } = await supabase
          .from("contact_activities")
          .insert([activityData])
          .select()
          .single();

        if (activityError) throw activityError;

        // Link activity to call log
        if (activity) {
          await supabase
            .from("call_logs")
            .update({ activity_id: activity.id })
            .eq("id", callLogId);
        }

        // Update pipeline stage from New to Contacted
        await updateContactStageToContacted(contactId);
      }

      // Fire customer-facing post-call message (Demo Confirmation / Post-Call Intro)
      // — does nothing for Wrong Number / Do Not Call, and is idempotent per call_log.
      supabase.functions.invoke("send-post-call-message", {
        body: { call_log_id: callLogId },
      }).catch((err) => {
        console.warn("send-post-call-message invoke failed:", err);
      });

      notify.success("Disposition saved", "Call disposition has been recorded successfully");

      resetForm();
      onOpenChange(false);
      if (onDispositionSaved) onDispositionSaved();
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      disposition_id: "",
      sub_disposition_id: "",
      notes: "",
    });
    setCallbackDateTime(null);
    setSelectedDispositionCategory("");
    setSelectedDispositionName("");
    setDemoDate("");
    setDemoTime("");
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Call Disposition</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Call duration: {formatDuration(callDuration)}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disposition">Call Disposition *</Label>
            <Select
              value={formData.disposition_id}
              onValueChange={(value) => {
                const disp = dispositions.find(d => d.id === value);
                setSelectedDispositionCategory(disp?.category || "");
                setSelectedDispositionName(disp?.name || "");
                setFormData({ ...formData, disposition_id: value, sub_disposition_id: "" });
                setCallbackDateTime(null);
                setDemoDate("");
                setDemoTime("");
              }}
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
                value={formData.sub_disposition_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, sub_disposition_id: value })
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

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={4}
              placeholder="Add any notes about this call..."
            />
          </div>

          {selectedDispositionName === DEMO_BOOKED_NAME && (
            <div className="rounded-md border border-teal-200 bg-teal-50/40 p-4 space-y-3">
              <div className="text-sm font-medium text-teal-700">
                Demo details (the prospect will receive a confirmation email)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="demo-date">Demo Date *</Label>
                  <input
                    id="demo-date"
                    type="date"
                    value={demoDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setDemoDate(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="demo-time">Demo Time *</Label>
                  <input
                    id="demo-time"
                    type="time"
                    value={demoTime}
                    onChange={(e) => setDemoTime(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Product Specialist will be <strong>Amit Sengupta</strong>.
              </p>
            </div>
          )}

          {selectedDispositionCategory === "follow_up" &&
           filteredSubDispositions.some(sd => sd.id === formData.sub_disposition_id && sd.name.toLowerCase().includes("specific time")) && (
            <div className="space-y-2">
              <Label htmlFor="callback-datetime">Callback Date & Time *</Label>
              <DateTimePicker
                value={callbackDateTime}
                onChange={setCallbackDateTime}
                minDate={new Date()}
                label="Select callback date and time"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)} 
              className="flex-1"
            >
              Skip
            </Button>
            <Button 
              type="submit" 
              className="flex-1" 
              disabled={loading ||
                (selectedDispositionCategory === "follow_up" &&
                 filteredSubDispositions.some(sd => sd.id === formData.sub_disposition_id && sd.name.toLowerCase().includes("specific time")) &&
                 !callbackDateTime) ||
                (selectedDispositionName === DEMO_BOOKED_NAME && (!demoDate || !demoTime))}
            >
              {loading ? "Saving..." : "Save Disposition"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
