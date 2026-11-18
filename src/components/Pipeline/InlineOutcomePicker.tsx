import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotification } from "@/hooks/useNotification";
import { useDispositionCatalog, AJIMOS_ORG_ID } from "@/components/Gaming/gamingStats";

interface InlineOutcomePickerProps {
  contactId: string;
  /** The contact's latest outcome and sub-option, as shown in the list. */
  dispositionId?: string | null;
  subDispositionId?: string | null;
  /** "row" puts the two dropdowns side by side (table), "stack" one under the other (board card). */
  layout?: "row" | "stack";
}

/**
 * Ajimos: set a call outcome straight from the Pipeline list. Saves as soon as the outcome is
 * picked, or the sub-option when the outcome has sub-options. A change within 5 minutes of the
 * same person's last pick corrects it instead of counting another call (set_pipeline_call_outcome).
 */
export function InlineOutcomePicker({ contactId, dispositionId, subDispositionId, layout = "row" }: InlineOutcomePickerProps) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const { data: catalog } = useDispositionCatalog(AJIMOS_ORG_ID);
  const [local, setLocal] = useState<{ d: string; s: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh value from the server replaces whatever was picked here.
  useEffect(() => { setLocal(null); }, [dispositionId, subDispositionId]);

  const d = local?.d ?? dispositionId ?? "";
  const s = local ? local.s : subDispositionId ?? "";
  const subsFor = (id: string) => (catalog?.subs ?? []).filter((x) => x.disposition_id === id);
  const subs = subsFor(d);
  const known = (catalog?.dispositions ?? []).some((x) => x.id === d);

  const save = async (dispo: string, sub: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_pipeline_call_outcome" as never, {
        _contact_id: contactId,
        _disposition_id: dispo,
        _sub_disposition_id: sub || null,
      } as never);
      if (error) throw error;
      notify.success("Outcome saved", "");
      for (const key of [
        "pipeline-latest-dispositions", "pipeline-latest-sub-dispositions", "pipeline-disposition-filter-ids",
        "pipeline-contacts", "gaming-day-stats", "gaming-dispo-counts", "gaming-hourly-counts",
      ]) queryClient.invalidateQueries({ queryKey: [key] });
    } catch (err: unknown) {
      setLocal(null);
      notify.error("Outcome not saved", err);
    } finally {
      setSaving(false);
    }
  };

  const pickOutcome = (v: string) => {
    setLocal({ d: v, s: "" });
    if (subsFor(v).length === 0) save(v, "");
  };
  const pickSub = (v: string) => {
    setLocal({ d, s: v });
    save(d, v);
  };

  const waitingForSub = !!local && !local.s && subs.length > 0;
  const trigger = "h-7 text-xs px-2";

  return (
    <div
      className={layout === "row" ? "flex items-center gap-1 min-w-[300px]" : "space-y-1 mt-2"}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      draggable={false}
    >
      <Select value={known ? d : undefined} onValueChange={pickOutcome} disabled={saving}>
        <SelectTrigger className={`${trigger} ${layout === "row" ? "w-[140px]" : "w-full"}`} aria-label="Outcome">
          <SelectValue placeholder="Outcome" />
        </SelectTrigger>
        <SelectContent>
          {(catalog?.dispositions ?? []).map((x) => (
            <SelectItem key={x.id} value={x.id} className="text-xs">{x.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={s || undefined} onValueChange={pickSub} disabled={saving || !known || subs.length === 0}>
        <SelectTrigger
          className={`${trigger} ${layout === "row" ? "w-[150px]" : "w-full"} ${waitingForSub ? "border-amber-500 ring-1 ring-amber-500" : ""}`}
          aria-label="Sub-option"
        >
          <SelectValue placeholder={waitingForSub ? "Pick sub-option" : "Sub-option"} />
        </SelectTrigger>
        <SelectContent>
          {subs.map((x) => (
            <SelectItem key={x.id} value={x.id} className="text-xs">{x.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
    </div>
  );
}
