import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface PipelineStage {
  id: string;
  name: string;
  color: string;
}

interface PipelineUser {
  id: string;
  first_name: string;
  last_name: string;
}

export interface PipelineFiltersState {
  name: string;
  company: string;
  stageId: string;
  product: string;
  emailOutreachStatus: string;
  whatsappOutreachStatus: string;
  assignedTo: string;
  dispositionId: string;
  matchMode: "exact" | "contains";
}

interface PipelineDisposition {
  id: string;
  name: string;
}

interface PipelineFiltersProps {
  filters: PipelineFiltersState;
  stages: PipelineStage[];
  users?: PipelineUser[];
  dispositions?: PipelineDisposition[];
  onFiltersChange: (filters: PipelineFiltersState) => void;
  onSearch: () => void;
  onClear: () => void;
  isSearching?: boolean;
  resultCount?: number;
  totalCount?: number;
}

const emptyFilters: PipelineFiltersState = {
  name: "",
  company: "",
  stageId: "",
  product: "",
  emailOutreachStatus: "",
  whatsappOutreachStatus: "",
  assignedTo: "",
  dispositionId: "",
  matchMode: "contains",
};

const EMAIL_OUTREACH_OPTIONS = [
  { value: "clicked", label: "Clicked" },
  { value: "opened", label: "Opened" },
  { value: "delivered-no-open", label: "Delivered" },
  { value: "sent-pending", label: "Sent" },
  { value: "queued", label: "Queued" },
  { value: "skipped", label: "Skipped" },
  { value: "bounced", label: "Bounced" },
  { value: "failed", label: "Failed" },
];

const WHATSAPP_OUTREACH_OPTIONS = [
  { value: "delivered", label: "Delivered" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "not-attempted", label: "Not Attempted" },
];

export function PipelineFilters({
  filters,
  stages,
  users = [],
  dispositions = [],
  onFiltersChange,
  onSearch,
  onClear,
  isSearching = false,
  resultCount,
  totalCount,
}: PipelineFiltersProps) {
  const [isOpen, setIsOpen] = useState(true);

  const handleChange = (field: keyof PipelineFiltersState, value: string) => {
    onFiltersChange({ ...filters, [field]: value });
  };

  const hasActiveFilters = Object.entries(filters).some(([key, v]) => key !== "matchMode" && v !== "");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSearching) {
      onSearch();
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg bg-card">
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Field Filters</span>
            {hasActiveFilters && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                Active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {resultCount !== undefined && totalCount !== undefined && resultCount !== totalCount && (
              <span className="text-xs text-muted-foreground">
                {resultCount} of {totalCount}
              </span>
            )}
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-3 pt-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Match mode for Name / Company / Targeted Product
            </span>
            <ToggleGroup
              type="single"
              size="sm"
              value={filters.matchMode}
              onValueChange={(v) => v && handleChange("matchMode", v)}
            >
              <ToggleGroupItem value="exact" className="text-xs px-2.5 h-7">Exact</ToggleGroupItem>
              <ToggleGroupItem value="contains" className="text-xs px-2.5 h-7">Contains</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
            <Input
              placeholder="Name"
              value={filters.name}
              onChange={(e) => handleChange("name", e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Company"
              value={filters.company}
              onChange={(e) => handleChange("company", e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-xs"
            />
            <Select
              value={filters.stageId}
              onValueChange={(v) => handleChange("stageId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Targeted Product"
              value={filters.product}
              onChange={(e) => handleChange("product", e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-xs"
            />
            <Select
              value={filters.emailOutreachStatus}
              onValueChange={(v) => handleChange("emailOutreachStatus", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Email Outreach State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Email States</SelectItem>
                {EMAIL_OUTREACH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.whatsappOutreachStatus}
              onValueChange={(v) => handleChange("whatsappOutreachStatus", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="WhatsApp Outreach State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All WhatsApp States</SelectItem>
                {WHATSAPP_OUTREACH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.assignedTo}
              onValueChange={(v) => handleChange("assignedTo", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Assigned To" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignments</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((u) => {
                  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "User";
                  return (
                    <SelectItem key={u.id} value={u.id}>
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select
              value={filters.dispositionId}
              onValueChange={(v) => handleChange("dispositionId", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Latest Disposition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dispositions</SelectItem>
                <SelectItem value="none">No Disposition Yet</SelectItem>
                {dispositions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              onClick={onSearch}
              disabled={isSearching}
              className="h-8 text-xs"
            >
              <Search className="h-3 w-3 mr-1" />
              Search
            </Button>
            {hasActiveFilters && (
              <Button
                size="sm"
                variant="outline"
                onClick={onClear}
                disabled={isSearching}
                className="h-8 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export { emptyFilters };
