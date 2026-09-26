import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface RmplProject {
  id: string;
  project_number: string | null;
  project_name: string | null;
}

interface RmplProjectPickerProps {
  value: string | null;
  onChange: (projectId: string) => void;
  placeholder?: string;
}

// No free text -- this is a required pointer to a real RMPL OPM project
// (see 20260926100000_clients_rmpl_project_id.sql), so it must come from a
// live list, same as RMPL's own ProjectPicker/BillingProjectPicker pattern.
export function RmplProjectPicker({ value, onChange, placeholder = "Select the RMPL project…" }: RmplProjectPickerProps) {
  const [open, setOpen] = useState(false);

  const { data: projects, isLoading, isError } = useQuery({
    queryKey: ["rmpl-project-picker-list"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("rmpl-project-list");
      if (error) throw error;
      return (data?.projects ?? []) as RmplProject[];
    },
  });

  const selected = projects?.find((p) => p.id === value);
  const label = (p: RmplProject) => [p.project_number, p.project_name].filter(Boolean).join(" — ") || p.id;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected ? label(selected) : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search RMPL projects..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : isError ? "Couldn't load RMPL projects." : "No project found."}
            </CommandEmpty>
            <CommandGroup>
              {projects?.map((p) => (
                <CommandItem
                  key={p.id}
                  value={label(p)}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  {label(p)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
