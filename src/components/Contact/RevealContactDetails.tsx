import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useGamingAccess } from "@/hooks/useGamingAccess";
import { useNotification } from "@/hooks/useNotification";

/**
 * Admin-only. In an org with PII protection the database holds only masked phone numbers and emails;
 * this asks the server to decrypt one contact's details. Every reveal is written to the access log,
 * and the details disappear again after 30 seconds.
 */
export function RevealContactDetails({ contactId }: { contactId: string }) {
  const gaming = useGamingAccess();
  const notify = useNotification();
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<{ phone: string | null; email: string | null } | null>(null);

  useEffect(() => {
    if (!details) return;
    const t = setTimeout(() => setDetails(null), 30000);
    return () => clearTimeout(t);
  }, [details]);

  // Only admins of an org with protection see this; everyone else keeps the masked values.
  if (!gaming.isGaming || gaming.masked) return null;

  const reveal = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("reveal_contact_pii" as never, { _contact_id: contactId } as never);
    setLoading(false);
    if (error) { notify.error("Could not reveal the details", error.message); return; }
    setDetails(data as unknown as { phone: string | null; email: string | null });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {details ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setDetails(null)}>
          <EyeOff className="mr-1.5 h-4 w-4" />Hide
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={reveal} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}Reveal
        </Button>
      )}
      {details && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <p><span className="text-muted-foreground">Phone </span><span className="font-medium tabular-nums">{details.phone || "-"}</span></p>
          <p><span className="text-muted-foreground">Email </span><span className="font-medium">{details.email || "-"}</span></p>
          <p className="mt-1 text-[11px] text-muted-foreground">This view is logged. It hides again in 30 seconds.</p>
        </div>
      )}
    </div>
  );
}
