import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Headphones } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useNotification } from "@/hooks/useNotification";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUserRole } from "@/hooks/useUserRole";
import { AJIMOS_ORG_ID } from "@/components/Gaming/gamingStats";

interface Row { user_id: string; name: string; extension: string | null; sip_username: string | null; has_password: boolean }

/** Ajimos admins: which Dialixa extension belongs to which caller. */
export function DialixaExtensionsButton() {
  const { effectiveOrgId } = useOrgContext();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const [open, setOpen] = useState(false);
  const allowed = effectiveOrgId === AJIMOS_ORG_ID && (isAdmin || isSuperAdmin);
  const { data: rows, error } = useQuery({
    queryKey: ["dialixa-extensions"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error: err } = await supabase.rpc("dialixa_extensions_list" as never);
      if (err) throw err;
      return (data ?? []) as unknown as Row[];
    },
    enabled: allowed && open,
  });
  if (!allowed) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Headphones className="mr-2 h-4 w-4" /> Dialixa extensions</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dialixa extensions</DialogTitle>
          <DialogDescription>
            A user with an extension calls through Dialixa. Leave the extension empty to take it away. A saved password cannot be shown again.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">The list could not be loaded.</p>
          : !rows ? <p className="text-sm text-muted-foreground">Loading…</p>
          : <div className="space-y-2">{rows.map((r) => <ExtensionRow key={r.user_id} row={r} />)}</div>}
      </DialogContent>
    </Dialog>
  );
}

function ExtensionRow({ row }: { row: Row }) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [ext, setExt] = useState(row.extension ?? "");
  const [login, setLogin] = useState(row.sip_username ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("dialixa_set_extension" as never, {
      _user_id: row.user_id, _extension: ext, _sip_username: login || null, _sip_password: password || null,
    } as never);
    setSaving(false);
    if (error) { notify.error("Not saved", error); return; }
    setPassword("");
    notify.success("Saved", row.name);
    queryClient.invalidateQueries({ queryKey: ["dialixa-extensions"] });
    queryClient.invalidateQueries({ queryKey: ["my-dialixa-status"] });
  };

  return (
    <div className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
      <span className="text-sm font-medium">{row.name}</span>
      <Input aria-label={`Extension of ${row.name}`} placeholder="Extension" inputMode="numeric" value={ext} onChange={(e) => setExt(e.target.value.replace(/\D/g, ""))} />
      <Input aria-label={`Softphone login of ${row.name}`} placeholder="Login, if different" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} />
      <Input aria-label={`Softphone password of ${row.name}`} type="password" autoComplete="new-password" placeholder={row.has_password ? "Password saved" : "Password"} value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
    </div>
  );
}
