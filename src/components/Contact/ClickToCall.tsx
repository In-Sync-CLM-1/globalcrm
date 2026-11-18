import { useState, useEffect } from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { format } from "date-fns";

interface ClickToCallProps {
  contactId: string;
  phoneNumber: string;
  /** Full number to show on the call screens (organisations that use full phone view). */
  displayPhone?: string | null;
  contactName: string;
}

interface CallSession {
  id: string;
  status: string;
  exotel_call_sid: string;
  started_at: string;
}

interface Disposition {
  id: string;
  name: string;
  category: string;
}

interface SubDisposition {
  id: string;
  name: string;
  disposition_id: string;
}

export const ClickToCall = ({ contactId, phoneNumber, displayPhone, contactName }: ClickToCallProps) => {
  const notify = useNotification();
  const [isLoading, setIsLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<CallSession | null>(null);
  const [duration, setDuration] = useState(0);
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [subDispositions, setSubDispositions] = useState<SubDisposition[]>([]);
  const [selectedDisposition, setSelectedDisposition] = useState("");
  const [selectedSubDisposition, setSelectedSubDisposition] = useState("");
  const [notes, setNotes] = useState("");
  const [completedCallLogId, setCompletedCallLogId] = useState<string | null>(null);
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [agentPhone, setAgentPhone] = useState("");
  const [callbackDateTime, setCallbackDateTime] = useState<Date | null>(null);
  const [selectedDispositionCategory, setSelectedDispositionCategory] = useState<string>("");

  useEffect(() => {
    checkActiveSession();
    fetchDispositions();

    // Subscribe to call session changes
    const channel = supabase
      .channel('call-session-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_call_sessions'
        },
        (payload) => {
          if (payload.new && 'contact_id' in payload.new && payload.new.contact_id === contactId) {
            setActiveSession(payload.new as CallSession);
            if (payload.new.status === 'ended') {
              handleCallEnded();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeSession && activeSession.status !== 'ended') {
      interval = setInterval(() => {
        const elapsed = Math.floor(
          (new Date().getTime() - new Date(activeSession.started_at).getTime()) / 1000
        );
        setDuration(elapsed);
        
        // Watchdog timeout - if call exceeds 1 hour, assume it's stuck
        if (elapsed > 3600) {
          console.warn('Call session exceeded 1 hour - clearing stuck session');
          setActiveSession(null);
          setDuration(0);
          notify.info(
            'Call Session Timeout',
            'Call session timed out in CRM. Check call logs for actual call details.'
          );
          clearInterval(interval);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeSession, notify]);

  const checkActiveSession = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('agent_call_sessions')
      .select('*')
      .eq('agent_id', user.id)
      .eq('contact_id', contactId)
      .neq('status', 'ended')
      .single();

    if (data) {
      setActiveSession(data);
    }
  };

  const fetchDispositions = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (!profile) return;

    const { data: dispData } = await supabase
      .from('call_dispositions')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('name');

    const { data: subDispData } = await supabase
      .from('call_sub_dispositions')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('name');

    if (dispData) setDispositions(dispData);
    if (subDispData) setSubDispositions(subDispData);
  };

  const handleCallEnded = async () => {
    // Get the completed call log
    const { data } = await supabase
      .from('call_logs')
      .select('id')
      .eq('exotel_call_sid', activeSession?.exotel_call_sid)
      .single();

    if (data) {
      setCompletedCallLogId(data.id);
      setShowDisposition(true);
    }
  };

  const makeCall = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single();

      if (!profile?.phone) {
        notify.error("Phone number required", "Please add your phone number in your profile settings");
        return;
      }

      const { data, error } = await supabase.functions.invoke('exotel-make-call', {
        body: {
          contactId,
          agentPhoneNumber: profile.phone,
        },
      });

      if (error) throw error;

      notify.success("Call initiated", `Calling ${contactName}...`);

      setActiveSession({
        id: data.callLog.id,
        status: 'initiating',
        exotel_call_sid: data.exotelCallSid,
        started_at: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Error making call:', error);
      notify.error("Call failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  const endCall = async () => {
    if (!activeSession) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Update the agent_call_sessions to ended status
      const { error } = await supabase
        .from('agent_call_sessions')
        .update({ 
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('id', activeSession.id);

      if (error) throw error;

      // Immediately update local state to reflect ended status
      const updatedSession = {
        ...activeSession,
        status: 'ended',
        ended_at: new Date().toISOString()
      };
      setActiveSession(updatedSession);
      
      notify.success("Call ended", "Call has been disconnected");
      
      // Trigger the disposition dialog
      handleCallEnded();
    } catch (error: any) {
      console.error('Error ending call:', error);
      notify.error("Failed to end call", error.message);
    }
  };

  const saveDisposition = async () => {
    if (!completedCallLogId || !selectedDisposition) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Update call log with disposition
      await supabase
        .from('call_logs')
        .update({
          disposition_id: selectedDisposition,
          sub_disposition_id: selectedSubDisposition || null,
          notes,
        })
        .eq('id', completedCallLogId);

      // Check if activity already exists
      const { data: callLog } = await supabase
        .from('call_logs')
        .select('activity_id, org_id')
        .eq('id', completedCallLogId)
        .single();

      if (callLog?.activity_id) {
        // Update existing activity
        await supabase
          .from('contact_activities')
          .update({
            call_disposition_id: selectedDisposition,
            call_sub_disposition_id: selectedSubDisposition || null,
            description: notes ? `${notes}\n\nCall duration: ${formatDuration(duration)}` : `Call duration: ${formatDuration(duration)}`,
            completed_at: new Date().toISOString(),
            next_action_date: callbackDateTime?.toISOString() || null,
            next_action_notes: callbackDateTime ? `Callback scheduled for ${format(callbackDateTime, "PPP 'at' p")}` : null,
          })
          .eq('id', callLog.activity_id);
      } else {
        // Create new activity if it doesn't exist yet
        const { data: newActivity } = await supabase
          .from('contact_activities')
          .insert({
            org_id: callLog!.org_id,
            contact_id: contactId,
            activity_type: 'call',
            subject: 'Phone Call',
            description: notes ? `${notes}\n\nCall duration: ${formatDuration(duration)}` : `Call duration: ${formatDuration(duration)}`,
            call_disposition_id: selectedDisposition,
            call_sub_disposition_id: selectedSubDisposition || null,
            call_duration: duration,
            created_by: user.id,
            completed_at: new Date().toISOString(),
            next_action_date: callbackDateTime?.toISOString() || null,
            next_action_notes: callbackDateTime ? `Callback scheduled for ${format(callbackDateTime, "PPP 'at' p")}` : null,
          })
          .select()
          .single();

        // Link activity back to call log
        if (newActivity) {
          await supabase
            .from('call_logs')
            .update({ activity_id: newActivity.id })
            .eq('id', completedCallLogId);
        }
      }

      notify.success("Disposition saved", "Call disposition has been recorded");

      setShowDisposition(false);
      setActiveSession(null);
      setSelectedDisposition("");
      setSelectedSubDisposition("");
      setNotes("");
      setDuration(0);
      setCallbackDateTime(null);
      setSelectedDispositionCategory("");
    } catch (error: any) {
      console.error('Error saving disposition:', error);
      notify.error("Error", error.message);
    }
  };

  const handleSavePhone = async () => {
    if (!agentPhone.trim()) {
      notify.error("Please enter your phone number");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .update({ phone: agentPhone })
        .eq('id', user.id);

      if (error) throw error;

      notify.success("Phone number saved successfully");
      setShowPhoneInput(false);
      // Now try to make the call again
      makeCall();
    } catch (error) {
      console.error('Error saving phone:', error);
      notify.error("Failed to save phone number", error);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'initiating': return 'text-yellow-500';
      case 'ringing': return 'text-blue-500';
      case 'connected': return 'text-green-500';
      default: return 'text-muted-foreground';
    }
  };

  const filteredSubDispositions = subDispositions.filter(
    sd => sd.disposition_id === selectedDisposition
  );

  if (activeSession && activeSession.status !== 'ended') {
    return (
      <div className="flex items-center gap-2 p-2 border rounded-lg bg-accent/10">
        <div className={`flex items-center gap-2 ${getStatusColor(activeSession.status)}`}>
          <Phone className="h-4 w-4 animate-pulse" />
          <span className="text-sm font-medium capitalize">{activeSession.status}</span>
        </div>
        <span className="text-sm font-mono">{formatDuration(duration)}</span>
        <Button
          size="sm"
          variant="destructive"
          onClick={endCall}
          className="ml-auto"
          title="End Call"
        >
          <PhoneOff className="h-4 w-4 mr-1" />
          End
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        size="icon"
        variant="default"
        onClick={makeCall}
        disabled={isLoading}
        title="Call"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Phone className="h-4 w-4" />
        )}
      </Button>

      <Dialog open={showDisposition} onOpenChange={setShowDisposition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call Disposition</DialogTitle>
            {displayPhone && <p className="text-sm font-mono tabular-nums">{contactName} · {displayPhone}</p>}
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Call Duration</Label>
              <p className="text-sm text-muted-foreground">{formatDuration(duration)}</p>
            </div>

            <div>
              <Label>Disposition *</Label>
              <Select 
                value={selectedDisposition} 
                onValueChange={(value) => {
                  setSelectedDisposition(value);
                  const disp = dispositions.find(d => d.id === value);
                  setSelectedDispositionCategory(disp?.category || "");
                  setSelectedSubDisposition("");
                  setCallbackDateTime(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select disposition" />
                </SelectTrigger>
                <SelectContent>
                  {dispositions.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filteredSubDispositions.length > 0 && (
              <div>
                <Label>Sub-Disposition</Label>
                <Select value={selectedSubDisposition} onValueChange={setSelectedSubDisposition}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sub-disposition" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSubDispositions.map(sd => (
                      <SelectItem key={sd.id} value={sd.id}>
                        {sd.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about the call..."
                rows={3}
              />
            </div>

            {selectedDispositionCategory === "follow_up" && 
             filteredSubDispositions.some(sd => sd.id === selectedSubDisposition && sd.name.toLowerCase().includes("specific time")) && (
              <div>
                <Label>Callback Date & Time *</Label>
                <DateTimePicker
                  value={callbackDateTime}
                  onChange={setCallbackDateTime}
                  minDate={new Date()}
                  label="Select callback date and time"
                />
              </div>
            )}

            <Button
              onClick={saveDisposition}
              disabled={!selectedDisposition || 
                (selectedDispositionCategory === "follow_up" && 
                 filteredSubDispositions.some(sd => sd.id === selectedSubDisposition && sd.name.toLowerCase().includes("specific time")) && 
                 !callbackDateTime)}
              className="w-full"
            >
              Save Disposition
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Phone Number Input Dialog */}
      <Dialog open={showPhoneInput} onOpenChange={setShowPhoneInput}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Your Phone Number</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              To make calls, please add your phone number. This is the number that will be used to connect your calls.
            </p>
            <div className="space-y-2">
              <Label htmlFor="agent-phone">Your Phone Number</Label>
              <input
                id="agent-phone"
                type="tel"
                placeholder="Enter your phone number"
                value={agentPhone}
                onChange={(e) => setAgentPhone(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSavePhone} className="flex-1">
                Save and Call
              </Button>
              <Button variant="outline" onClick={() => setShowPhoneInput(false)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
