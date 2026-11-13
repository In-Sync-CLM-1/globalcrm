import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import InsightCard from "@/components/Campaigns/Insights/InsightCard";
import AIChatInterface from "./AIChatInterface";
import PipelineInsightsCard from "./PipelineInsightsCard";
import { Lightbulb, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { useState } from "react";
import { useUrlState } from "@/hooks/useUrlState";

export default function AIInsightsTab() {
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [filter, setFilter] = useUrlState<'all' | 'pipeline' | 'campaign'>("aifilter", 'all');

  // Fetch AI insights
  const { data: aiInsights = [], isLoading, refetch } = useQuery({
    queryKey: ['campaign-insights', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      
      const { data, error } = await supabase
        .from('campaign_insights')
        .select('*')
        .eq('org_id', effectiveOrgId)
        .eq('status', 'active')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  // Separate and filter insights
  const pipelineInsights = aiInsights.filter(i => !i.campaign_id);
  const campaignInsights = aiInsights.filter(i => i.campaign_id);
  
  const filteredInsights = filter === 'all' ? aiInsights :
                          filter === 'pipeline' ? pipelineInsights : campaignInsights;

  // Sort by priority (high > medium > low)
  const sortedInsights = [...filteredInsights].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority as keyof typeof priorityOrder] - 
           priorityOrder[b.priority as keyof typeof priorityOrder];
  });

  // Fetch pipeline metrics
  const { data: pipelineMetrics = [], isLoading: pipelineLoading } = useQuery({
    queryKey: ['pipeline-metrics', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      
      const [stagesRes, contactsRes, movementsRes] = await Promise.all([
        supabase.from('pipeline_stages').select('*').eq('org_id', effectiveOrgId).order('stage_order'),
        supabase.from('contacts').select('id, pipeline_stage_id').eq('org_id', effectiveOrgId),
        supabase.from('pipeline_movement_history')
          .select('*')
          .eq('org_id', effectiveOrgId)
          .gte('moved_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      ]);

      if (!stagesRes.data) return [];

      return stagesRes.data.map((stage, idx) => {
        const stageContacts = contactsRes.data?.filter(c => c.pipeline_stage_id === stage.id) || [];
        const stageMovements = movementsRes.data?.filter(m => m.from_stage_id === stage.id) || [];
        
        const avgDays = stageMovements.length > 0
          ? Math.round(stageMovements.reduce((sum, m) => sum + (m.days_in_previous_stage || 0), 0) / stageMovements.length)
          : 0;

        const nextStageId = stagesRes.data[idx + 1]?.id;
        const movedToNext = movementsRes.data?.filter(m => 
          m.from_stage_id === stage.id && m.to_stage_id === nextStageId
        ).length || 0;
        
        const conversionRate = stageMovements.length > 0 
          ? Math.round((movedToNext / stageMovements.length) * 100)
          : 0;

        return {
          name: stage.name,
          count: stageContacts.length,
          probability: stage.probability || 0,
          avgDays,
          conversionRate,
          trend: (conversionRate > 60 ? 'up' : conversionRate < 40 ? 'down' : 'neutral') as 'up' | 'down' | 'neutral',
        };
      });
    },
    enabled: !!effectiveOrgId,
  });

  const handleRefreshInsights = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke('analyze-pipeline-performance');
      if (error) throw error;
      
      notify.success("Success", "Insights are being refreshed. Check back in a moment.");
      setTimeout(() => refetch(), 3000);
    } catch (error) {
      notify.error("Error", "Failed to refresh insights");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6" />
            AI-Powered Insights
          </h2>
          <p className="text-muted-foreground">
            Pipeline intelligence and campaign recommendations in one place
          </p>
        </div>
        <Button onClick={handleRefreshInsights} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh Insights
        </Button>
      </div>

      {/* Pipeline Health Overview */}
      {pipelineLoading ? (
        <Card>
          <CardContent className="py-12">
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      ) : pipelineMetrics.length > 0 && (
        <PipelineInsightsCard metrics={pipelineMetrics} />
      )}

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">
            All Insights ({aiInsights.length})
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            Pipeline ({pipelineInsights.length})
          </TabsTrigger>
          <TabsTrigger value="campaign">
            Campaigns ({campaignInsights.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* AI Recommendations */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : sortedInsights.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Lightbulb className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No insights available yet</p>
            <p className="text-muted-foreground">
              AI insights will appear here based on your pipeline and campaign performance
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sortedInsights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} onUpdate={() => refetch()} />
          ))}
        </div>
      )}

      {/* Collapsible AI Assistant */}
      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setChatExpanded(!chatExpanded)}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>AI Assistant</CardTitle>
              <CardDescription>
                Ask questions about your pipeline and campaigns
              </CardDescription>
            </div>
            {chatExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </CardHeader>
        {chatExpanded && (
          <CardContent>
            <AIChatInterface />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
