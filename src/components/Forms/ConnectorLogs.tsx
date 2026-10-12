import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Eye, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/UrlTabs";
import { useUrlState } from "@/hooks/useUrlState";

interface ConnectorLog {
  id: string;
  request_id: string;
  status: string;
  http_status_code: number;
  request_payload: any;
  response_payload: any;
  contact_id: string | null;
  error_message: string | null;
  ip_address: unknown;
  created_at: string;
  contacts?: {
    first_name: string;
    last_name: string;
    phone: string;
  } | null;
}

interface ConnectorLogsProps {
  formId: string;
  formName: string;
}

export function ConnectorLogs({ formId, formName }: ConnectorLogsProps) {
  const [logs, setLogs] = useState<ConnectorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useUrlState("logpage", 1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedLog, setSelectedLog] = useState<ConnectorLog | null>(null);
  const logsPerPage = 20;

  useEffect(() => {
    fetchLogs();
  }, [formId, page]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const from = (page - 1) * logsPerPage;
      const to = from + logsPerPage - 1;

      const { data, error, count } = await supabase
        .from("connector_logs")
        .select(`
          *,
          contacts (
            first_name,
            last_name,
            phone
          )
        `, { count: "exact" })
        .eq("form_id", formId)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      setLogs(data || []);
      setTotalPages(Math.ceil((count || 0) / logsPerPage));
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive", icon: any }> = {
      success: { variant: "default", icon: CheckCircle2 },
      duplicate: { variant: "secondary", icon: RefreshCw },
      error: { variant: "destructive", icon: AlertCircle },
    };

    const config = variants[status] || variants.error;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1 w-fit">
        <Icon className="h-3 w-3" />
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Webhook Logs</h3>
          <p className="text-sm text-muted-foreground">
            Activity log for {formName}
          </p>
        </div>
        <Button onClick={fetchLogs} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Loading logs...</p>
          </CardContent>
        </Card>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">No webhook requests yet</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(log.created_at), "MMM dd, HH:mm:ss")}
                      </TableCell>
                      <TableCell>{getStatusBadge(log.status)}</TableCell>
                      <TableCell>
                        {log.contacts 
                          ? `${log.contacts.first_name} ${log.contacts.last_name || ''}`.trim()
                          : log.error_message 
                            ? <span className="text-muted-foreground text-xs">Failed</span>
                            : "-"
                        }
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.contacts?.phone || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {String(log.ip_address || "-")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedLog(log)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl max-h-[80vh]">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                Request Details
                                {getStatusBadge(log.status)}
                              </DialogTitle>
                            </DialogHeader>
                            <ScrollArea className="max-h-[60vh]">
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Request ID:</span>
                                    <p className="font-mono mt-1">{log.request_id}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Timestamp:</span>
                                    <p className="mt-1">{format(new Date(log.created_at), "PPpp")}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">HTTP Status:</span>
                                    <p className="mt-1">{log.http_status_code}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">IP Address:</span>
                                    <p className="font-mono mt-1">{String(log.ip_address || "N/A")}</p>
                                  </div>
                                </div>

                                {log.error_message && (
                                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                                    <p className="text-sm font-medium text-destructive mb-1">Error</p>
                                    <p className="text-sm">{log.error_message}</p>
                                  </div>
                                )}

                                <UrlTabs param="connectorlogs_tab" defaultValue="request">
                                  <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="request">Request Payload</TabsTrigger>
                                    <TabsTrigger value="response">Response</TabsTrigger>
                                  </TabsList>
                                  <TabsContent value="request" className="mt-4">
                                    <pre className="bg-muted p-4 rounded-md text-xs overflow-auto">
                                      {JSON.stringify(log.request_payload, null, 2)}
                                    </pre>
                                  </TabsContent>
                                  <TabsContent value="response" className="mt-4">
                                    <pre className="bg-muted p-4 rounded-md text-xs overflow-auto">
                                      {JSON.stringify(log.response_payload, null, 2)}
                                    </pre>
                                  </TabsContent>
                                </UrlTabs>
                              </div>
                            </ScrollArea>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
