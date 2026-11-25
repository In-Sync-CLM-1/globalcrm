import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { useNotification } from "@/hooks/useNotification";
import { useDialixaStatus } from "@/hooks/useDialixa";
import type { PhoneCallTarget } from "@/components/PhoneApp/PhoneCallDialog";
import { Softphone, type LineState, type SoftphoneLogin } from "./softphone";
import { SoftphonePanel } from "./SoftphonePanel";

export type CallPhase =
  | "starting"   // asking Dialixa for the call
  | "ringing"    // the caller's softphone is about to ring / is ringing
  | "incoming"   // someone is calling this extension
  | "talking"    // the softphone line is open
  | "outcome"    // line closed (or Dialixa's own softphone is used): pick the outcome
  | "failed"
  | "next";      // Next-call mode countdown

export interface DialixaCallState {
  phase: CallPhase;
  callId: string | null;
  contact: PhoneCallTarget | null;
  direction: "outbound" | "inbound";
  error?: string;
  since?: number;
}

export interface StartHandlers {
  onClose: () => void;
  onAdvance?: (n: PhoneCallTarget) => void;
}

/** Where the softphone line of this tab stands; "off" = calls ring in Dialixa's own softphone. */
export type PanelLine = LineState | "off" | "other-tab";

interface DialixaContextValue {
  start: (target: PhoneCallTarget, handlers?: StartHandlers) => boolean;
  setNext: (n: PhoneCallTarget | null) => void;
  /** The page that started a call has gone: the call carries on, Next-call mode stops. */
  detach: (handlers: StartHandlers) => void;
}

const Ctx = createContext<DialixaContextValue>({ start: () => false, setNext: () => undefined, detach: () => undefined });
export const useDialixa = () => useContext(Ctx);

/** Dialixa rings the caller's extension within this time of a click, so that ring is answered for them. */
const RING_WAIT_MS = 45_000;

/** Ajimos only: keeps the softphone line open while the caller moves between pages. */
export function DialixaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: status } = useDialixaStatus();
  const api = useRef<DialixaContextValue | null>(null);
  const value = useMemo<DialixaContextValue>(() => ({
    start: (t, h) => api.current?.start(t, h) ?? false,
    setNext: (n) => api.current?.setNext(n),
    detach: (h) => api.current?.detach(h),
  }), []);
  // The pages stay mounted as they are whether or not the softphone is on.
  return (
    <Ctx.Provider value={value}>
      {children}
      {user && status?.enabled && status.extension && (
        <ActiveDialixa key={user.id} api={api} softphone={!!status.softphone} extension={status.extension} />
      )}
    </Ctx.Provider>
  );
}

