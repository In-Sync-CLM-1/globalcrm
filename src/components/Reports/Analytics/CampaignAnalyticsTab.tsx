import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, MessageSquare } from "lucide-react";
import DateRangeFilter from "./DateRangeFilter";
import PerformanceTrendChart from "./PerformanceTrendChart";
import ChannelPerformanceTable from "./ChannelPerformanceTable";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UrlTabs } from "@/components/UrlTabs";

export default function CampaignAnalyticsTab() {
  const { effectiveOrgId } = useOrgContext();
  const [dateRange, setDateRange] = useState({ from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), to: new Date() });

  const { data: emailCampaigns = [], isLoading: emailLoading } = useQuery({
    queryKey: ['email-campaigns-analytics', effectiveOrgId, dateRange],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from('email_bulk_campaigns')
        .select('*')
        .eq('org_id', effectiveOrgId)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  const { data: whatsappCampaigns = [], isLoading: whatsappLoading } = useQuery({
    queryKey: ['whatsapp-campaigns-analytics', effectiveOrgId, dateRange],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from('whatsapp_bulk_campaigns')
        .select('*')
        .eq('org_id', effectiveOrgId)
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Campaign Analytics</h2>
          <p className="text-muted-foreground">Track email and WhatsApp campaign performance</p>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <UrlTabs param="campaignanalyticstab_tab" defaultValue="email" className="space-y-4">
        <TabsList>
          <TabsTrigger value="email">
            <Mail className="h-4 w-4 mr-2" />
            Email Campaigns
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageSquare className="h-4 w-4 mr-2" />
            WhatsApp Campaigns
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="space-y-4">
          <PerformanceTrendChart 
            data={emailCampaigns} 
            isLoading={emailLoading}
            channelType="email"
          />
          <ChannelPerformanceTable 
            data={emailCampaigns} 
            isLoading={emailLoading}
            channelType="email"
          />
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          <PerformanceTrendChart 
            data={whatsappCampaigns} 
            isLoading={whatsappLoading}
            channelType="whatsapp"
          />
          <ChannelPerformanceTable 
            data={whatsappCampaigns} 
            isLoading={whatsappLoading}
            channelType="whatsapp"
          />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
