import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PhoneCall, PhoneOff, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useNotification } from "@/hooks/useNotification";
import { useDispositionCatalog } from "@/components/Gaming/gamingStats";

export interface PhoneCallTarget { id: string; name: string }

interface RequestState {
  status: "waiting" | "dialling" | "done" | "cancelled" | "expired" | "failed";
  failure: string | null;
  call_log_id: string | null;
  duration: number | null;
  call_status: string | null;
}

interface PhoneCallDialogProps {
  orgId: string;
  /** The contact to call; null closes the dialog. */
  target: PhoneCallTarget | null;
  onClose: () => void;
  /** Next-call mode: the contact to call after this one's outcome is saved. */
  next?: PhoneCallTarget | null;
  onAdvance?: (next: PhoneCallTarget) => void;
}

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const NEXT_DELAY = 3;

/**
 * Click-to-call through the caller's own phone (In-Sync Phone app). The CRM asks the phone to dial,
 * waits for the phone to report the call, then asks for the outcome of that exact call.
 */
export function PhoneCallDialog({ orgId, target, onClose, next, onAdvance }: PhoneCallDialogProps) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const { data: catalog } = useDispositionCatalog(orgId);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [state, setState] = useState<RequestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispo, setDispo] = useState("");
  const [sub, setSub] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // The next contact as it stood when the outcome was saved; saving refreshes and reorders the list.
  const [queued, setQueued] = useState<PhoneCallTarget | null>(null);
  const attempt = useRef(0);

  const start = async () => {
    if (!target) return;
    const mine = ++attempt.current;
    setRequestId(null); setState(null); setError(null); setDispo(""); setSub(""); setNotes(""); setCountdown(null);
    const { data, error: err } = await supabase.rpc("request_phone_call" as never, { _contact_id: target.id } as never);
    if (mine !== attempt.current) {
      // Closed (or restarted) while the request was being sent: the phone must not dial it.
      if (data) await supabase.rpc("cancel_phone_call" as never, { _request_id: data as unknown as string } as never);
      return;
    }
    if (err) { setError(err.message); return; }
    setRequestId(data as unknown as string);
  };

  useEffect(() => {
    if (target) start();
    else { attempt.current++; setRequestId(null); setState(null); setError(null); setCountdown(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  // Follow the request until the phone reports the call (or gives up).
  useEffect(() => {
    if (!requestId) return;
    let stop = false;
    const tick = async () => {
      const { data } = await supabase.rpc("get_phone_call_request" as never, { _request_id: requestId } as never);
      if (stop) return;
      const s = data as unknown as RequestState | null;
      if (s) setState(s);
      if (!s || s.status === "waiting" || s.status === "dialling") timer = window.setTimeout(tick, 1500);
      else queryClient.invalidateQueries({ queryKey: ["gaming-day-stats"] });
    };
    let timer = window.setTimeout(tick, 800);
    return () => { stop = true; window.clearTimeout(timer); };
  }, [requestId, queryClient]);

  // Next-call mode: count down, then move on unless the caller stops it.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); if (queued && onAdvance) onAdvance(queued); return; }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, queued, onAdvance]);

  // Escape always stops the countdown, even when a message elsewhere on the page would take the key.
  const counting = countdown !== null;
  useEffect(() => {
    if (!counting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setCountdown(null);
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [counting, onClose]);

  const close = async () => {
    if (requestId && (state?.status === "waiting" || state?.status === "dialling" || !state)) {
      await supabase.rpc("cancel_phone_call" as never, { _request_id: requestId } as never);
    }
    onClose();
  };

  const subs = (catalog?.subs ?? []).filter((s) => s.disposition_id === dispo);

  const save = async () => {
    if (!state?.call_log_id || !dispo) return;
    if (subs.length > 0 && !sub) { notify.error("Pick a sub-option", ""); return; }
    setSaving(true);
    const { error: err } = await supabase.rpc("set_phone_call_outcome" as never, {
      _call_log_id: state.call_log_id, _disposition_id: dispo, _sub_disposition_id: sub || null, _notes: notes || null,
    } as never);
    setSaving(false);
    if (err) { notify.error("Outcome not saved", err); return; }
    // In Next-call mode the window itself says so; a message on top would also swallow the Escape key.
    if (!(next && onAdvance)) notify.success("Outcome saved", "");
    for (const key of [
      "pipeline-latest-dispositions", "pipeline-latest-sub-dispositions", "pipeline-disposition-filter-ids",
      "pipeline-contacts", "gaming-day-stats", "gaming-dispo-counts", "gaming-hourly-counts",
    ]) queryClient.invalidateQueries({ queryKey: [key] });
    if (next && onAdvance) { setQueued(next); setCountdown(NEXT_DELAY); }
    else onClose();
  };

  const status = state?.status;
  const answered = (state?.duration ?? 0) > 0;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Call {target?.name || "contact"} on your phone</DialogTitle>
          <DialogDescription>Your phone dials the number on its own SIM. The call and its length are saved here when it ends.</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <PhoneOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p>{error}</p>
          </div>
        ) : countdown !== null && queued ? (
          <div className="space-y-2 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Outcome saved.</p>
            <p>Calling the next contact, <b>{queued.name}</b>, in {countdown}…</p>
          </div>
        ) : status === "done" ? (
          <div className="space-y-4 py-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {answered ? `Call answered, ${fmtDur(state!.duration ?? 0)}` : "Call not answered"}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pc-outcome">Outcome</Label>
              <Select value={dispo || undefined} onValueChange={(v) => { setDispo(v); setSub(""); }}>
                <SelectTrigger id="pc-outcome"><SelectValue placeholder="Pick the outcome" /></SelectTrigger>
                <SelectContent>
                  {(catalog?.dispositions ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {subs.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="pc-sub">Sub-option</Label>
                <Select value={sub || undefined} onValueChange={setSub}>
                  <SelectTrigger id="pc-sub"><SelectValue placeholder="Pick a sub-option" /></SelectTrigger>
                  <SelectContent>
                    {subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pc-notes">Notes (optional)</Label>
              <Textarea id="pc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        ) : status === "failed" || status === "expired" || status === "cancelled" ? (
          <div className="flex items-start gap-3 rounded-md border border-amber-400/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <PhoneOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              {status === "expired" ? "Your phone did not pick up the request. Open the In-Sync Phone app on your phone and try again."
                : status === "cancelled" ? "This call was cancelled."
                : state?.failure || "The phone could not place the call."}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-3 text-sm">
            {status === "dialling" ? <PhoneCall className="h-5 w-5 animate-pulse text-emerald-600" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            <p>{status === "dialling" ? "Calling on your phone. This screen updates when the call ends." : "Sending the call to your phone…"}</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {countdown !== null ? (
            <Button variant="outline" onClick={() => { setCountdown(null); onClose(); }}>Stop calling</Button>
          ) : status === "done" ? (
            <>
              <Button variant="outline" onClick={onClose}>Skip outcome</Button>
              <Button onClick={save} disabled={!dispo || saving}>
                {saving ? "Saving…" : next ? "Save and call next" : "Save outcome"}
              </Button>
            </>
          ) : error || status === "failed" || status === "expired" || status === "cancelled" ? (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={start}>Try again</Button>
            </>
          ) : (
            <Button variant="outline" onClick={close}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
