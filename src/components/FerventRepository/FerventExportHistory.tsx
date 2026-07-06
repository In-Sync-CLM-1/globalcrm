import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ExportLogRow {
  id: string;
  created_at: string;
  detail: { count?: number; filters?: Record<string, string> } | null;
  profiles: { first_name: string | null; last_name: string | null } | null;
}

function actorName(p: ExportLogRow["profiles"]): string {
  if (!p) return "—";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
}

function describeFilters(filters?: Record<string, string>): string {
  if (!filters) return "None";
  const active = Object.entries(filters).filter(([, v]) => v && v.trim() !== "");
  if (active.length === 0) return "None";
  return active.map(([k, v]) => `${k}: ${v}`).join(", ");
}

interface FerventExportHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
}

export function FerventExportHistory({ open, onOpenChange, orgId }: FerventExportHistoryProps) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fervent-export-history", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fervent_activity_log")
        .select("id, created_at, detail, profiles!actor_id(first_name, last_name)")
        .eq("org_id", orgId)
        .eq("action", "exported")
        .is("record_id", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as ExportLogRow[];
    },
    enabled: open && !!orgId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export History</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Filters Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="whitespace-nowrap">{actorName(r.profiles)}</TableCell>
                  <TableCell>{r.detail?.count ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate" title={describeFilters(r.detail?.filters)}>
                    {describeFilters(r.detail?.filters)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
