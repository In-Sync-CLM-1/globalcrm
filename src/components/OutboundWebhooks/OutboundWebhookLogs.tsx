import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, RotateCw, Eye } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUrlState } from "@/hooks/useUrlState";

interface OutboundWebhookLogsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhookId: string;
}

interface WebhookLog {
  id: string;
  webhook_id: string;
  org_id: string;
  trigger_event: string;
  trigger_data: any;
  payload_sent: any;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  retry_count: number;
  sent_at: string;
  succeeded: boolean;
  execution_time_ms: number | null;
}

export const OutboundWebhookLogs = ({
  open,
  onOpenChange,
  webhookId,
}: OutboundWebhookLogsProps) => {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useUrlState("whstatus", "all");
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data: logs = [], isLoading } = useQuery<WebhookLog[]>({
    queryKey: ["webhook-logs", webhookId, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("outbound_webhook_logs")
        .select("*")
        .eq("webhook_id", webhookId);

      if (statusFilter === "success") {
        query = query.eq("succeeded", true) as any;
      } else if (statusFilter === "failed") {
        query = query.eq("succeeded", false) as any;
      }

      const { data, error } = await query
        .order("sent_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data as any as WebhookLog[];
    },
    enabled: open && !!webhookId,
  });

  const retryMutation = useMutation({
    mutationFn: async (logId: string) => {
      const log = logs.find((l) => l.id === logId);
      if (!log) throw new Error("Log not found");

      const { data, error } = await supabase.functions.invoke("outbound-webhook-handler", {
        body: {
          orgId: log.org_id,
          triggerEvent: log.trigger_event,
          triggerData: log.trigger_data,
          webhookId: log.webhook_id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["webhook-logs"] });
      if (data?.total === 0 || data?.message === 'No active webhooks found') {
        notify.error("No matching webhook found for retry");
      } else if (data?.failed > 0) {
        notify.error("Webhook retry failed — check logs for details");
      } else {
        notify.success("Webhook delivered successfully");
      }
    },
    onError: (error: any) => {
      notify.error(`Failed to retry webhook: ${error.message}`);
    },
  });

  const viewDetails = (log: WebhookLog) => {
    setSelectedLog(log);
    setDetailsOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Webhook Execution Logs</DialogTitle>
            <DialogDescription>
              View the history of webhook executions and their responses
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            <div className="text-sm text-muted-foreground">
              Showing {logs.length} {logs.length === 100 ? "(max)" : ""} logs
            </div>
          </div>

          <ScrollArea className="h-[500px] pr-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No logs found for this webhook
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {log.succeeded ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <Badge
                            variant={log.succeeded ? "default" : "destructive"}
                          >
                            {log.succeeded ? "success" : "failed"}
                          </Badge>
                          <Badge variant="outline">HTTP {log.response_status || "N/A"}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {log.execution_time_ms || 0}ms
                          </span>
                          {log.retry_count > 0 && (
                            <Badge variant="secondary">
                              {log.retry_count + 1} attempts
                            </Badge>
                          )}
                        </div>

                        <div className="text-sm space-y-1">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(log.sent_at).toLocaleString()}
                          </div>
                          <div className="font-medium">{log.trigger_event}</div>
                          {log.error_message && (
                            <div className="text-xs text-destructive mt-2">
                              Error: {log.error_message}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => viewDetails(log)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {!log.succeeded && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryMutation.mutate(log.id)}
                            disabled={retryMutation.isPending}
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <AlertDialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <AlertDialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Execution Details</AlertDialogTitle>
            <AlertDialogDescription>
              Request and response details for this webhook execution
            </AlertDialogDescription>
          </AlertDialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Request Payload</h4>
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                  {JSON.stringify(selectedLog.trigger_data, null, 2)}
                </pre>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Response</h4>
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                  {typeof selectedLog.response_body === "string"
                    ? selectedLog.response_body
                    : JSON.stringify(selectedLog.response_body, null, 2)}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant={selectedLog.succeeded ? "default" : "destructive"}>
                    {selectedLog.succeeded ? "success" : "failed"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">HTTP Status:</span>{" "}
                  {selectedLog.response_status || "N/A"}
                </div>
                <div>
                  <span className="text-muted-foreground">Execution Time:</span>{" "}
                  {selectedLog.execution_time_ms || 0}ms
                </div>
                <div>
                  <span className="text-muted-foreground">Attempts:</span>{" "}
                  {selectedLog.retry_count + 1}
                </div>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogAction>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
