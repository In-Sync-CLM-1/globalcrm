import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TrendingUp, Minus, Flame, Snowflake, ThermometerSun, Sparkles, RefreshCw, Loader2 } from "lucide-react";

interface LeadScoreCardProps {
  contactId: string;
  orgId: string;
}

interface ScoreResult {
  score: number;
  category: string;
  breakdown: Record<string, number>;
  reasoning: string;
  last_calculated?: string;
  cached?: boolean;
}

export function LeadScoreCard({ contactId }: LeadScoreCardProps) {
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      // On-demand, cached scoring: the function returns instantly when the
      // lead's parameters are unchanged, and only re-scores with Claude Haiku
      // when something that matters has changed (or when force=true).
      const { data, error } = await supabase.functions.invoke("lead-score", {
        body: { contact_id: contactId, force },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as ScoreResult);
    } catch (e: any) {
      setError(e?.message || "Could not score this lead");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void run(false); }, [run]);

  const category = result?.category;
  const categoryIcon = () => {
    switch (category) {
      case "hot": return <Flame className="h-6 w-6 text-red-500" />;
      case "warm": return <ThermometerSun className="h-6 w-6 text-orange-500" />;
      case "cool": return <ThermometerSun className="h-6 w-6 text-amber-500" />;
      case "cold": return <Snowflake className="h-6 w-6 text-blue-500" />;
      default: return <Minus className="h-6 w-6 text-muted-foreground" />;
    }
  };
  const categoryColor = (): "destructive" | "secondary" | "outline" => {
    switch (category) {
      case "hot": return "destructive";
      case "warm": case "cool": return "secondary";
      default: return "outline";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />Lead Score
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI-scored from stage, engagement & profile
          </CardDescription>
        </div>
        {result && (
          <Button variant="ghost" size="sm" onClick={() => run(true)} disabled={loading} title="Recalculate">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !result && (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Scoring this lead…
          </div>
        )}

        {error && !result && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <Minus className="h-8 w-8 mx-auto mb-2 opacity-20" />
            {error}
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={() => run(true)}>Try again</Button>
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {categoryIcon()}
                <div>
                  <div className="text-3xl font-bold">{result.score}</div>
                  <div className="text-sm text-muted-foreground">out of 100</div>
                </div>
              </div>
              <Badge variant={categoryColor()} className="text-lg px-4 py-2">
                {result.category?.toUpperCase()}
              </Badge>
            </div>

            <Progress value={result.score} className="h-2" />

            {result.reasoning && (
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 leading-relaxed">
                {result.reasoning}
              </p>
            )}

            {result.breakdown && Object.keys(result.breakdown).length > 0 && (
              <div className="pt-2 border-t space-y-2">
                <div className="text-sm font-medium">Score breakdown</div>
                {Object.entries(result.breakdown)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium">{(v as number) > 0 ? "+" : ""}{v as number}</span>
                    </div>
                  ))}
              </div>
            )}

            {result.last_calculated && (
              <div className="text-xs text-muted-foreground">
                {result.cached ? "Scored" : "Updated"} {new Date(result.last_calculated).toLocaleString()}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