function ActiveDialixa({ api, softphone, extension }: {
  api: MutableRefObject<DialixaContextValue | null>;
  softphone: boolean;
  extension: string;
}) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [line, setLine] = useState<PanelLine>(softphone ? "connecting" : "off");
  const [call, setCallState] = useState<DialixaCallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [next, setNextState] = useState<PhoneCallTarget | null>(null);
  const callRef = useRef<DialixaCallState | null>(null);
  const lineRef = useRef<PanelLine>(line);
  const phone = useRef<Softphone | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const handlers = useRef<StartHandlers | null>(null);
  const autoAnswerUntil = useRef(0);
  const ringNo = useRef(0);

  const setCall = useCallback((c: DialixaCallState | null) => { callRef.current = c; setCallState(c); }, []);
  const changeLine = useCallback((l: PanelLine) => { lineRef.current = l; setLine(l); }, []);
  const patch = useCallback((p: Partial<DialixaCallState>) => {
    if (callRef.current) setCall({ ...callRef.current, ...p });
  }, [setCall]);

  const report = (callId: string | null, event: "answered" | "ended") => {
    if (callId) supabase.rpc("dialixa_report_line" as never, { _call_id: callId, _event: event } as never).then(() => undefined);
  };

  // One softphone line per caller: the first CRM tab holds it, the next one takes over when that closes.
  useEffect(() => {
    if (!softphone) { changeLine("off"); return; }
    let stopped = false;
    let release: (() => void) | undefined;
    const abort = new AbortController();

    const run = async () => {
      const { data } = await supabase.rpc("my_dialixa_softphone" as never);
      const login = data as unknown as SoftphoneLogin | null;
      if (stopped || !audio.current) return;
      if (!login) { changeLine("off"); return; }
      const p = new Softphone(login, audio.current, {
        onLine: changeLine,
        onRinging: async (number) => {
          const mine = ++ringNo.current;
          const c = callRef.current;
          if (c && (c.phase === "starting" || c.phase === "ringing") && Date.now() < autoAnswerUntil.current) {
            autoAnswerUntil.current = 0;
            try { await p.answer(); } catch {
              try { await p.decline(); } catch { /* already gone */ }
              patch({ phase: "failed", error: "The microphone could not be used. Allow it for this site and try again." });
            }
            return;
          }
          // An unsaved outcome is never lost to a new call.
          if (c) {
            try { await p.decline(); } catch { /* caller gave up */ }
            notify.error("A call was declined", "It came in while your last call was still open here.");
            return;
          }
          setCall({ phase: "incoming", callId: null, contact: null, direction: "inbound" });
          const { data: who } = await supabase.rpc("dialixa_begin_incoming" as never, { _number: number } as never);
          const w = who as unknown as { call_id: string; contact_id: string; name: string } | null;
          const now = callRef.current;
          if (w && mine === ringNo.current && now?.direction === "inbound" && !now.callId) {
            patch({ callId: w.call_id, contact: { id: w.contact_id, name: w.name } });
            if (now.phase === "talking") report(w.call_id, "answered");
          }
        },
        onAnswered: () => {
          setMuted(false); setHeld(false);
          if (callRef.current) {
            report(callRef.current.callId, "answered");
            patch({ phase: "talking", since: Date.now() });
          }
        },
        onEnded: () => {
          setMuted(false); setHeld(false);
          autoAnswerUntil.current = 0;
          const c = callRef.current;
          if (!c || c.phase === "outcome" || c.phase === "failed" || c.phase === "next") return;
          report(c.callId, "ended");
          if (c.phase === "starting" || c.phase === "ringing") {
            patch({ phase: "failed", error: "The call was dropped before your softphone connected." });
            return;
          }
          // A missed incoming call, or one from nobody in this caller's list, needs no outcome.
          if (c.direction === "inbound" && (c.phase === "incoming" || !c.callId)) { setCall(null); return; }
          patch({ phase: "outcome" });
        },
      });
      phone.current = p;
      await p.start();
    };

    if (navigator.locks) {
      changeLine("other-tab");
      navigator.locks.request("ajimos-dialixa-softphone", { signal: abort.signal }, () => {
        if (stopped) return undefined;
        changeLine("connecting");
        return new Promise<void>((resolve) => { release = resolve; run().catch(() => changeLine("offline")); });
      }).catch(() => undefined);
    } else {
      run().catch(() => changeLine("offline"));
    }
    return () => {
      stopped = true;
      const p = phone.current;
      phone.current = null;
      const done = () => { release?.(); };
      if (p) p.stop().then(done, done); else done();
      abort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softphone]);

  // Closing the tab during a call asks first.
  const talking = call?.phase === "talking";
  useEffect(() => {
    if (!talking) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [talking]);

  // Dialixa took the call but never rang this softphone.
  const ringing = call?.phase === "ringing";
  useEffect(() => {
    if (!ringing) return;
    const t = window.setTimeout(() => {
      autoAnswerUntil.current = 0;
      patch({ phase: "failed", error: "Dialixa did not ring your softphone. Try again." });
    }, RING_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [ringing, patch]);

  const place = useCallback(async (target: PhoneCallTarget) => {
    setCall({ phase: "starting", callId: null, contact: target, direction: "outbound" });
    const own = lineRef.current !== "off" && lineRef.current !== "other-tab";
    if (own) {
      if (lineRef.current !== "ready") {
        patch({ phase: "failed", error: lineRef.current === "refused"
          ? "Dialixa refused your softphone login. Tell your administrator."
          : "Your softphone is not connected. Check your internet and try again in a moment." });
        return;
      }
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach((t) => t.stop());
      } catch {
        patch({ phase: "failed", error: "Allow the microphone for this site, then try again." });
        return;
      }
      autoAnswerUntil.current = Date.now() + RING_WAIT_MS;
    }
    const { data, error } = await supabase.functions.invoke("dialixa-call", { body: { contactId: target.id } });
    const c = callRef.current;
    if (!c || c.contact?.id !== target.id || c.direction !== "outbound") return;
    if (error || !data?.ok) {
      autoAnswerUntil.current = 0;
      patch({ phase: "failed", error: data?.error || "The call could not be started. Try again." });
      return;
    }
    patch({ callId: data.callId });
    const after = callRef.current;
    if (after?.phase === "talking") report(data.callId, "answered");
    // Answered elsewhere (Dialixa's own softphone or another tab): its end is not known here, so offer the outcome.
    else if (after?.phase === "starting") patch({ phase: own ? "ringing" : "outcome" });
  }, [patch, setCall]);

  const start = useCallback((target: PhoneCallTarget, h?: StartHandlers) => {
    const c = callRef.current;
    if (c && c.phase !== "failed" && c.phase !== "next") {
      notify.error("Finish the current call first", c.phase === "outcome" ? "Save or skip its outcome, then call again." : "You are already on a call.");
      return false;
    }
    handlers.current = h ?? null;
    place(target);
    return true;
  }, [notify, place]);

  const setNext = useCallback((n: PhoneCallTarget | null) => setNextState(n), []);

  const detach = useCallback((h: StartHandlers) => {
    if (handlers.current !== h) return;
    handlers.current = null;
    setNextState(null);
    if (callRef.current?.phase === "next") setCall(null);
  }, [setCall]);

  const close = useCallback(() => {
    const h = handlers.current;
    handlers.current = null;
    autoAnswerUntil.current = 0;
    setCall(null);
    h?.onClose();
  }, [setCall]);

  const hangup = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    if (c.phase === "incoming") { try { await phone.current?.decline(); } catch { /* caller gave up */ } setCall(null); return; }
    if (c.phase === "talking") { try { await phone.current?.hangup(); } catch { patch({ phase: c.callId ? "outcome" : "failed" }); } return; }
    // Not answered yet: stop answering for the caller, so the player is not dialled.
    autoAnswerUntil.current = 0;
    close();
  }, [close, patch, setCall]);

  const answer = useCallback(async () => {
    try { await phone.current?.answer(); } catch { notify.error("Call not answered", "Allow the microphone for this site."); }
  }, [notify]);

  const saved = useCallback((queued: PhoneCallTarget | null) => {
    for (const key of [
      "pipeline-latest-dispositions", "pipeline-latest-sub-dispositions", "pipeline-disposition-filter-ids",
      "pipeline-contacts", "gaming-day-stats", "gaming-dispo-counts", "gaming-hourly-counts",
    ]) queryClient.invalidateQueries({ queryKey: [key] });
    if (queued && handlers.current?.onAdvance) { patch({ phase: "next", contact: queued }); return; }
    notify.success("Outcome saved", "");
    close();
  }, [close, notify, patch, queryClient]);

  const advance = useCallback(() => {
    const c = callRef.current;
    const h = handlers.current;
    if (c?.phase !== "next" || !c.contact) return;
    // The page moves its target on, which starts the next call.
    if (h?.onAdvance) h.onAdvance(c.contact); else close();
  }, [close]);

  useEffect(() => {
    api.current = { start, setNext, detach };
    return () => { api.current = null; };
  }, [api, start, setNext, detach]);

  return (
    <>
      <audio ref={audio} autoPlay className="hidden" />
      <SoftphonePanel
        extension={extension} line={line} call={call} muted={muted} held={held}
        next={handlers.current?.onAdvance ? next : null}
        onHangup={hangup} onAnswer={answer} onClose={close} onSaved={saved} onAdvance={advance}
        onRetry={() => { if (call?.contact) place(call.contact); }}
        onMute={(m) => { phone.current?.setMuted(m); setMuted(m); }}
        onHold={async (h) => { try { await phone.current?.setHeld(h); setHeld(h); } catch { notify.error("Hold did not work", ""); } }}
        onTone={(t) => { phone.current?.tone(t)?.catch(() => undefined); }}
      />
    </>
  );
}
