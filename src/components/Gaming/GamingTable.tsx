import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Shared look for the Gaming dashboards' tables: quiet header band, roomy rows, aligned figures. */

export function TableCard({ title, subtitle, action, children }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden rounded-xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

/** Header cell: small caps on a tinted band. */
export function TH({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return (
    <TableHead className={cn("h-10 whitespace-nowrap bg-muted/50 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", right && "text-right", className)}>
      {children}
    </TableHead>
  );
}

export const ROW = "transition-colors even:bg-muted/20 hover:bg-muted/50";
export const CELL = "py-2.5";
export const NUM = "py-2.5 text-right tabular-nums";

/** A figure, with zero or missing shown as a quiet dash so real values stand out. */
export function Fig({ v, bold }: { v: number | string | null | undefined; bold?: boolean }) {
  if (v === null || v === undefined || v === 0 || v === "") return <span className="text-muted-foreground/50">–</span>;
  return <span className={bold ? "font-semibold text-foreground" : "text-foreground"}>{typeof v === "number" ? v.toLocaleString("en-IN") : v}</span>;
}

/** Initials in a soft circle, then the name. */
export function Person({ name, sub }: { name: string; sub?: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initials}</span>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-medium text-foreground">{name}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

const TONES = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200", warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200", info: "bg-orange-50 text-orange-700 ring-orange-200", neutral: "bg-slate-50 text-slate-600 ring-slate-200",
} as const;
const DOTS = { good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", info: "bg-orange-500", neutral: "bg-slate-400" } as const;
export type Tone = keyof typeof TONES;

/** A state name with a status dot. Status colours live only here. */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />{children}
    </span>
  );
}

/** One day cell in the attendance grid. */
export function DayChip({ code, label }: { code: string; label: string }) {
  const tone: Record<string, string> = { P: "bg-emerald-500 text-white", L: "bg-amber-400 text-amber-950", H: "bg-orange-400 text-orange-950", A: "bg-rose-500 text-white", "-": "bg-muted text-muted-foreground" };
  return <span title={label} className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold", tone[code] ?? tone["-"])}>{code === "-" ? "" : code}</span>;
}
