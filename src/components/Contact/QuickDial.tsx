import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import { Checkbox } from "@/components/ui/checkbox";

interface CallSession {
  id: string;
  status: string;
  exotel_call_sid: string;
  started_at: string;
}

export const QuickDial = () => {
  const notify = useNotification();
  const [isOpen, setIsOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [saveAsContact, setSaveAsContact] = useState(false);
  const [isDialing, setIsDialing] = useState(false);
  const [activeSession, setActiveSession] = useState<CallSession | null>(null);
  const [duration, setDuration] = useState(0);

  const formatPhoneNumber = (value: string) => {
    // Remove all non-numeric characters
    const cleaned = value.replace(/\D/g, '');
    return cleaned;
  };

  const validatePhoneNumber = (phone: string) => {
    // Indian phone numbers: 10 digits
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length === 10;
  };

  const makeCall = async () => {
    if (!phoneNumber.trim()) {
      notify.error("Phone number required", "Please enter a phone number");
      return;
    }

    const cleanedPhone = formatPhoneNumber(phoneNumber);
    
    if (!validatePhoneNumber(cleanedPhone)) {
      notify.error("Invalid phone number", "Please enter a valid 10-digit phone number");
      return;
    }

    setIsDialing(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone, org_id')
        .eq('id', user.id)
        .single();

      if (!profile?.phone) {
        notify.error("Phone number required", "Please add your phone number in your profile settings");
        setIsDialing(false);
        return;
      }

      let contactId = null;

      // Create a temporary contact if user wants to save it
      if (saveAsContact && contactName.trim()) {
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            org_id: profile.org_id,
            first_name: contactName.split(' ')[0],
            last_name: contactName.split(' ').slice(1).join(' ') || null,
            phone: cleanedPhone,
            status: 'new',
            created_by: user.id,
          })
          .select()
          .single();

        if (contactError) {
          console.error('Error creating contact:', contactError);
        } else if (newContact) {
          contactId = newContact.id;
          notify.success("Contact created", `${contactName} has been added to your contacts`);
        }
      }

      // Make the call
      console.log('Initiating call with:', { contactId, agentPhone: profile.phone, customerPhone: cleanedPhone });
      
      const { data, error } = await supabase.functions.invoke('exotel-make-call', {
        body: {
          contactId: contactId,
          agentPhoneNumber: profile.phone,
          customerPhoneNumber: cleanedPhone,
        },
      });

      if (error) {
        console.error('Call error:', error);
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      notify.success("Call initiated", `Calling ${contactName || cleanedPhone}...`);

      setActiveSession({
        id: data.callLog.id,
        status: 'initiating',
        exotel_call_sid: data.exotelCallSid,
        started_at: new Date().toISOString(),
      });

      // Start duration counter
      const interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

      // Monitor call status
      monitorCallStatus(data.exotelCallSid, interval);

    } catch (error: any) {
      console.error('Error making call:', error);
      const errorMessage = error.message || error.error || 'Failed to initiate call';
      notify.error("Call failed", errorMessage);
      setIsDialing(false);
    }
  };

  const monitorCallStatus = async (callSid: string, interval: NodeJS.Timeout) => {
    const channel = supabase
      .channel(`quick-dial-${callSid}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_call_sessions',
          filter: `exotel_call_sid=eq.${callSid}`,
        },
        (payload) => {
          if (payload.new.status === 'ended') {
            clearInterval(interval);
            setActiveSession(null);
            setDuration(0);
            setIsDialing(false);
            notify.info("Call ended");
            resetForm();
            supabase.removeChannel(channel);
          } else {
            setActiveSession(payload.new as CallSession);
          }
        }
      )
      .subscribe();
  };

  const endCall = async () => {
    if (!activeSession) return;
    
    try {
      await supabase
        .from('agent_call_sessions')
        .update({ 
          status: 'ended',
          ended_at: new Date().toISOString()
        })
        .eq('id', activeSession.id);

      notify.success("Call ended");
      setActiveSession(null);
      setDuration(0);
      setIsDialing(false);
      resetForm();
    } catch (error: any) {
      console.error('Error ending call:', error);
      notify.error("Failed to end call", error.message);
    }
  };

  const resetForm = () => {
    setPhoneNumber("");
    setContactName("");
    setSaveAsContact(false);
    setIsOpen(false);
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 w-full">
          <Phone className="h-4 w-4" />
          Quick Dial
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick Dial</DialogTitle>
        </DialogHeader>
        
        {activeSession ? (
          <div className="space-y-4">
            <div className="p-4 border rounded-lg bg-accent/10">
              <div className="flex items-center justify-between mb-2">
                <div className={`flex items-center gap-2 ${getStatusColor(activeSession.status)}`}>
                  <Phone className="h-5 w-5 animate-pulse" />
                  <span className="font-semibold capitalize">{activeSession.status}</span>
                </div>
                <span className="text-2xl font-mono">{formatDuration(duration)}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {contactName || phoneNumber}
              </div>
            </div>
            
            <Button
              variant="destructive"
              onClick={endCall}
              className="w-full gap-2"
            >
              <PhoneOff className="h-4 w-4" />
              End Call
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="Enter 10-digit phone number"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(formatPhoneNumber(e.target.value))}
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                Enter without country code (e.g., 9876543210)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Contact Name (Optional)</Label>
              <Input
                id="name"
                placeholder="Name for reference"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="save"
                checked={saveAsContact}
                onCheckedChange={(checked) => setSaveAsContact(checked as boolean)}
              />
              <label
                htmlFor="save"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Save as new contact
              </label>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={makeCall}
                disabled={isDialing || !phoneNumber}
                className="flex-1 gap-2"
              >
                {isDialing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Calling...
                  </>
                ) : (
                  <>
                    <Phone className="h-4 w-4" />
                    Call Now
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={resetForm}
                disabled={isDialing}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
