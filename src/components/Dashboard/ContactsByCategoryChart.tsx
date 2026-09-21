import { Card } from "@/components/ui/card";

interface CategoryRow {
  category: string;
  contact_count: number;
}

interface ContactsByCategoryChartProps {
  data: CategoryRow[];
  isLoading?: boolean;
}

// Validated categorical palette (dataviz skill reference palette). Assigned
// by each category's position in a stable alphabetical order, not by rank,
// so a category's color never shifts.
const PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];

export function ContactsByCategoryChart({ data, isLoading }: ContactsByCategoryChartProps) {
  const alphabetical = [...data].map((d) => d.category).sort((a, b) => a.localeCompare(b));
  const colorOf = (category: string) => PALETTE[alphabetical.indexOf(category) % PALETTE.length];

  const byCount = [...data].sort((a, b) => b.contact_count - a.contact_count);
  const total = byCount.reduce((sum, d) => sum + d.contact_count, 0);
  const maxCount = Math.max(...byCount.map((d) => d.contact_count), 1);

  return (
    <Card className="p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Contacts by Category</h3>
        <p className="text-[10px] text-muted-foreground">{total} contacts across {byCount.length} categories</p>
      </div>

      {isLoading ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground animate-pulse">
          Loading…
        </div>
      ) : byCount.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          No categorized contacts yet
        </div>
      ) : (
        <div className="space-y-2.5">
          {byCount.map((row) => {
            const color = colorOf(row.category);
            const pct = maxCount > 0 ? (row.contact_count / maxCount) * 100 : 0;
            return (
              <div key={row.category} className="flex items-center gap-3">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[11px] text-muted-foreground w-40 shrink-0 truncate">
                  {row.category}
                </span>
                <div className="flex-1 relative h-2.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-[11px] font-medium text-foreground w-10 text-right shrink-0">
                  {row.contact_count}
                </span>
                <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                  {total > 0 ? Math.round((row.contact_count / total) * 100) : 0}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
