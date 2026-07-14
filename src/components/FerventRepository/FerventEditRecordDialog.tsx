import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotification } from "@/hooks/useNotification";
import type { RepositoryRecord } from "@/pages/FerventRepository";
import { normalizeEmployeeSize, parseTurnoverInrMillion, formatTurnoverInrMillion } from "@/components/FerventRepository/ferventFieldNormalization";

// All user-editable fields on a repository record. sr_no/db_sourced_year are
// numeric; everything else is free text. id/org_id/created_at/updated_at/
// created_by/import_job_id are not user-editable — they're system-managed.
const EDITABLE_FIELDS: { key: keyof RepositoryRecord; label: string; type?: "number" }[] = [
  { key: "unique_id", label: "Unique ID" },
  { key: "db_sourced_year", label: "DB Sourced Year", type: "number" },
  { key: "ucdb_status", label: "UCDB Status" },
  { key: "company_name", label: "Company Name" },
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "designation", label: "Designation" },
  { key: "department", label: "Department" },
  { key: "designation_level", label: "Designation Level" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "std_code", label: "STD Code" },
  { key: "mobile_number_1", label: "Mobile Number 1" },
  { key: "mobile_number_2", label: "Mobile Number 2" },
  { key: "direct_number", label: "Direct Number" },
  { key: "phone_number", label: "Phone Number" },
  { key: "official_email", label: "Official Email" },
  { key: "personal_email_1", label: "Personal Email 1" },
  { key: "personal_email_2", label: "Personal Email 2" },
  { key: "linkedin_url", label: "LinkedIn" },
  { key: "domain_name", label: "Domain Name" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "sub_industry", label: "Sub Industry" },
  { key: "employee_size", label: "Employee Size" },
  { key: "turnover", label: "Turnover" },
  { key: "company_linkedin_url", label: "Company LinkedIn" },
];

interface FerventEditRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: RepositoryRecord;
  orgId: string;
  onSaved: (updated: RepositoryRecord) => void;
}

export function FerventEditRecordDialog({ open, onOpenChange, record, orgId, onSaved }: FerventEditRecordDialogProps) {
  const notify = useNotification();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    EDITABLE_FIELDS.forEach(({ key }) => {
      if (key === "turnover") {
        initial.turnover = record.turnover_inr_million != null
          ? formatTurnoverInrMillion(record.turnover_inr_million)
          : (record.turnover ?? "");
        return;
      }
      const v = record[key];
      initial[key as string] = v == null ? "" : String(v);
    });
    setValues(initial);
  }, [open, record]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const updates: Record<string, string | number | null> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      EDITABLE_FIELDS.forEach(({ key, type }) => {
        const raw = values[key as string] ?? "";
        let newValue: string | number | null =
          type === "number" ? (raw.trim() === "" ? null : parseInt(raw, 10)) : (raw.trim() === "" ? null : raw);
        if (key === "employee_size" && typeof newValue === "string") {
          newValue = normalizeEmployeeSize(newValue);
        }
        if (key === "turnover" && typeof newValue === "string") {
          const m = parseTurnoverInrMillion(newValue);
          if (m != null) newValue = formatTurnoverInrMillion(m);
        }
        const oldValue = record[key] ?? null;
        if (String(oldValue ?? "") !== String(newValue ?? "")) {
          updates[key as string] = newValue;
          changes[key as string] = { from: oldValue, to: newValue };
        }
      });

      // Keep the hidden numeric range field in sync whenever the visible
      // turnover text changed (or was never backfilled for this record).
      const turnoverText = ("turnover" in updates ? updates.turnover : record.turnover) as string | null;
      const newTurnoverM = parseTurnoverInrMillion(turnoverText);
      if (newTurnoverM !== (record.turnover_inr_million ?? null)) {
        updates.turnover_inr_million = newTurnoverM;
      }

      if (Object.keys(updates).length === 0) {
        onOpenChange(false);
        return;
      }

      const { error } = await supabase
        .from("fervent_data_repository")
        .update(updates)
        .eq("id", record.id)
        .eq("org_id", orgId);
      if (error) throw error;

      await supabase.from("fervent_activity_log").insert({
        org_id: orgId,
        record_id: record.id,
        actor_id: user.id,
        action: "edited",
        detail: { changes },
      });

      notify.success("Record updated", `${Object.keys(updates).length} field(s) changed.`);
      onSaved({ ...record, ...updates } as RepositoryRecord);
      onOpenChange(false);
    } catch (err: any) {
      notify.error("Couldn't save changes", err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {[record.first_name, record.last_name].filter(Boolean).join(" ") || "Record"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {EDITABLE_FIELDS.map(({ key, label, type }) => (
            <div key={key as string}>
              <Label htmlFor={`edit-${key as string}`} className="text-xs text-muted-foreground">
                {label}
              </Label>
              <Input
                id={`edit-${key as string}`}
                type={type === "number" ? "number" : "text"}
                value={values[key as string] ?? ""}
                onChange={(e) => setValues({ ...values, [key as string]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
