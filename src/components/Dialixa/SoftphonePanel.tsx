import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown, Grid3x3, Headphones, Loader2, Mic, MicOff, Pause, Phone, PhoneCall, PhoneIncoming, PhoneOff, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useNotification } from "@/hooks/useNotification";
import { AJIMOS_ORG_ID, useDispositionCatalog } from "@/components/Gaming/gamingStats";
import type { PhoneCallTarget } from "@/components/PhoneApp/PhoneCallDialog";
import type { DialixaCallState, PanelLine } from "./DialixaProvider";
import { useDialixaStatus } from "@/hooks/useDialixa";

const LINE: Record<PanelLine, { text: string; dot: string }> = {
  ready: { text: "Ready for calls", dot: "bg-emerald-500" },
  connecting: { text: "Connecting…", dot: "bg-amber-500" },
  offline: { text: "Not connected", dot: "bg-red-500" },
  refused: { text: "Dialixa refused your login", dot: "bg-red-500" },
  "other-tab": { text: "Softphone is open in another tab", dot: "bg-slate-400" },
  off: { text: "Calls ring in your Dialixa softphone", dot: "bg-sky-500" },
};
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const NEXT_DELAY = 3; // used when the admin has not set a gap
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

interface Props {
  extension: string;
  line: PanelLine;
  call: DialixaCallState | null;
  muted: boolean;
  held: boolean;
  next: PhoneCallTarget | null;
  onHangup: () => void;
  onAnswer: () => void;
  onClose: () => void;
  onSaved: (queued: PhoneCallTarget | null) => void;
  onAdvance: () => void;
  onRetry: () => void;
  onMute: (m: boolean) => void;
  onHold: (h: boolean) => void;
  onTone: (t: string) => void;
}

/** The softphone at the bottom of every screen. It shows the player's name, never the number. */
export function SoftphonePanel(p: Props) {
  const { call, line } = p;
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState(false);
  const [now, setNow] = useState(Date.now());

  const phase = call?.phase;
  useEffect(() => { if (phase) setOpen(true); }, [phase]);
  useEffect(() => { if (phase !== "talking") setKeys(false); }, [phase]);
  useEffect(() => {
    if (phase !== "talking") return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  if (pathname === "/" || pathname === "/login") return null;
  const name = call?.contact?.name || "Unknown number";

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${LINE[line].dot}`} />
        <Headphones className="h-4 w-4" /> {call ? name : "Softphone"}
      </button>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 z-40 w-[min(340px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto p-4 shadow-xl">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${LINE[line].dot}`} />
        <span className="flex-1">{LINE[line].text} · Extension {p.extension}</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide the softphone"><ChevronDown className="h-4 w-4" /></button>
      </div>

      {!call && (
        <p className="pt-3 text-sm text-muted-foreground">Press Call on a player to start.</p>
      )}

      {call && phase !== "next" && <p className="pt-3 text-base font-semibold">{name}</p>}

      {(phase === "starting" || phase === "ringing") && (
        <>
          <p className="flex items-center gap-2 py-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> {phase === "starting" ? "Starting the call…" : "Connecting your softphone…"}
          </p>
          <Button variant="destructive" className="w-full" onClick={p.onHangup}><PhoneOff className="mr-2 h-4 w-4" /> Cancel</Button>
        </>
      )}

      {phase === "incoming" && (
        <>
          <p className="flex items-center gap-2 py-2 text-sm"><PhoneIncoming className="h-4 w-4 animate-pulse text-emerald-600" /> Incoming call</p>
          <div className="grid grid-cols-2 gap-2">
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={p.onAnswer}><Phone className="mr-2 h-4 w-4" /> Answer</Button>
            <Button variant="destructive" onClick={p.onHangup}><PhoneOff className="mr-2 h-4 w-4" /> Decline</Button>
          </div>
        </>
      )}

      {phase === "talking" && (
        <>
          <p className="flex items-center gap-2 py-2 text-sm">
            <PhoneCall className="h-4 w-4 text-emerald-600" /> {p.held ? "On hold" : "Line open"}
            <span className="ml-auto font-mono text-base">{clock(Math.max(0, Math.floor((now - (call?.since ?? now)) / 1000)))}</span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant={p.muted ? "default" : "outline"} size="sm" onClick={() => p.onMute(!p.muted)}>
              {p.muted ? <MicOff className="mr-1 h-4 w-4" /> : <Mic className="mr-1 h-4 w-4" />}{p.muted ? "Unmute" : "Mute"}
            </Button>
            <Button variant={p.held ? "default" : "outline"} size="sm" onClick={() => p.onHold(!p.held)}>
              {p.held ? <Play className="mr-1 h-4 w-4" /> : <Pause className="mr-1 h-4 w-4" />}{p.held ? "Resume" : "Hold"}
            </Button>
            <Button variant={keys ? "default" : "outline"} size="sm" onClick={() => setKeys(!keys)}><Grid3x3 className="mr-1 h-4 w-4" />Keys</Button>
          </div>
          {keys && (
            <div className="mt-2 grid grid-cols-3 gap-1">
              {KEYS.map((k) => <Button key={k} variant="outline" size="sm" onClick={() => p.onTone(k)}>{k}</Button>)}
            </div>
          )}
          <Button variant="destructive" className="mt-2 w-full" onClick={p.onHangup}><PhoneOff className="mr-2 h-4 w-4" /> Hang up</Button>
        </>
      )}

      {phase === "failed" && (
        <>
          <p className="my-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">{call?.error || "The call could not be started."}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={p.onClose}>Close</Button>
            <Button onClick={p.onRetry}>Try again</Button>
          </div>
        </>
      )}

      {phase === "outcome" && call?.callId && (
        <Outcome key={call.callId} callId={call.callId} answeredElsewhere={!call.since && line !== "ready"} next={p.next} onClose={p.onClose} onSaved={p.onSaved} />
      )}
      {phase === "outcome" && !call?.callId && (
        <>
          <p className="py-2 text-sm">The call ended.</p>
          <Button variant="outline" className="w-full" onClick={p.onClose}>Close</Button>
        </>
      )}

      {phase === "next" && <NextCall key={call?.contact?.id} name={name} onAdvance={p.onAdvance} onStop={p.onClose} />}
    </Card>
  );
}

