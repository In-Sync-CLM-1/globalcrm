import { supabase } from "@/integrations/supabase/client";

/**
 * One-click sign-in into Work-Sync for the CRM staff who have an
 * account there. `/api/launcher/launch` mints a fresh sign-in link for the
 * caller in Work-Sync, and we send a new tab there. Throws on failure so
 * the caller can surface the reason.
 */
export async function launchWorksync(): Promise<void> {
  // The tab has to be opened here, synchronously inside the click, and only
  // pointed at the destination once the sign-in link comes back. Opening it
  // after the await instead would be treated as an unrequested popup and
  // blocked, because by then the browser no longer connects it to a click.
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.write(
      "<title>Signing you in…</title><body style=\"font:14px system-ui;padding:2rem;color:#444\">Signing you in…</body>",
    );
    tab.opener = null;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    tab?.close();
    throw new Error("Your session has expired — please sign in again.");
  }

  try {
    const res = await fetch(`/api/launcher/launch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || "Launch failed");

    if (tab) {
      tab.location.href = body.url;
    } else {
      window.location.href = body.url;
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}
