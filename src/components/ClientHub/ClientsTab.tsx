import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Users, FileText, Receipt, RefreshCw } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { format } from "date-fns";
import { useUrlState } from "@/hooks/useUrlState";

export function ClientsTab() {
  const navigate = useNavigate();
  const { effectiveOrgId } = useOrgContext();
  const [searchTerm, setSearchTerm] = useUrlState("cq", "");

  const { data: clients, isLoading, refetch } = useQuery({
    queryKey: ["clients", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("clients")
        .select(`
          *,
          contact:contacts(pipeline_stage_id, email),
          documents:client_documents(count),
          invoices:client_invoices(count)
        `)
        .eq("org_id", effectiveOrgId)
        .order("converted_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  const filteredClients = clients
    ?.filter((client) => {
      const searchLower = searchTerm.toLowerCase();
      const email = client.email || (client.contact as any)?.email;
      return (
        client.first_name?.toLowerCase().includes(searchLower) ||
        client.last_name?.toLowerCase().includes(searchLower) ||
        email?.toLowerCase().includes(searchLower) ||
        client.company?.toLowerCase().includes(searchLower)
      );
    })
    ?.sort((a, b) => {
      // Sort active clients first, then inactive/churned at bottom
      const statusOrder: Record<string, number> = { active: 0, inactive: 1, churned: 2 };
      const aOrder = statusOrder[a.status || 'active'] ?? 0;
      const bOrder = statusOrder[b.status || 'active'] ?? 0;
      return aOrder - bOrder;
    });

  const stats = {
    total: clients?.length || 0,
    withDocuments: clients?.filter((c) => (c.documents as any)?.[0]?.count > 0).length || 0,
    withInvoices: clients?.filter((c) => (c.invoices as any)?.[0]?.count > 0).length || 0,
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">With Documents</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.withDocuments}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">With Invoices</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.withInvoices}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Actions */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Clients Table */}
      {isLoading ? (
        <LoadingState message="Loading clients..." />
      ) : !filteredClients?.length ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="No clients yet"
          message="Clients will appear here when deals are marked as Won in the pipeline."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-2 text-xs">Client Name</TableHead>
                  <TableHead className="py-2 text-xs">Company</TableHead>
                  <TableHead className="py-2 text-xs">Email</TableHead>
                  <TableHead className="py-2 text-xs">Phone</TableHead>
                  <TableHead className="py-2 text-xs">Converted On</TableHead>
                  <TableHead className="py-2 text-xs">Documents</TableHead>
                  <TableHead className="py-2 text-xs">Invoices</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow 
                    key={client.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/clients/${client.id}`)}
                  >
                    <TableCell className="py-1.5 font-medium">
                      {client.first_name} {client.last_name}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">{client.company || "-"}</TableCell>
                    <TableCell className="py-1.5 text-xs">{client.email || (client.contact as any)?.email || "-"}</TableCell>
                    <TableCell className="py-1.5 text-xs">{client.phone || "-"}</TableCell>
                    <TableCell className="py-1.5 text-xs">
                      {format(new Date(client.converted_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant="outline" className="text-xs">
                        {(client.documents as any)?.[0]?.count || 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant="outline" className="text-xs">
                        {(client.invoices as any)?.[0]?.count || 0}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
