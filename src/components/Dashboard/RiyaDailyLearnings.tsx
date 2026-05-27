import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, MessageSquareOff, Wrench, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface Insight {
  wins?: { title: string; detail: string }[];
  losses?: { title: string; detail: string }[];
  objections?: { label: string; count: number; issue: string }[];
  tweaks?: { title: string; change: string }[];
}

interface Row {
  for_date: string;
  call_count: number;
  completed_count: number;
  insights: Insight;
  generated_at: string;
}

// product = "__all__" (default) shows the org-wide lump; pass a product name
// (e.g. "Worksync") to show that one agent's learnings.
export function RiyaDailyLearnings({ product = "__all__" }: { product?: string } = {}) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("ai_daily_insights")
        .select("for_date, call_count, completed_count, insights, generated_at")
        .eq("product", product)
        .order("for_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setRow(!error && data ? (data as unknown as Row) : null);
      setLoading(false);
    };
    setLoading(true);
    load();
    const t = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [product]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Loading learnings…</CardContent>
      </Card>
    );
  }

  if (!row) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <Lightbulb className="h-5 w-5 opacity-50" />
          Awaiting today's analysis. Runs automatically at 17:35 IST.
        </CardContent>
      </Card>
    );
  }

  const ins = row.insights || {};
  const wins = ins.wins || [];
  const losses = ins.losses || [];
  const objections = ins.objections || [];
  const tweaks = ins.tweaks || [];

  return (
    <Card className="border-2 border-amber-500/20 bg-gradient-to-br from-card via-card to-amber-500/[0.04]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-5 w-5 text-amber-500" />
          Key Learnings
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {row.for_date} · {row.completed_count} of {row.call_count} calls analysed
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              WHAT WORKED
            </div>
            <div className="space-y-1.5">
              {wins.length === 0 && (
                <div className="text-xs text-muted-foreground italic">No wins extracted.</div>
              )}
              {wins.map((w, i) => (
                <InsightTile key={i} tone="success" title={w.title} detail={w.detail} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              WHAT'S LEAKING
            </div>
            <div className="space-y-1.5">
              {losses.length === 0 && (
                <div className="text-xs text-muted-foreground italic">No leakage points extracted.</div>
              )}
              {losses.map((l, i) => (
                <InsightTile key={i} tone="warning" title={l.title} detail={l.detail} />
              ))}
            </div>
          </div>
        </div>

        {objections.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <MessageSquareOff className="h-4 w-4" />
              RECURRING OBJECTIONS
            </div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {objections.map((o, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md p-2 bg-muted/40 border">
                  <Badge variant="outline" className="shrink-0 tabular-nums">{o.count}</Badge>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{o.label}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{o.issue}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tweaks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
              <Wrench className="h-4 w-4" />
              SUGGESTED SCRIPT TWEAKS
            </div>
            <ol className="space-y-1.5">
              {tweaks.map((t, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md p-2 bg-blue-500/[0.05] border border-blue-500/15"
                >
                  <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 text-xs font-bold">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.change}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground text-right pt-1">
          Auto-generated{" "}
          {new Date(row.generated_at).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "short",
            timeStyle: "short",
          })}{" "}
          IST
        </div>
      </CardContent>
    </Card>
  );
}

function InsightTile({ tone, title, detail }: { tone: "success" | "warning"; title: string; detail: string }) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/10 border-emerald-500/20"
      : "bg-amber-500/10 border-amber-500/20";
  return (
    <div className={cn("rounded-md p-2 border", cls)}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
