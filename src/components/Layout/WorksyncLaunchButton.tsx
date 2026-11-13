import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import { ListChecks } from "lucide-react";
import { launchWorksync } from "@/lib/launchWorksync";

// One-click jump into Work-Sync for people who already have an account there
// (Ajimos is provisioned in its own Work-Sync org). Renders nothing for anyone
// else, and the lookup never creates an account.
export function WorksyncLaunchButton({ onNavigate }: { onNavigate?: () => void }) {
  const [hasAccess, setHasAccess] = useState(false);
  const [launching, setLaunching] = useState(false);
  const notification = useNotification();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const res = await fetch("/api/launcher/check-access", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const body = await res.json();
        setHasAccess(!!body.worksync);
      } catch {
        // Convenience widget: stay silent if the check fails.
      }
    })();
  }, []);

  if (!hasAccess) return null;

  const handleClick = async () => {
    setLaunching(true);
    try {
      await launchWorksync();
      onNavigate?.();
    } catch (err) {
      notification.error("Couldn't sign you in", err instanceof Error ? err.message : "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <>
      <div className="pt-3 pb-1 px-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">Tools</p>
      </div>
      <button
        onClick={handleClick}
        disabled={launching}
        className="flex w-full items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors disabled:opacity-60"
      >
        <ListChecks size={16} className="shrink-0 text-sidebar-muted" />
        <span>{launching ? "Signing you in…" : "Work-Sync"}</span>
      </button>
    </>
  );
}
