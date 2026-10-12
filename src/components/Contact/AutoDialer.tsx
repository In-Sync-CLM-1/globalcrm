import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Phone, Pause, Play, SkipForward, X, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useUrlState } from "@/hooks/useUrlState";

interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
}

interface AutoDialerProps {
  preSelectedContacts?: string[];
}

export const AutoDialer = ({ preSelectedContacts = [] }: AutoDialerProps) => {
  const notify = useNotification();
  const [isOpen, setIsOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDialing, setIsDialing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'completed'>('idle');
  const [activeCallSession, setActiveCallSession] = useState<string | null>(null);
  const [filterPipeline, setFilterPipeline] = useUrlState<string>("pipeline", "all");
  const [pipelines, setPipelines] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchPipelines();
      if (preSelectedContacts && preSelectedContacts.length > 0) {
        fetchPreSelectedContacts();
      } else {
        fetchContacts();
      }
    }
  }, [isOpen, filterPipeline, preSelectedContacts]);

  const fetchPipelines = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (!profile) return;

    const { data } = await supabase
      .from('pipeline_stages')
      .select('id, name')
      .eq('org_id', profile.org_id)
      .order('display_order');

    if (data) setPipelines(data);
  };

  const fetchPreSelectedContacts = async () => {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, phone, email, company')
      .in('id', preSelectedContacts!)
      .not('phone', 'is', null);

    if (data) {
      setContacts(data);
    }
  };

  const fetchContacts = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();

    if (!profile) return;

    let query = supabase
      .from('contacts')
      .select('id, first_name, last_name, phone, email, company, pipeline_stage_id')
      .eq('org_id', profile.org_id)
      .not('phone', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (filterPipeline !== "all") {
      query = query.eq('pipeline_stage_id', filterPipeline);
    }

    const { data } = await query;

    if (data) {
      setContacts(data);
    }
  };

  const startAutoDialer = async () => {
    if (contacts.length === 0) {
      notify.error("No contacts to dial", "Please add contacts with phone numbers");
      return;
    }

    setIsDialing(true);
    setIsPaused(false);
    dialNextContact();
  };

  const dialNextContact = async () => {
    if (currentIndex >= contacts.length) {
      notify.success("Auto-dialing complete", `Called ${contacts.length} contacts`);
      setIsDialing(false);
      setCallStatus('completed');
      return;
    }

    const contact = contacts[currentIndex];
    if (!contact.phone) {
      setCurrentIndex(prev => prev + 1);
      return;
    }

    try {
      setCallStatus('calling');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single();

      if (!profile?.phone) {
        notify.error("Phone number required", "Please add your phone number in profile settings");
        setIsDialing(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('exotel-make-call', {
        body: {
          contactId: contact.id,
          agentPhoneNumber: profile.phone,
          customerPhoneNumber: contact.phone,
        },
      });

      if (error) throw error;

      setActiveCallSession(data.exotelCallSid);
      setCallStatus('connected');
      
      notify.success("Calling", `Dialing ${contact.first_name} ${contact.last_name || ''}`);

      // Monitor call status
      monitorCallStatus(data.exotelCallSid);

    } catch (error: any) {
      console.error('Error making call:', error);
      notify.error("Call failed", error.message);
      // Skip to next contact on error
      setCurrentIndex(prev => prev + 1);
      if (!isPaused) {
        setTimeout(() => dialNextContact(), 2000);
      }
    }
  };

  const monitorCallStatus = async (callSid: string) => {
    const channel = supabase
      .channel(`auto-dial-${callSid}`)
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
            setCallStatus('idle');
            setActiveCallSession(null);
            setCurrentIndex(prev => prev + 1);
            
            // Auto-dial next after 3 seconds if not paused
            if (!isPaused && isDialing) {
              setTimeout(() => dialNextContact(), 3000);
            }
            
            supabase.removeChannel(channel);
          }
        }
      )
      .subscribe();
  };

  const pauseAutoDialer = () => {
    setIsPaused(true);
    notify.info("Auto-dialer paused", "Click Resume to continue");
  };

  const resumeAutoDialer = () => {
    setIsPaused(false);
    if (callStatus === 'idle') {
      dialNextContact();
    }
  };

  const skipContact = () => {
    if (activeCallSession) {
      // End current call
      endCurrentCall();
    }
    setCurrentIndex(prev => prev + 1);
    if (!isPaused && isDialing) {
      setTimeout(() => dialNextContact(), 1000);
    }
  };

  const endCurrentCall = async () => {
    if (!activeCallSession) return;

    try {
      const { data: session } = await supabase
        .from('agent_call_sessions')
        .select('id')
        .eq('exotel_call_sid', activeCallSession)
        .single();

      if (session) {
        await supabase
          .from('agent_call_sessions')
          .update({ 
            status: 'ended',
            ended_at: new Date().toISOString()
          })
          .eq('id', session.id);
      }

      setActiveCallSession(null);
      setCallStatus('idle');
    } catch (error) {
      console.error('Error ending call:', error);
    }
  };

  const stopAutoDialer = () => {
    if (activeCallSession) {
      endCurrentCall();
    }
    setIsDialing(false);
    setIsPaused(false);
    setCurrentIndex(0);
    setCallStatus('idle');
    notify.info("Auto-dialer stopped");
  };

  const progress = contacts.length > 0 ? (currentIndex / contacts.length) * 100 : 0;
  const currentContact = contacts[currentIndex];

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <Phone className="h-4 w-4" />
        Auto-Dialer
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Auto-Dialer
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Filter Section */}
            {!preSelectedContacts.length && (
              <div>
                <Label>Filter by Pipeline Stage</Label>
                <Select value={filterPipeline} onValueChange={setFilterPipeline}>
                  <SelectTrigger>
                    <SelectValue placeholder="All contacts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All contacts</SelectItem>
                    {pipelines.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Progress Section */}
            <Card className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {currentIndex} of {contacts.length} contacts
                  </span>
                  <Badge variant={callStatus === 'connected' ? 'default' : 'secondary'}>
                    {callStatus === 'calling' && 'Calling...'}
                    {callStatus === 'connected' && 'Connected'}
                    {callStatus === 'idle' && 'Idle'}
                    {callStatus === 'completed' && 'Completed'}
                  </Badge>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </Card>

            {/* Current Contact */}
            {currentContact && (
              <Card className="p-4 bg-accent/10">
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold">
                        {currentContact.first_name} {currentContact.last_name}
                      </h4>
                      {currentContact.company && (
                        <p className="text-sm text-muted-foreground">{currentContact.company}</p>
                      )}
                    </div>
                    {callStatus === 'connected' && (
                      <Badge variant="default" className="animate-pulse">
                        On Call
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-mono">{currentContact.phone}</span>
                    {currentContact.email && (
                      <span className="text-muted-foreground">{currentContact.email}</span>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Control Buttons */}
            <div className="flex items-center gap-2">
              {!isDialing ? (
                <Button onClick={startAutoDialer} className="flex-1 gap-2">
                  <Play className="h-4 w-4" />
                  Start Auto-Dialing
                </Button>
              ) : (
                <>
                  {isPaused ? (
                    <Button onClick={resumeAutoDialer} className="flex-1 gap-2">
                      <Play className="h-4 w-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button onClick={pauseAutoDialer} variant="secondary" className="flex-1 gap-2">
                      <Pause className="h-4 w-4" />
                      Pause
                    </Button>
                  )}
                  <Button onClick={skipContact} variant="outline" size="icon" title="Skip Contact">
                    <SkipForward className="h-4 w-4" />
                  </Button>
                  <Button onClick={stopAutoDialer} variant="destructive" size="icon" title="Stop">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>

            {/* Contact List Preview */}
            <div className="max-h-48 overflow-y-auto border rounded-lg">
              <div className="p-2 space-y-1">
                {contacts.map((contact, idx) => (
                  <div
                    key={contact.id}
                    className={`p-2 text-sm rounded ${
                      idx === currentIndex
                        ? 'bg-primary/10 border-l-2 border-primary'
                        : idx < currentIndex
                        ? 'opacity-50'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>
                        {idx + 1}. {contact.first_name} {contact.last_name}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {contact.phone}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
