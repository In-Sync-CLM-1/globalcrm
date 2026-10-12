import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import InsightCard from "@/components/Campaigns/Insights/InsightCard";
import AIChatInterface from "@/components/Campaigns/Insights/AIChatInterface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/UrlTabs";

export default function AIInsightsDashboard() {
  const notify = useNotification();
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

  const { data: insights, isLoading, refetch } = useQuery({
    queryKey: ["campaign-insights", priorityFilter],
    queryFn: async () => {
      let query = supabase
        .from("campaign_insights")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (priorityFilter) {
        query = query.eq("priority", priorityFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const { lastRefresh, manualRefresh } = useAutoRefresh({
    onRefresh: () => refetch(),
    intervalMs: 900000, // 15 minutes
  });

  const handleRefresh = () => {
    manualRefresh();
    notify.info("Refreshing insights", "AI insights are being updated");
  };

  const highPriorityCount = insights?.filter((i) => i.priority === "high").length || 0;
  const mediumPriorityCount = insights?.filter((i) => i.priority === "medium").length || 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">AI Insights</h1>
            <p className="text-muted-foreground mt-1">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">High Priority Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{highPriorityCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Medium Priority</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{mediumPriorityCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Total Active Insights</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{insights?.length || 0}</div>
            </CardContent>
          </Card>
        </div>

        <UrlTabs param="tab" defaultValue="insights" className="space-y-4">
          <TabsList>
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
            <TabsTrigger value="chat">Ask AI</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4">
            {/* Priority Filter */}
            <div className="flex gap-2">
              <Button
                variant={priorityFilter === null ? "default" : "outline"}
                size="sm"
                onClick={() => setPriorityFilter(null)}
              >
                All
              </Button>
              <Button
                variant={priorityFilter === "high" ? "default" : "outline"}
                size="sm"
                onClick={() => setPriorityFilter("high")}
              >
                High Priority
              </Button>
              <Button
                variant={priorityFilter === "medium" ? "default" : "outline"}
                size="sm"
                onClick={() => setPriorityFilter("medium")}
              >
                Medium Priority
              </Button>
              <Button
                variant={priorityFilter === "low" ? "default" : "outline"}
                size="sm"
                onClick={() => setPriorityFilter("low")}
              >
                Low Priority
              </Button>
            </div>

            {/* Insights List */}
            <div className="space-y-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading insights...</div>
              ) : insights && insights.length > 0 ? (
                insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} onUpdate={refetch} />
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No insights available. AI will analyze your campaigns and generate recommendations.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="chat">
            <AIChatInterface />
          </TabsContent>
        </UrlTabs>
      </div>
    </DashboardLayout>
  );
}