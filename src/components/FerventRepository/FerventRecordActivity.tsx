import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNotification } from "@/hooks/useNotification";
import { formatDistanceToNow } from "date-fns";
import { StickyNote } from "lucide-react";

interface Profile {
  first_name: string | null;
  last_name: string | null;
}

interface ActivityRow {
  id: string;
  action: string;
  detail: { text?: string } | null;
  created_at: string;
  profiles: Profile | null;
}

function actorName(p: Profile | null): string {
  if (!p) return "—";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
}

interface FerventRecordActivityProps {
  recordId: string;
  orgId: string;
  importJobId: string | null;
  fallbackCreatedAt: string;
}

export function FerventRecordActivity({ recordId, orgId, importJobId, fallbackCreatedAt }: FerventRecordActivityProps) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: source } = useQuery({
    queryKey: ["fervent-record-source", importJobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("file_name, created_at, profiles!user_id(first_name, last_name)")
        .eq("id", importJobId as string)
        .maybeSingle();
      if (error) throw error;
      return data as { file_name: string; created_at: string; profiles: Profile | null } | null;
    },
    enabled: !!importJobId,
  });

  const { data: activity = [], isLoading } = useQuery({
    queryKey: ["fervent-record-activity", recordId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fervent_activity_log")
        .select("id, action, detail, created_at, profiles!actor_id(first_name, last_name)")
        .eq("record_id", recordId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ActivityRow[];
    },
  });

  const addNote = async () => {
    const text = note.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("fervent_activity_log").insert({
        org_id: orgId,
        record_id: recordId,
        actor_id: user.id,
        action: "note",
        detail: { text },
      });
      if (error) throw error;

      setNote("");
      queryClient.invalidateQueries({ queryKey: ["fervent-record-activity", recordId] });
    } catch (err: any) {
      notify.error("Couldn't add note", err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold mb-2">Data Source</h4>
        <div className="grid grid-cols-3 gap-3 text-sm bg-muted/50 rounded-lg p-3">
          <div>
            <p className="text-xs text-muted-foreground">Imported By</p>
            <p className="font-medium">{importJobId ? actorName(source?.profiles ?? null) : "Manual / not tracked"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Import Date</p>
            <p className="font-medium">{new Date(source?.created_at || fallbackCreatedAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Import File</p>
            <p className="font-medium break-all">{source?.file_name || "—"}</p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Notes & Timeline</h4>
        <div className="flex gap-2 mb-3">
          <Textarea
            placeholder="Add a note about this record..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-[38px] h-[38px] resize-none"
          />
          <Button size="sm" onClick={addNote} disabled={submitting || !note.trim()}>
            Add
          </Button>
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : activity.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes or activity yet.</p>
        ) : (
          <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
            {activity.map((a) => (
              <div key={a.id} className="flex gap-2 text-sm border-b pb-2 last:border-0 last:pb-0">
                <StickyNote className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="break-words">{a.action === "note" ? a.detail?.text : a.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {actorName(a.profiles)} · {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
