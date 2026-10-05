import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface RmplProject {
  id: string;
  project_number: string;
  project_name: string;
  status: string | null;
}

interface RmplProjectPickerProps {
  value: string;
  onChange: (projectNumber: string) => void;
}

// Project list is read live from RMPL via /api/rmpl-projects (read-only);
// RMPL owns this data, globalcrm only ever picks a project number from it.
export function RmplProjectPicker({ value, onChange }: RmplProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: projects = [], isLoading, isError } = useQuery({
    queryKey: ["rmpl-projects"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch("/api/rmpl-projects", {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!resp.ok) throw new Error("Could not load projects from RMPL");
      return ((await resp.json()).projects ?? []) as RmplProject[];
    },
  });

  const q = search.trim().toLowerCase();
  const filtered = projects
    .filter((p) => p.project_name.toLowerCase().includes(q) || p.project_number.toLowerCase().includes(q))
    .slice(0, 100);
  const selected = projects.find((p) => p.project_number === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}>
          <span className="truncate">
            {value ? `${value}${selected ? ` — ${selected.project_name}` : ""}` : "Search RMPL projects…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by project name or number…" value={search} onValueChange={setSearch} />
          <CommandList>
            {isLoading ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <CommandEmpty>Could not load projects from RMPL.</CommandEmpty>
            ) : (
              <>
                <CommandEmpty>No matching project.</CommandEmpty>
                <CommandGroup>
                  {filtered.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => { onChange(p.project_number); setSearch(""); setOpen(false); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === p.project_number ? "opacity-100" : "opacity-0")} />
                      <span className="flex flex-col">
                        <span>{p.project_name}</span>
                        <span className="text-xs text-muted-foreground">{p.project_number}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