function Outcome({ callId, answeredElsewhere, next, onClose, onSaved }: {
  callId: string;
  answeredElsewhere: boolean;
  next: PhoneCallTarget | null;
  onClose: () => void;
  onSaved: (queued: PhoneCallTarget | null) => void;
}) {
  const notify = useNotification();
  const { data: catalog } = useDispositionCatalog(AJIMOS_ORG_ID);
  const [dispo, setDispo] = useState("");
  const [sub, setSub] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const subs = (catalog?.subs ?? []).filter((s) => s.disposition_id === dispo);

  const save = async () => {
    if (subs.length > 0 && !sub) { notify.error("Pick a sub-option", ""); return; }
    // Saving reorders the list, so the next player is fixed now.
    const queued = next;
    setSaving(true);
    const { error } = await supabase.rpc("dialixa_save_outcome" as never, {
      _call_id: callId, _disposition_id: dispo, _sub_disposition_id: sub || null, _notes: notes || null,
    } as never);
    setSaving(false);
    if (error) { notify.error("Outcome not saved", error); return; }
    onSaved(queued);
  };

  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm">
        {answeredElsewhere ? "Answer the call in your Dialixa softphone. Pick the outcome when it ends." : "Call ended. Pick the outcome."}
      </p>
      <div className="space-y-1">
        <Label htmlFor="dx-outcome">Outcome</Label>
        <Select value={dispo || undefined} onValueChange={(v) => { setDispo(v); setSub(""); }}>
          <SelectTrigger id="dx-outcome"><SelectValue placeholder="Pick the outcome" /></SelectTrigger>
          <SelectContent>{(catalog?.dispositions ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {subs.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="dx-sub">Sub-option</Label>
          <Select key={dispo} value={sub || undefined} onValueChange={setSub}>
            <SelectTrigger id="dx-sub"><SelectValue placeholder="Pick a sub-option" /></SelectTrigger>
            <SelectContent>{subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="dx-notes">Notes (optional)</Label>
        <Textarea id="dx-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onClose}>Skip outcome</Button>
        <Button onClick={save} disabled={!dispo || saving}>{saving ? "Saving…" : next ? "Save, call next" : "Save outcome"}</Button>
      </div>
    </div>
  );
}

function NextCall({ name, onAdvance, onStop }: { name: string; onAdvance: () => void; onStop: () => void }) {
  const { data: status } = useDialixaStatus();
  const [left, setLeft] = useState(status?.next_call_gap ?? NEXT_DELAY);
  useEffect(() => {
    if (left <= 0) { onAdvance(); return; }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);
  return (
    <div className="space-y-3 pt-3">
      <p className="text-sm">Outcome saved. Calling <b>{name}</b> in {Math.max(left, 0)}…</p>
      <Button variant="outline" className="w-full" onClick={onStop}>Stop calling</Button>
    </div>
  );
}
