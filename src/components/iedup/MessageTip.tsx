import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A template name; hovering on it (or tabbing / tapping to it) shows the message body, always inside the screen.
// Same behaviour as RAMP's message names (ramp: src/messageTip.tsx).
export default function MessageTip({ name, body }: { name: string; body: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [box, setBox] = useState<DOMRect | null>(null);
  const show = () => { window.clearTimeout(timer.current); setBox(ref.current?.getBoundingClientRect() ?? null); };
  // a short wait, so the pointer can move onto the text to scroll it
  const hide = () => { timer.current = window.setTimeout(() => setBox(null), 150); };
  useEffect(() => {
    if (!box) return;
    const close = (e: Event) => { if (!(e.target instanceof Element && e.target.closest("[role=tooltip]"))) setBox(null); };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [box]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const below = box ? window.innerHeight - box.bottom - 16 : 0;
  const above = box ? box.top - 16 : 0;
  const down = below >= 240 || below >= above;
  const width = Math.min(420, window.innerWidth - 24);
  return (
    <>
      <span ref={ref} tabIndex={0} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} className="cursor-help">{name}</span>
      {box && createPortal(
        <div role="tooltip" onMouseEnter={show} onMouseLeave={hide} className="fixed z-50 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-popover p-3 text-left text-sm font-normal text-popover-foreground shadow-md"
          style={{ width, left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)), maxHeight: Math.min(420, down ? below : above), ...(down ? { top: box.bottom + 4 } : { bottom: window.innerHeight - box.top + 4 }) }}>
          <b className="mb-1 block break-words">{name}</b>{body}
        </div>, document.body)}
    </>
  );
}
