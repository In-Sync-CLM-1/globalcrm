import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { useNotification } from "@/hooks/useNotification";
import { useDispositionCatalog, AJIMOS_ORG_ID } from "@/components/Gaming/gamingStats";

interface SaveOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  onSaved?: () => void;
}

/** Ajimos: save the outcome of a call dialled by hand (own phone) from the Pipeline. */
export function SaveOutcomeDialog({ open, onOpenChange, contactId, contactName, onSaved }: SaveOutcomeDialogProps) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const { data: catalog } = useDispositionCatalog(AJIMOS_ORG_ID);
  const [loading, setLoading] = useState(false);
  const [dispositionId, setDispositionId] = useState("");
  const [subId, setSubId] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState<Date | null>(null);

  const subs = (catalog?.subs ?? []).filter((s) => s.disposition_id === dispositionId);

  const reset = () => { setDispositionId(""); setSubId(""); setNotes(""); setFollowUp(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispositionId) { notify.error("Outcome required", new Error("Please select an outcome")); return; }
    if (subs.length > 0 && !subId) { notify.error("Sub-option required", new Error("Please select a sub-option")); return; }
    setLoading(true);
    try {
      const { error } = await supabase.rpc("save_manual_call_outcome" as never, {
        _contact_id: contactId,
        _disposition_id: dispositionId,
        _sub_disposition_id: subId || null,
        _notes: notes || null,
        _follow_up_at: followUp?.toISOString() ?? null,
      } as never);
      if (error) throw error;
      notify.success("Outcome saved", "The call outcome has been saved");
      queryClient.invalidateQueries({ queryKey: ["pipeline-latest-dispositions"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-disposition-filter-ids"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["gaming-day-stats"] });
      queryClient.invalidateQueries({ queryKey: ["gaming-dispo-counts"] });
      queryClient.invalidateQueries({ queryKey: ["gaming-hourly-counts"] });
      reset();
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      notify.error("Error", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Save outcome</DialogTitle>
          <p className="text-sm text-muted-foreground">{contactName}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Outcome *</Label>
            <Select value={dispositionId} onValueChange={(v) => { setDispositionId(v); setSubId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
              <SelectContent>
                {(catalog?.dispositions ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {subs.length > 0 && (
            <div className="space-y-2">
              <Label>Sub-option *</Label>
              <Select value={subId} onValueChange={setSubId}>
                <SelectTrigger><SelectValue placeholder="Select sub-option" /></SelectTrigger>
                <SelectContent>
                  {subs.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="outcome-notes">Notes</Label>
            <Textarea id="outcome-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add any notes about this call..." />
          </div>
          <div className="space-y-2">
            <Label>Follow-up date and time (optional)</Label>
            <DateTimePicker value={followUp} onChange={setFollowUp} minDate={new Date()} label="Select follow-up date and time" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={loading}>{loading ? "Saving..." : "Save outcome"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
