import { useEffect, useRef } from "react";
import type { PhoneCallTarget } from "@/components/PhoneApp/PhoneCallDialog";
import { useDialixa, type StartHandlers } from "./DialixaProvider";

/** Same shape as the phone app's call dialog: a target starts the call in the softphone panel. */
export function DialixaCall({ target, onClose, next, onAdvance }: {
  target: PhoneCallTarget | null;
  onClose: () => void;
  next?: PhoneCallTarget | null;
  onAdvance?: (next: PhoneCallTarget) => void;
}) {
  const { start, setNext, detach } = useDialixa();
  const mine = useRef<StartHandlers | null>(null);
  const close = useRef(onClose);
  const advance = useRef(onAdvance);
  close.current = onClose;
  advance.current = onAdvance;

  useEffect(() => {
    if (!target) return;
    const h: StartHandlers = {
      onClose: () => close.current(),
      onAdvance: advance.current ? (n) => advance.current?.(n) : undefined,
    };
    if (start(target, h)) mine.current = h;
    else close.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  useEffect(() => {
    if (target || mine.current) setNext(target ? next ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, next?.id]);

  // Leaving the page ends Next-call mode; the call itself carries on.
  useEffect(() => () => { if (mine.current) detach(mine.current); }, [detach]);

  return null;
}
