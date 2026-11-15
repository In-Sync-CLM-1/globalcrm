import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Customer files live in private storage. The database keeps the plain file
 * address (the same shape as before, so older records keep working); every
 * time a signed-in user opens a file we swap it for a link that expires.
 */
export const PRIVATE_BUCKETS = new Set([
  "client-documents",
  "attendance-photos",
  "chat-attachments",
  "ticket-attachments",
  "ticket-escalation-attachments",
]);

const LINK_SECONDS = 60 * 60; // 1 hour

/** Splits a stored storage address into bucket + path, or null if it is not one. */
export function parseStoredFile(stored: string | null | undefined): { bucket: string; path: string } | null {
  if (!stored) return null;
  const m = stored.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

/** Returns a link the browser (or a server function) can open now. */
export async function signedFileUrl(stored: string | null | undefined, seconds = LINK_SECONDS): Promise<string | null> {
  if (!stored) return null;
  const parsed = parseStoredFile(stored);
  if (!parsed || !PRIVATE_BUCKETS.has(parsed.bucket)) return stored;
  const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, seconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Opens a stored file in a new tab using a fresh expiring link. */
export async function openStoredFile(stored: string | null | undefined, download = false): Promise<void> {
  // Open the tab first so pop-up blockers allow it, then point it at the link.
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const url = await signedFileUrl(stored);
  if (!url) {
    tab?.close();
    return;
  }
  const finalUrl = download ? `${url}${url.includes("?") ? "&" : "?"}download=` : url;
  if (tab) tab.location.href = finalUrl;
  else window.open(finalUrl, "_blank", "noopener,noreferrer");
}

/** React hook: an expiring link for a stored file, refreshed when the file changes. */
export function useSignedFileUrl(stored: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    stored && !PRIVATE_BUCKETS.has(parseStoredFile(stored)?.bucket ?? "") ? stored : null,
  );
  useEffect(() => {
    let alive = true;
    signedFileUrl(stored).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [stored]);
  return url;
}
