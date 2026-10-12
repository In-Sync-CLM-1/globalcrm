import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrgContext } from "@/hooks/useOrgContext";
import { 
  BarChart3, TrendingUp, Mail, Eye, 
  MousePointer, DollarSign, Clock, Calendar,
  Download
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUrlState } from "@/hooks/useUrlState";

export function AdvancedReporting() {
  const { effectiveOrgId } = useOrgContext();
  const [dateRange, setDateRange] = useUrlState("range", 30);
  const [selectedRuleId, setSelectedRuleId] = useUrlState<string>("rule", "all");

  const { data: rules } = useQuery({
    queryKey: ['email-automation-rules', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_automation_rules')
        .select('id, name')
        .eq('org_id', effectiveOrgId)
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  const { data: dailyPerformance, isLoading } = useQuery({
    queryKey: ['automation-performance-daily', effectiveOrgId, selectedRuleId, dateRange],
    queryFn: async () => {
      let query = supabase
        .from('automation_performance_daily')
        .select('*')
        .eq('org_id', effectiveOrgId)
        .gte('report_date', new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('report_date', { ascending: false });

      if (selectedRuleId !== 'all') {
        query = query.eq('rule_id', selectedRuleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  const aggregatedStats = dailyPerformance?.reduce(
    (acc, day) => ({
      totalSent: acc.totalSent + day.total_sent,
      totalOpened: acc.totalOpened + day.total_opened,
      totalClicked: acc.totalClicked + day.total_clicked,
      totalConverted: acc.totalConverted + day.total_converted,
      totalRevenue: acc.totalRevenue + Number(day.total_conversion_value || 0),
      uniqueOpens: acc.uniqueOpens + day.unique_opens,
      uniqueClicks: acc.uniqueClicks + day.unique_clicks,
    }),
    {
      totalSent: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalConverted: 0,
      totalRevenue: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
    }
  );

  const openRate = aggregatedStats?.totalSent 
    ? ((aggregatedStats.totalOpened / aggregatedStats.totalSent) * 100).toFixed(1)
    : "0";
  
  const clickRate = aggregatedStats?.totalSent
    ? ((aggregatedStats.totalClicked / aggregatedStats.totalSent) * 100).toFixed(1)
    : "0";
  
  const conversionRate = aggregatedStats?.totalSent
    ? ((aggregatedStats.totalConverted / aggregatedStats.totalSent) * 100).toFixed(1)
    : "0";

  const handleExport = () => {
    if (!dailyPerformance) return;
    
    const csv = [
      ['Date', 'Sent', 'Opened', 'Clicked', 'Converted', 'Revenue', 'Open Rate', 'Click Rate'].join(','),
      ...dailyPerformance.map(day => [
        day.report_date,
        day.total_sent,
        day.total_opened,
        day.total_clicked,
        day.total_converted,
        day.total_conversion_value || 0,
        day.total_sent > 0 ? ((day.total_opened / day.total_sent) * 100).toFixed(1) : 0,
        day.total_sent > 0 ? ((day.total_clicked / day.total_sent) * 100).toFixed(1) : 0,
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `automation-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Select value={dateRange.toString()} onValueChange={(v) => setDateRange(parseInt(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
            <SelectTrigger className="w-[250px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Rules</SelectItem>
              {rules?.map((rule) => (
                <SelectItem key={rule.id} value={rule.id}>
                  {rule.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">
                  {aggregatedStats?.totalSent || 0}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Emails Sent
                </p>
              </div>
              <Mail className="h-8 w-8 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{openRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Open Rate
                </p>
              </div>
              <Eye className="h-8 w-8 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{clickRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Click Rate
                </p>
              </div>
              <MousePointer className="h-8 w-8 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{conversionRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Conversion Rate
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Performance</CardTitle>
          <CardDescription>
            Detailed breakdown by day
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading performance data...
            </div>
          ) : dailyPerformance && dailyPerformance.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Clicked</TableHead>
                  <TableHead>Converted</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Avg Time to Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyPerformance.map((day) => {
                  const dayOpenRate = day.total_sent > 0 
                    ? ((day.total_opened / day.total_sent) * 100).toFixed(1)
                    : "0";
                  const dayClickRate = day.total_sent > 0
                    ? ((day.total_clicked / day.total_sent) * 100).toFixed(1)
                    : "0";
                  
                  return (
                    <TableRow key={day.id}>
                      <TableCell>
                        {new Date(day.report_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{day.total_sent}</TableCell>
                      <TableCell>
                        {day.total_opened}
                        <Badge variant="outline" className="ml-2 text-xs">
                          {dayOpenRate}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {day.total_clicked}
                        <Badge variant="outline" className="ml-2 text-xs">
                          {dayClickRate}%
                        </Badge>
                      </TableCell>
                      <TableCell>{day.total_converted}</TableCell>
                      <TableCell>
                        ${Number(day.total_conversion_value || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {day.avg_time_to_open_minutes 
                          ? `${Number(day.avg_time_to_open_minutes).toFixed(0)}m`
                          : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>No performance data available</p>
              <p className="text-sm mt-1">
                Data will appear after automations run
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
