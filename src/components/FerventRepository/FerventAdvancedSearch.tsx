import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { BOOLEAN_SEARCH_FIELDS, type BooleanCondition, type BooleanQuery } from "./ferventBooleanSearch";

function emptyCondition(): BooleanCondition {
  return { field: BOOLEAN_SEARCH_FIELDS[0].key, op: "contains", value: "" };
}

interface FerventAdvancedSearchProps {
  query: BooleanQuery;
  onChange: (query: BooleanQuery) => void;
  onApply: () => void;
  onClear: () => void;
}

export function FerventAdvancedSearch({ query, onChange, onApply, onClear }: FerventAdvancedSearchProps) {
  const conditions = query.conditions.length > 0 ? query.conditions : [emptyCondition()];

  const updateCondition = (index: number, patch: Partial<BooleanCondition>) => {
    const next = conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange({ ...query, conditions: next });
  };

  const addCondition = () => {
    onChange({ ...query, conditions: [...conditions, emptyCondition()] });
  };

  const removeCondition = (index: number) => {
    const next = conditions.filter((_, i) => i !== index);
    onChange({ ...query, conditions: next.length > 0 ? next : [emptyCondition()] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Match</span>
        <Select value={query.mode} onValueChange={(mode) => onChange({ ...query, mode: mode as "all" | "any" })}>
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ALL (AND)</SelectItem>
            <SelectItem value="any">ANY (OR)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">of the following conditions:</span>
      </div>

      <div className="space-y-2">
        {conditions.map((condition, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select value={condition.field} onValueChange={(field) => updateCondition(index, { field })}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOLEAN_SEARCH_FIELDS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={condition.op} onValueChange={(op) => updateCondition(index, { op: op as "contains" | "not_contains" })}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">contains</SelectItem>
                <SelectItem value="not_contains">does NOT contain</SelectItem>
              </SelectContent>
            </Select>

            <Input
              className="flex-1 min-w-[140px]"
              placeholder="Value"
              value={condition.value}
              onChange={(e) => updateCondition(index, { value: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onApply()}
            />

            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeCondition(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={addCondition}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Condition
        </Button>
        <Button size="sm" onClick={onApply}>
          Search
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
