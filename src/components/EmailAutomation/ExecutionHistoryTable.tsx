import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import { Search, ExternalLink } from "lucide-react";
import { useUrlState } from "@/hooks/useUrlState";

interface ExecutionHistoryTableProps {
  ruleId?: string;
  limit?: number;
}

export function ExecutionHistoryTable({ ruleId, limit = 50 }: ExecutionHistoryTableProps) {
  const { effectiveOrgId } = useOrgContext();
  const [statusFilter, setStatusFilter] = useUrlState<string>("xstatus", "all");
  const [searchQuery, setSearchQuery] = useUrlState("xq", "");

  const { data: executions, isLoading } = useQuery({
    queryKey: ["automation_executions", effectiveOrgId, ruleId, statusFilter],
    queryFn: async () => {
      if (!effectiveOrgId) return [];

      let query = supabase
        .from("email_automation_executions")
        .select(`
          *,
          email_automation_rules(name, trigger_type),
          contacts(first_name, last_name, email),
          email_conversations(id, subject, status)
        `)
        .eq("org_id", effectiveOrgId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (ruleId) {
        query = query.eq("rule_id", ruleId);
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  const filteredExecutions = executions?.filter((exec) => {
    if (!searchQuery) return true;
    const contactName = `${exec.contacts?.first_name || ""} ${exec.contacts?.last_name || ""}`.toLowerCase();
    const email = exec.contacts?.email?.toLowerCase() || "";
    const ruleName = exec.email_automation_rules?.name?.toLowerCase() || "";
    const query = searchQuery.toLowerCase();
    return contactName.includes(query) || email.includes(query) || ruleName.includes(query);
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      pending: "secondary",
      sent: "default",
      failed: "destructive",
    };
    return <Badge variant={variants[status] || "default"}>{status}</Badge>;
  };

  const getTriggerTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      stage_change: "Stage Change",
      disposition_set: "Call Disposition",
      activity_logged: "Activity Logged",
      field_updated: "Field Updated",
      inactivity: "Contact Inactivity",
      time_based: "Time Based",
      assignment_changed: "Assignment Changed",
    };
    return labels[type] || type;
  };

  if (isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by contact, email, or rule name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filteredExecutions || filteredExecutions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No execution history found
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExecutions.map((exec) => (
                <TableRow key={exec.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">
                        {exec.contacts?.first_name} {exec.contacts?.last_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {exec.contacts?.email}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {exec.email_automation_rules?.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {getTriggerTypeLabel(exec.trigger_type)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm max-w-[200px] truncate">
                      {exec.email_subject || "-"}
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(exec.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(exec.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {exec.sent_at
                      ? formatDistanceToNow(new Date(exec.sent_at), { addSuffix: true })
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {exec.email_conversation_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          window.open(
                            `/contacts/${exec.contact_id}?tab=communications`,
                            "_blank"
                          )
                        }
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
