// Feeds the permanent activity ledger with what only the browser can see: which
// reports a person opened and what they exported or downloaded. Every call is
// fire-and-forget; a failure here never affects the screen.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const REPORT_ROUTE = /(report|dashboard|analytics|summary|billing|attendance|data-export|call-logs|calling)/i;

function send(event: "report_open" | "export", target: string, details: Record<string, unknown> = {}) {
  try {
    void (supabase as any)
      .rpc("ledger_log_access", { p_event: event, p_target: target, p_details: details })
      .then(() => undefined, () => undefined);
  } catch {
    /* never block the UI */
  }
}

let downloadsWatched = false;

// Every export (CSV, Excel, PDF) ends by clicking a temporary link that has a file
// name. Watching that one moment covers all of them, including ones added later.
function watchDownloads() {
  if (downloadsWatched || typeof window === "undefined") return;
  downloadsWatched = true;
  const record = (a: HTMLAnchorElement) => {
    if (a.hasAttribute("download")) send("export", a.download || "download", { page: window.location.pathname });
  };
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    record(this);
    return originalClick.call(this);
  };
  const originalDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (this: HTMLAnchorElement, event: Event) {
    if (event.type === "click") record(this);
    return originalDispatch.call(this, event);
  };
}

/** Mount once inside the router. Records report opens and exports for signed-in people. */
export function LedgerAccessTrail() {
  const location = useLocation();
  useEffect(() => {
    watchDownloads();
  }, []);
  useEffect(() => {
    if (!REPORT_ROUTE.test(location.pathname)) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) send("report_open", location.pathname);
    });
  }, [location.pathname]);
  return null;
}
