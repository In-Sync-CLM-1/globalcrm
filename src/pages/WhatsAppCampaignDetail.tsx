import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useNotification } from "@/hooks/useNotification";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { ArrowLeft, RefreshCw, Download, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useUrlState } from "@/hooks/useUrlState";

export default function WhatsAppCampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useNotification();
  
  const [campaign, setCampaign] = useState<any>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useUrlState<string>("filter", "all");

  const fetchCampaignDetails = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_bulk_campaigns")
      .select("*")
      .eq("id", id)
      .single();
    
    setCampaign(data);
    fetchRecipients();
    setLoading(false);
  };

  const fetchRecipients = async () => {
    let query = supabase
      .from("whatsapp_campaign_recipients")
      .select("*, contacts(first_name, last_name)")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false });

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    setRecipients(data || []);
  };

  useEffect(() => {
    if (id) {
      fetchCampaignDetails();
    }
  }, [id]);

  useRealtimeSync({
    table: 'whatsapp_bulk_campaigns',
    filter: `id=eq.${id}`,
    onUpdate: fetchCampaignDetails,
    enabled: !!id,
  });

  useRealtimeSync({
    table: 'whatsapp_campaign_recipients',
    filter: `campaign_id=eq.${id}`,
    onUpdate: fetchRecipients,
    enabled: !!id,
  });

  useEffect(() => {
    if (id) {
      fetchRecipients();
    }
  }, [filter]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: { variant: "secondary", label: "Pending" },
      sent: { variant: "default", label: "Sent" },
      failed: { variant: "destructive", label: "Failed" },
      retrying: { variant: "outline", label: "Retrying" },
      permanently_failed: { variant: "destructive", label: "Permanently Failed" },
      cancelled: { variant: "outline", label: "Cancelled" },
    };
    
    const config = variants[status] || variants.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const handleRetryFailed = async () => {
    const { error } = await supabase.functions.invoke('retry-failed-whatsapp', {
      body: { campaignId: id },
    });

    if (error) {
      notify.error("Error", error.message);
    } else {
      notify.success("Retry Initiated", "Failed messages will be retried");
    }
  };

  const handleExport = () => {
    const csv = [
      ["Name", "Phone", "Status", "Error", "Retry Count"].join(","),
      ...recipients.map(r => [
        `${r.contacts?.first_name} ${r.contacts?.last_name}`,
        r.phone_number,
        r.status,
        r.error_message || "",
        r.retry_count,
      ].join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${id}-recipients.csv`;
    a.click();
  };

  const handleCancelCampaign = async () => {
    if (!confirm("Are you sure you want to cancel this campaign? Pending messages will not be sent.")) {
      return;
    }

    try {
      // Update all pending recipients to cancelled
      const { error: recipientsError } = await supabase
        .from("whatsapp_campaign_recipients")
        .update({ status: "cancelled" })
        .eq("campaign_id", id)
        .in("status", ["pending", "retrying"]);

      if (recipientsError) throw recipientsError;

      // Update campaign status to cancelled
      const { error: campaignError } = await supabase
        .from("whatsapp_bulk_campaigns")
        .update({ 
          status: "cancelled",
          completed_at: new Date().toISOString(),
          pending_count: 0,
        })
        .eq("id", id);

      if (campaignError) throw campaignError;

      notify.success("Campaign Cancelled", "The campaign has been cancelled successfully");

      fetchCampaignDetails();
    } catch (error: any) {
      notify.error("Error", error.message);
    }
  };

  if (loading || !campaign) {
    return <div className="container mx-auto p-6">Loading...</div>;
  }

  const progress = campaign.total_recipients > 0 
    ? ((campaign.sent_count + campaign.failed_count) / campaign.total_recipients) * 100 
    : 0;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Campaigns
        </Button>
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{campaign.name}</h1>
            <div className="flex gap-2 items-center mt-2">
              <Badge variant={campaign.status === "completed" ? "default" : campaign.status === "processing" ? "secondary" : "outline"}>
                {campaign.status}
              </Badge>
              {campaign.started_at && (
                <span className="text-sm text-muted-foreground">
                  Started {formatDistanceToNow(new Date(campaign.started_at), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
          {campaign.status === "processing" && (
            <Button variant="destructive" onClick={handleCancelCampaign}>
              <XCircle className="mr-2 h-4 w-4" />
              Cancel Campaign
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Total Recipients</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaign.total_recipients}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{campaign.sent_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{campaign.failed_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{campaign.pending_count}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={progress} className="h-4" />
          <p className="text-sm text-muted-foreground mt-2">
            {Math.round(progress)}% complete
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Recipients</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              {campaign.failed_count > 0 && (
                <Button variant="outline" size="sm" onClick={handleRetryFailed}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry Failed
                </Button>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            {["all", "sent", "failed", "pending", "retrying", "cancelled"].map((status) => (
              <Button
                key={status}
                variant={filter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(status)}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Retry Count</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((recipient) => (
                <TableRow key={recipient.id}>
                  <TableCell>
                    {recipient.contacts?.first_name} {recipient.contacts?.last_name}
                  </TableCell>
                  <TableCell>{recipient.phone_number}</TableCell>
                  <TableCell>{getStatusBadge(recipient.status)}</TableCell>
                  <TableCell>{recipient.retry_count}/{recipient.max_retries}</TableCell>
                  <TableCell className="text-sm text-red-600">
                    {recipient.error_message}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(recipient.updated_at), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
