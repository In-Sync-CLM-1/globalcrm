import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Unit = "M" | "B";

interface TurnoverRangeFilterProps {
  minM: string; // INR millions as a string, "" = unbounded
  maxM: string;
  onChange: (minM: string, maxM: string) => void;
}

function toMillion(value: string, unit: Unit): string {
  if (value.trim() === "") return "";
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "";
  return String(unit === "B" ? n * 1000 : n);
}

function splitMillion(m: string): { value: string; unit: Unit } {
  const n = parseFloat(m);
  if (m.trim() === "" || !Number.isFinite(n)) return { value: "", unit: "M" };
  if (n >= 1000 && n % 1000 === 0) return { value: String(n / 1000), unit: "B" };
  return { value: String(n), unit: "M" };
}

export function TurnoverRangeFilter({ minM, maxM, onChange }: TurnoverRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const min = splitMillion(minM);
  const max = splitMillion(maxM);

  const label =
    minM || maxM
      ? `₹${min.value ? `${min.value}${min.unit}` : "0"} - ${max.value ? `₹${max.value}${max.unit}` : "Any"}`
      : "Turnover";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3" align="start">
        <p className="text-xs text-muted-foreground">Turnover range (INR)</p>
        <div className="flex items-center gap-2">
          <span className="text-xs w-8 text-muted-foreground">Min</span>
          <Input
            type="number"
            min="0"
            placeholder="0"
            value={min.value}
            onChange={(e) => onChange(toMillion(e.target.value, min.unit), maxM)}
            className="h-8"
          />
          <Select value={min.unit} onValueChange={(u) => onChange(toMillion(min.value, u as Unit), maxM)}>
            <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="M">M</SelectItem>
              <SelectItem value="B">B</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs w-8 text-muted-foreground">Max</span>
          <Input
            type="number"
            min="0"
            placeholder="No limit"
            value={max.value}
            onChange={(e) => onChange(minM, toMillion(e.target.value, max.unit))}
            className="h-8"
          />
          <Select value={max.unit} onValueChange={(u) => onChange(minM, toMillion(max.value, u as Unit))}>
            <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="M">M</SelectItem>
              <SelectItem value="B">B</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(minM || maxM) && (
          <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={() => onChange("", "")}>
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
