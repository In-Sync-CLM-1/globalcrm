import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useNotification } from "@/hooks/useNotification";
import { Bookmark, Trash2 } from "lucide-react";
import type { SavedSearchDefinition } from "./ferventBooleanSearch";

interface SavedSearchRow {
  id: string;
  name: string;
  definition: SavedSearchDefinition;
  created_at: string;
}

interface FerventSavedSearchesProps {
  orgId: string;
  currentDefinition: SavedSearchDefinition;
  onLoad: (definition: SavedSearchDefinition) => void;
}

export function FerventSavedSearches({ orgId, currentDefinition, onLoad }: FerventSavedSearchesProps) {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: searches = [], isLoading } = useQuery({
    queryKey: ["fervent-saved-searches", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fervent_saved_searches")
        .select("id, name, definition, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SavedSearchRow[];
    },
    enabled: open && !!orgId,
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("fervent_saved_searches").insert({
        org_id: orgId,
        created_by: user.id,
        name: name.trim(),
        definition: currentDefinition,
      });
      if (error) throw error;

      notify.success("Search saved", `"${name.trim()}" is now available to your team.`);
      setName("");
      setShowSaveDialog(false);
      queryClient.invalidateQueries({ queryKey: ["fervent-saved-searches", orgId] });
    } catch (err: any) {
      notify.error("Couldn't save search", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("fervent_saved_searches").delete().eq("id", id);
    if (error) {
      notify.error("Couldn't delete", error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["fervent-saved-searches", orgId] });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Bookmark className="h-4 w-4 mr-2" />
            Saved Searches
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0" align="start">
          <div className="p-3 border-b">
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setShowSaveDialog(true);
              }}
            >
              Save Current Search
            </Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <p className="text-xs text-muted-foreground p-3">Loading...</p>
            ) : searches.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No saved searches yet.</p>
            ) : (
              searches.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50 border-b last:border-0">
                  <button
                    className="flex-1 text-left text-sm truncate"
                    onClick={() => {
                      onLoad(s.definition);
                      setOpen(false);
                    }}
                    title={s.name}
                  >
                    {s.name}
                    <span className="block text-xs text-muted-foreground">
                      {s.definition.mode === "advanced" ? "Advanced" : "Filters"}
                    </span>
                  </button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDelete(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save Current Search</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mumbai CXOs, no email" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
