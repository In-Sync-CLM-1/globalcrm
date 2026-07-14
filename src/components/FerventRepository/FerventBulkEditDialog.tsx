import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotification } from "@/hooks/useNotification";
import { normalizeEmployeeSize, parseTurnoverUsdMillion, formatTurnoverUsdMillion } from "@/components/FerventRepository/ferventFieldNormalization";

const BULK_EDITABLE_FIELDS: { key: string; label: string }[] = [
  { key: "ucdb_status", label: "UCDB Status" },
  { key: "designation_level", label: "Designation Level" },
  { key: "department", label: "Department" },
  { key: "industry", label: "Industry" },
  { key: "sub_industry", label: "Sub Industry" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "employee_size", label: "Employee Size" },
  { key: "turnover", label: "Turnover" },
];

interface FerventBulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  orgId: string;
  onSaved: () => void;
}

export function FerventBulkEditDialog({ open, onOpenChange, selectedIds, orgId, onSaved }: FerventBulkEditDialogProps) {
  const notify = useNotification();
  const [field, setField] = useState<string>("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleApply = async () => {
    if (!field) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let newValue: string | null = value.trim() === "" ? null : value.trim();
      const updatePayload: Record<string, string | number | null> = {};

      if (field === "employee_size" && newValue) {
        newValue = normalizeEmployeeSize(newValue);
      }
      if (field === "turnover") {
        const m = parseTurnoverUsdMillion(newValue);
        if (m != null) newValue = formatTurnoverUsdMillion(m);
        updatePayload.turnover_usd_million = m;
      }
      updatePayload[field] = newValue;

      const { error } = await supabase
        .from("fervent_data_repository")
        .update(updatePayload)
        .in("id", selectedIds)
        .eq("org_id", orgId);
      if (error) throw error;

      const label = BULK_EDITABLE_FIELDS.find((f) => f.key === field)?.label || field;
      await supabase.from("fervent_activity_log").insert(
        selectedIds.map((recordId) => ({
          org_id: orgId,
          record_id: recordId,
          actor_id: user.id,
          action: "edited",
          detail: { changes: { [field]: { to: newValue } }, bulk: true },
        }))
      );

      notify.success("Bulk edit applied", `${label} updated on ${selectedIds.length} record(s).`);
      setField("");
      setValue("");
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      notify.error("Bulk edit failed", err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Bulk Edit {selectedIds.length} Record(s)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Field to update</Label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a field" />
              </SelectTrigger>
              <SelectContent>
                {BULK_EDITABLE_FIELDS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">New value</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Leave blank to clear the field" />
          </div>
          <p className="text-xs text-muted-foreground">
            This will overwrite the selected field on all {selectedIds.length} selected record(s). This can't be undone in bulk, but each change is logged in that record's timeline.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={saving || !field}>
            {saving ? "Applying..." : "Apply to All Selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
