import { useMemo } from "react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useOrgData } from "@/hooks/useOrgData";
import { DashboardLayout } from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { MessageSquare, CheckCircle2, XCircle, Clock, Send, RefreshCw, Download } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { exportToCSV, ExportColumn, formatDateForExport } from "@/utils/exportUtils";
import { requestExport } from "@/lib/exportJobs";
import { useDbExports } from "@/hooks/useDbExports";
import { ExportHistoryButton } from "@/components/Exports/ExportHistoryButton";

interface WhatsAppMessage {
  id: string;
  contact_id: string;
  phone_number: string;
  message_content: string;
  status: string;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  contacts: {
    first_name: string;
    last_name: string | null;
  };
  sent_by_profile: {
    first_name: string;
    last_name: string;
  } | null;
}

const WhatsAppDashboard = () => {
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const dbExports = useDbExports();

  // Fetch messages using useOrgData for automatic caching
  const { data: messages = [], isLoading, refetch: refetchMessages } = useOrgData<WhatsAppMessage>(
    'whatsapp_messages',
    {
      select: `
        *,
        contacts (first_name, last_name),
        sent_by_profile:profiles!sent_by (first_name, last_name)
      `,
      orderBy: { column: 'sent_at', ascending: false },
      enabled: !!effectiveOrgId,
    }
  );

  // Calculate stats in memory instead of 5 separate queries
  const stats = useMemo(() => {
    if (!messages || messages.length === 0) {
      return {
        total: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
      };
    }

    return {
      total: messages.length,
      sent: messages.filter((m: any) => m.status === 'sent').length,
      delivered: messages.filter((m: any) => m.status === 'delivered').length,
      read: messages.filter((m: any) => m.status === 'read').length,
      failed: messages.filter((m: any) => m.status === 'failed').length,
    };
  }, [messages]);

  const { lastRefresh, manualRefresh } = useAutoRefresh({
    onRefresh: () => {
      refetchMessages();
    },
    intervalMs: 900000, // 15 minutes
  });

  const handleExport = async () => {
    if (dbExports.enabled) {
      try {
        await requestExport("whatsapp_messages", {}, `whatsapp-messages-${new Date().toISOString().split("T")[0]}.csv`);
        notify.success("Preparing your export", "It will download by itself when ready. You can keep working, and it also stays in Export History for 7 days.");
      } catch (err) {
        notify.error("Export failed", (err as Error).message);
      }
      return;
    }
    try {
      const columns: ExportColumn[] = [
        { 
          key: 'contact_name',
          label: 'Contact',
          format: (value: any, row: any) => {
            return `${row.contacts?.first_name || ''} ${row.contacts?.last_name || ''}`.trim();
          }
        },
        { key: 'phone_number', label: 'Phone' },
        { key: 'message_content', label: 'Message' },
        { key: 'status', label: 'Status' },
        { 
          key: 'sent_by',
          label: 'Sent By',
          format: (value: any, row: any) => {
            return row.sent_by_profile 
              ? `${row.sent_by_profile.first_name} ${row.sent_by_profile.last_name}`
              : 'System';
          }
        },
        { key: 'sent_at', label: 'Sent At', format: formatDateForExport },
      ];

      exportToCSV(messages, columns, `whatsapp-messages-${new Date().toISOString().split('T')[0]}`);
      
      notify.success("Success", "Messages exported successfully");
    } catch (error) {
      notify.error("Error", "Failed to export messages");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "sent":
        return <Badge variant="secondary"><Send className="mr-1 h-3 w-3" />Sent</Badge>;
      case "delivered":
        return <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" />Delivered</Badge>;
      case "read":
        return <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" />Read</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Failed</Badge>;
      case "pending":
        return <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading WhatsApp messages..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">WhatsApp Messages</h1>
            <p className="text-muted-foreground mt-2">
              Track and monitor your WhatsApp message delivery
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={manualRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {dbExports.enabled && <ExportHistoryButton />}
            <Button variant="outline" size="sm" onClick={handleExport} disabled={messages.length === 0 || !dbExports.ready}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sent</CardTitle>
              <Send className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.sent}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivered</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.delivered}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Read</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.read}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Failed</CardTitle>
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Messages</CardTitle>
            <CardDescription>Last 100 WhatsApp messages sent</CardDescription>
          </CardHeader>
          <CardContent>
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No messages yet</h3>
                <p className="text-muted-foreground">
                  WhatsApp messages will appear here once you start sending them
                </p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent By</TableHead>
                      <TableHead>Sent At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messages.map((message) => (
                      <TableRow key={message.id}>
                        <TableCell className="font-medium">
                          {message.contacts.first_name} {message.contacts.last_name}
                        </TableCell>
                        <TableCell>{message.phone_number}</TableCell>
                        <TableCell className="max-w-md truncate">
                          {message.message_content}
                        </TableCell>
                        <TableCell>{getStatusBadge(message.status)}</TableCell>
                        <TableCell>
                          {message.sent_by_profile
                            ? `${message.sent_by_profile.first_name} ${message.sent_by_profile.last_name}`
                            : "System"}
                        </TableCell>
                        <TableCell>{format(new Date(message.sent_at), "PPp")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WhatsAppDashboard;