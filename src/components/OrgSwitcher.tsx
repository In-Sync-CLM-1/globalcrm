import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { useOrgContextProvider } from "@/contexts/OrgContextProvider";
import { toast } from "sonner";

/**
 * Switches which organisation you are working in.
 *
 * Only rendered when there is somewhere to switch to, so anyone belonging to
 * a single organisation sees nothing new.
 */
export function OrgSwitcher() {
  const { user } = useAuth();
  const { userOrgId, isPlatformAdmin } = useOrgContextProvider();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: memberships = [] } = useQuery({
    queryKey: ["my-org-memberships", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("org_id")
        .eq("user_id", user!.id)
        .eq("is_active", true);
      const ids = (roles ?? []).map((r) => r.org_id).filter(Boolean) as string[];
      if (!ids.length) return [];
      const { data } = await supabase
        .from("organizations")
        .select("id, name")
        .in("id", ids)
        .order("name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (memberships.length < 2 && !isPlatformAdmin) return null;

  const current = memberships.find((m) => m.id === userOrgId);

  const pick = async (orgId: string) => {
    setOpen(false);
    setBusy(true);
    try {
      const { error } = await supabase.rpc("set_active_org", { p_org_id: orgId });
      if (error) throw error;
      // Every cached query is scoped to the old organisation.
      await queryClient.invalidateQueries();
      navigate("/");
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch organisation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border bg-background hover:bg-muted disabled:opacity-60"
      >
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate max-w-[160px]">{current?.name ?? "Select organisation"}</span>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUpDown className="h-4 w-4 opacity-50" />}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-64 rounded-md border bg-background shadow-lg py-1">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Organisations
          </p>
          {memberships.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted"
            >
              <Check className={"h-4 w-4 shrink-0 " + (userOrgId === m.id ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{m.name}</span>
            </button>
          ))}
          {isPlatformAdmin && (
            <>
              <div className="my-1 border-t" />
              <button
                type="button"
                onClick={() => { setOpen(false); navigate("/platform-admin"); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Platform console
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
