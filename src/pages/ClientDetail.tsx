import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Building2, Mail, Phone, MapPin, FileText, Receipt, MessageSquare, Save, Users, Trash2, ChevronDown, CheckCircle, PauseCircle, XCircle } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ClientStatusBadge } from "@/components/ClientHub/ClientStatusBadge";
import { format } from "date-fns";
import { ClientDocuments } from "@/components/Clients/ClientDocuments";
import { ClientInvoices } from "@/components/Clients/ClientInvoices";
import { ClientAlternateContacts } from "@/components/Clients/ClientAlternateContacts";
import { MonthlyTaxSummary } from "@/components/Clients/MonthlyTaxSummary";
import { UrlTabs } from "@/components/UrlTabs";

type ClientStatus = 'active' | 'inactive' | 'churned';

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const [lastDiscussion, setLastDiscussion] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .single();
      
      if (error) throw error;
      setLastDiscussion(data.last_discussion || "");
      return data;
    },
    enabled: !!id,
  });

  // Fetch invoices for tax summary
  const { data: invoices } = useQuery({
    queryKey: ["client-invoices", id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from("client_invoices")
        .select("*")
        .eq("client_id", id)
        .order("invoice_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const updateDiscussionMutation = useMutation({
    mutationFn: async (discussion: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ 
          last_discussion: discussion,
          last_discussion_at: new Date().toISOString()
        })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Discussion saved", "Last discussion has been updated");
      queryClient.invalidateQueries({ queryKey: ["client", id] });
    },
    onError: () => {
      notify.error("Error", "Failed to save discussion");
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: ClientStatus) => {
      const { error } = await supabase
        .from("clients")
        .update({ 
          status,
          status_updated_at: new Date().toISOString()
        })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      notify.success("Status updated", `Client marked as ${status}`);
      queryClient.invalidateQueries({ queryKey: ["client", id] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: () => {
      notify.error("Error", "Failed to update status");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Client deleted", "The client has been removed");
      navigate("/clients");
    },
    onError: () => {
      notify.error("Error", "Failed to delete client");
    },
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading client details..." />
      </DashboardLayout>
    );
  }

  if (!client) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Client not found</p>
          <Button variant="link" onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/clients"))}>
            Back to Clients
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const currentStatus = (client.status || 'active') as ClientStatus;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/clients"))}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">
                  {client.first_name} {client.last_name}
                </h1>
                <ClientStatusBadge status={currentStatus} />
              </div>
              <p className="text-muted-foreground">
                Converted on {format(new Date(client.converted_at), "MMMM d, yyyy")}
                {client.status_updated_at && (
                  <span> • Status updated {format(new Date(client.status_updated_at), "MMM d, yyyy")}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Change Status
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={() => updateStatusMutation.mutate('active')}
                  disabled={currentStatus === 'active'}
                  className="gap-2"
                >
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  Mark as Active
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => updateStatusMutation.mutate('inactive')}
                  disabled={currentStatus === 'inactive'}
                  className="gap-2"
                >
                  <PauseCircle className="h-4 w-4 text-muted-foreground" />
                  Mark as Inactive
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => updateStatusMutation.mutate('churned')}
                  disabled={currentStatus === 'churned'}
                  className="gap-2 text-destructive"
                >
                  <XCircle className="h-4 w-4" />
                  Mark as Churned
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button 
              variant="destructive" 
              size="icon"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Client Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Client Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {client.company && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Company</p>
                    <p className="font-medium">{client.company}</p>
                  </div>
                </div>
              )}
              {client.email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{client.email}</p>
                  </div>
                </div>
              )}
              {client.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium">{client.phone}</p>
                  </div>
                </div>
              )}
              {client.job_title && (
                <div>
                  <p className="text-sm text-muted-foreground">Job Title</p>
                  <p className="font-medium">{client.job_title}</p>
                </div>
              )}
              {(client.city || client.state || client.country) && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">
                      {[client.city, client.state, client.country].filter(Boolean).join(", ")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Monthly Tax Summary - Standalone Clickable Card */}
        {invoices && invoices.length > 0 && (
          <MonthlyTaxSummary invoices={invoices as any} currency="INR" />
        )}

        {/* Tabs for Documents, Invoices, Discussion */}
        <UrlTabs param="tab" defaultValue="documents" className="space-y-4">
          <TabsList>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="invoices" className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Alternate Contacts
            </TabsTrigger>
            <TabsTrigger value="discussion" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Last Discussion
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents">
            <ClientDocuments clientId={client.id} orgId={effectiveOrgId!} />
          </TabsContent>

          <TabsContent value="invoices">
            <ClientInvoices clientId={client.id} orgId={effectiveOrgId!} />
          </TabsContent>

          <TabsContent value="contacts">
            <ClientAlternateContacts clientId={client.id} orgId={effectiveOrgId!} />
          </TabsContent>

          <TabsContent value="discussion">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Last Discussion Notes</span>
                  {client.last_discussion_at && (
                    <Badge variant="outline">
                      Last updated: {format(new Date(client.last_discussion_at), "MMM d, yyyy h:mm a")}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Add notes about your last discussion with this client..."
                  value={lastDiscussion}
                  onChange={(e) => setLastDiscussion(e.target.value)}
                  rows={6}
                />
                <Button
                  onClick={() => updateDiscussionMutation.mutate(lastDiscussion)}
                  disabled={updateDiscussionMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Discussion
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </UrlTabs>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Client"
        description={`Are you sure you want to delete ${client.first_name} ${client.last_name}? This action cannot be undone and will also remove all associated documents and invoices.`}
        confirmText="Delete"
        onConfirm={() => deleteMutation.mutate()}
        variant="destructive"
      />
    </DashboardLayout>
  );
}
