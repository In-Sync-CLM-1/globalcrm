import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Wraps a screen that shows full phone numbers. When `active`:
 *  - blocks copy, cut, drag, text selection, right-click and printing,
 *  - blurs the content when the window loses focus or Print Screen is pressed,
 *  - shows a faint watermark with the signed-in user's name and the date and time.
 * No website can fully stop phone screenshots or a photo taken with another phone; this makes leaks
 * harder and traceable. When not active it renders its children untouched.
 */
export function ProtectedScreen({ active, children }: { active: boolean; children: ReactNode }) {
  const [blurred, setBlurred] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const { data: name } = useQuery({
    queryKey: ["protected-screen-user-name"],
    enabled: active,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return "";
      const { data } = await supabase.from("profiles").select("first_name, last_name").eq("id", user.id).maybeSingle();
      const n = `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim();
      return n || user.email || "";
    },
  });

  useEffect(() => {
    if (!active) return;
    const stop = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || e.code === "PrintScreen") {
        setBlurred(true);
        try { navigator.clipboard?.writeText("").catch(() => {}); } catch { /* ignore */ }
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "x" || k === "p" || k === "s" || k === "a")) e.preventDefault();
    };
    const onBlur = () => setBlurred(true);
    const onFocus = () => setBlurred(false);
    const onVisibility = () => setBlurred(document.visibilityState !== "visible");
    const onBeforePrint = () => setBlurred(true);
    const onAfterPrint = () => setBlurred(false);
    document.addEventListener("copy", stop);
    document.addEventListener("cut", stop);
    document.addEventListener("contextmenu", stop);
    document.addEventListener("dragstart", stop);
    document.addEventListener("selectstart", stop);
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", (e) => { if (e.key === "PrintScreen") setBlurred(true); });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    const tick = setInterval(() => setNow(new Date()), 30000);
    return () => {
      document.removeEventListener("copy", stop);
      document.removeEventListener("cut", stop);
      document.removeEventListener("contextmenu", stop);
      document.removeEventListener("dragstart", stop);
      document.removeEventListener("selectstart", stop);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      clearInterval(tick);
    };
  }, [active]);

  // Dialogs render outside this wrapper, so the rules are applied through classes on the page body.
  useEffect(() => {
    if (!active) return;
    document.body.classList.add("protected-active");
    return () => document.body.classList.remove("protected-active");
  }, [active]);
  useEffect(() => {
    document.body.classList.toggle("protected-blur", active && blurred);
    return () => document.body.classList.remove("protected-blur");
  }, [active, blurred]);

  if (!active) return <>{children}</>;

  const stamp = `${name ?? ""} · ${now.toLocaleString()}`;
  const tile = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='160'><text x='20' y='90' transform='rotate(-20 160 80)' font-family='sans-serif' font-size='14' fill='rgba(100,100,100,0.18)'>${stamp.replace(/[<>&']/g, "")}</text></svg>`,
  );

  return (
    <div className="protected-screen relative" data-protected="true">
      <style>{`
        body.protected-active, body.protected-active * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none; }
        body.protected-active input, body.protected-active textarea { -webkit-user-select: text !important; user-select: text !important; }
        body.protected-blur > *:not(.protected-overlay) { filter: blur(14px); }
        @media print { body.protected-active > * { display: none !important; } body.protected-active::after { content: "Printing is not allowed on this screen."; display: block; padding: 2rem; } }
      `}</style>
      {children}
      {createPortal(<>
      {blurred && (
          <div className="protected-overlay fixed inset-0 z-[9998] flex items-center justify-center bg-background/40 text-sm font-medium text-muted-foreground" onClick={() => setBlurred(false)}>
            Click here to show the screen again
          </div>
        )}
        <div
          className="protected-overlay pointer-events-none fixed inset-0 z-[9999]"
          style={{ backgroundImage: `url("data:image/svg+xml,${tile}")` }}
          aria-hidden="true"
        />
      </>, document.body)}
    </div>
  );
}
