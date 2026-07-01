import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayloadTemplateBuilder } from "./PayloadTemplateBuilder";
import { FilterConditionsBuilder } from "./FilterConditionsBuilder";

const TARGET_TABLES = [
  { group: "Contacts & Leads", items: [
    { value: "contacts", label: "Contacts" },
    { value: "contact_activities", label: "Contact Activities" },
    { value: "contact_emails", label: "Contact Emails" },
    { value: "contact_phones", label: "Contact Phones" },
    { value: "contact_tags", label: "Contact Tags" },
    { value: "contact_tag_assignments", label: "Contact Tag Assignments" },
    { value: "contact_custom_fields", label: "Contact Custom Fields" },
    { value: "contact_lead_scores", label: "Contact Lead Scores" },
    { value: "contact_enrichment_runs", label: "Contact Enrichment Runs" },
  ]},
  { group: "Clients & Invoicing", items: [
    { value: "clients", label: "Clients" },
    { value: "client_invoices", label: "Client Invoices" },
    { value: "client_documents", label: "Client Documents" },
    { value: "client_alternate_contacts", label: "Client Alternate Contacts" },
    { value: "payment_transactions", label: "Payment Transactions" },
    { value: "wallet_transactions", label: "Wallet Transactions" },
    { value: "gst_payment_tracking", label: "GST Payment Tracking" },
  ]},
  { group: "Pipeline & Tasks", items: [
    { value: "pipeline_stages", label: "Pipeline Stages" },
    { value: "pipeline_movement_history", label: "Pipeline Movement History" },
    { value: "tasks", label: "Tasks" },
    { value: "activity_participants", label: "Activity Participants" },
    { value: "recurring_activity_patterns", label: "Recurring Activity Patterns" },
  ]},
  { group: "Email", items: [
    { value: "email_conversations", label: "Email Conversations" },
    { value: "email_bulk_campaigns", label: "Email Campaigns" },
    { value: "email_campaign_recipients", label: "Email Campaign Recipients" },
    { value: "email_templates", label: "Email Templates" },
    { value: "email_settings", label: "Email Settings" },
    { value: "email_unsubscribes", label: "Email Unsubscribes" },
  ]},
  { group: "Email Automation", items: [
    { value: "email_automation_rules", label: "Email Automation Rules" },
    { value: "email_automation_executions", label: "Email Automation Executions" },
  ]},
  { group: "WhatsApp", items: [
    { value: "whatsapp_messages", label: "WhatsApp Messages" },
    { value: "whatsapp_bulk_campaigns", label: "WhatsApp Campaigns" },
    { value: "whatsapp_campaign_recipients", label: "WhatsApp Campaign Recipients" },
    { value: "whatsapp_settings", label: "WhatsApp Settings" },
  ]},
  { group: "Calls", items: [
    { value: "call_logs", label: "Call Logs" },
    { value: "call_dispositions", label: "Call Dispositions" },
    { value: "call_sub_dispositions", label: "Call Sub-Dispositions" },
    { value: "agent_call_sessions", label: "Agent Call Sessions" },
  ]},
  { group: "Support Tickets", items: [
    { value: "support_tickets", label: "Support Tickets" },
    { value: "support_ticket_comments", label: "Ticket Comments" },
    { value: "support_ticket_history", label: "Ticket History" },
    { value: "support_ticket_escalations", label: "Ticket Escalations" },
    { value: "support_ticket_notifications", label: "Ticket Notifications" },
  ]},
  { group: "Chat", items: [
    { value: "chat_conversations", label: "Chat Conversations" },
    { value: "chat_messages", label: "Chat Messages" },
    { value: "chat_message_reactions", label: "Chat Message Reactions" },
  ]},
  { group: "Content & Forms", items: [
    { value: "blog_posts", label: "Blog Posts" },
    { value: "forms", label: "Forms" },
    { value: "form_fields", label: "Form Fields" },
    { value: "communication_templates", label: "Communication Templates" },
  ]},
  { group: "Approvals & Automation", items: [
    { value: "approval_rules", label: "Approval Rules" },
    { value: "automation_approvals", label: "Automation Approvals" },
  ]},
  { group: "Imports", items: [
    { value: "bulk_import_history", label: "Bulk Import History" },
    { value: "import_jobs", label: "Import Jobs" },
  ]},
  { group: "Organization & Users", items: [
    { value: "profiles", label: "Users/Profiles" },
    { value: "teams", label: "Teams" },
    { value: "team_members", label: "Team Members" },
    { value: "user_roles", label: "User Roles" },
    { value: "designations", label: "Designations" },
    { value: "organizations", label: "Organizations" },
    { value: "org_invites", label: "Org Invites" },
    { value: "notifications", label: "Notifications" },
  ]},
  { group: "Analytics & Reports", items: [
    { value: "campaign_analytics", label: "Campaign Analytics" },
    { value: "campaign_insights", label: "Campaign Insights" },
    { value: "revenue_goals", label: "Revenue Goals" },
    { value: "saved_reports", label: "Saved Reports" },
  ]},
  { group: "Subscriptions", items: [
    { value: "organization_subscriptions", label: "Organization Subscriptions" },
    { value: "subscription_invoices", label: "Subscription Invoices" },
  ]},
  { group: "API & Integrations", items: [
    { value: "api_keys", label: "API Keys" },
    { value: "exotel_settings", label: "Exotel Settings" },
    { value: "calendar_shares", label: "Calendar Shares" },
    { value: "custom_fields", label: "Custom Fields" },
  ]},
];

const ALL_TABLES = TARGET_TABLES.flatMap(g => g.items);

const getTableLabel = (value: string) =>
  ALL_TABLES.find(t => t.value === value)?.label || value;

interface OutboundWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhook?: any;
}

export const OutboundWebhookDialog = ({
  open,
  onOpenChange,
  webhook,
}: OutboundWebhookDialogProps) => {
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [targetTable, setTargetTable] = useState("contacts");
  const [tableSearchOpen, setTableSearchOpen] = useState(false);
  const [targetOperation, setTargetOperation] = useState("INSERT");
  const [httpMethod, setHttpMethod] = useState("POST");
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [payloadTemplate, setPayloadTemplate] = useState<any>({});
  const [filterConditions, setFilterConditions] = useState<any>({});
  const [authType, setAuthType] = useState<string>("none");
  const [authConfig, setAuthConfig] = useState<any>({});
  const [retryConfig, setRetryConfig] = useState({ 
    max_retries: 3, 
    retry_delay_seconds: 2, 
    timeout_seconds: 30 
  });

  useEffect(() => {
    if (webhook) {
      setName(webhook.name || "");
      setDescription(webhook.description || "");
      setWebhookUrl(webhook.webhook_url || "");
      setTargetTable(webhook.target_table || "contacts");
      setTargetOperation(webhook.target_operation || "INSERT");
      setHttpMethod(webhook.http_method || "POST");
      setHeaders(webhook.headers || {});
      setPayloadTemplate(webhook.payload_template || {});
      setFilterConditions(webhook.filter_conditions || {});
      setAuthType(webhook.authentication_type || "none");
      setAuthConfig(webhook.authentication_config || {});
      setRetryConfig(webhook.retry_config || { 
        max_retries: 3, 
        retry_delay_seconds: 2, 
        timeout_seconds: 30 
      });
    } else {
      resetForm();
    }
  }, [webhook, open]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setWebhookUrl("");
    setTargetTable("contacts");
    setTargetOperation("INSERT");
    setHttpMethod("POST");
    setHeaders({});
    setPayloadTemplate({});
    setFilterConditions({});
    setAuthType("none");
    setAuthConfig({});
    setRetryConfig({ 
      max_retries: 3, 
      retry_delay_seconds: 2, 
      timeout_seconds: 30 
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        org_id: effectiveOrgId,
        name,
        description,
        webhook_url: webhookUrl,
        target_table: targetTable,
        target_operation: targetOperation,
        trigger_event: `${targetTable}_${targetOperation.toLowerCase() === 'insert' ? 'created' : targetOperation.toLowerCase() === 'delete' ? 'deleted' : 'updated'}`,
        http_method: httpMethod,
        headers,
        payload_template: payloadTemplate,
        filter_conditions: filterConditions,
        authentication_type: authType === "none" ? null : authType,
        authentication_config: authType === "none" ? null : authConfig,
        retry_config: retryConfig,
        is_active: true,
      };

      if (webhook) {
        const { error } = await supabase
          .from("outbound_webhooks")
          .update(data)
          .eq("id", webhook.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("outbound_webhooks").insert(data);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      // Create database trigger for the webhook
      try {
        const { error: triggerError } = await supabase.rpc('manage_webhook_trigger', {
          p_table_name: targetTable,
          p_operation: targetOperation,
          p_action: 'create'
        });
        if (triggerError) {
          console.error("Failed to create trigger:", triggerError);
          notify.error(`Webhook saved but trigger creation failed: ${triggerError.message}`);
        }
      } catch (error) {
        console.error("Failed to create trigger:", error);
      }

      queryClient.invalidateQueries({ queryKey: ["outbound-webhooks"] });
      notify.success(webhook ? "Webhook updated" : "Webhook created");
      onOpenChange(false);
      resetForm();
    },
    onError: (error: any) => {
      notify.error(`Failed to save webhook: ${error.message}`);
    },
  });

  const handleSave = () => {
    if (!name || !webhookUrl) {
      notify.error("Name and URL are required");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{webhook ? "Edit Webhook" : "Create Webhook"}</DialogTitle>
          <DialogDescription>
            Configure an outbound webhook to send data to external systems
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="payload">Payload</TabsTrigger>
            <TabsTrigger value="filters">Filters</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My n8n Integration"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Send new contacts to n8n for processing"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">Webhook URL *</Label>
              <Input
                id="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="http://20.118.234.14:5678/webhook/..."
              />
            </div>

            <div className="space-y-2">
              <Label>Target Table *</Label>
              <Popover open={tableSearchOpen} onOpenChange={setTableSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={tableSearchOpen}
                    className="w-full justify-between font-normal"
                  >
                    {getTableLabel(targetTable)}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search tables..." />
                    <CommandList>
                      <CommandEmpty>No table found.</CommandEmpty>
                      {TARGET_TABLES.map((group) => (
                        <CommandGroup key={group.group} heading={group.group}>
                          {group.items.map((table) => (
                            <CommandItem
                              key={table.value}
                              value={`${table.label} ${table.value}`}
                              onSelect={() => {
                                setTargetTable(table.value);
                                setTableSearchOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  targetTable === table.value ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {table.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="operation">Operation *</Label>
                <Select value={targetOperation} onValueChange={setTargetOperation}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INSERT">Create (INSERT)</SelectItem>
                    <SelectItem value="UPDATE">Update (UPDATE)</SelectItem>
                    <SelectItem value="DELETE">Delete (DELETE)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="method">HTTP Method</Label>
                <Select value={httpMethod} onValueChange={setHttpMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="PATCH">PATCH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="payload">
            <PayloadTemplateBuilder
              template={payloadTemplate}
              onChange={setPayloadTemplate}
              targetTable={targetTable}
              targetOperation={targetOperation}
            />
          </TabsContent>

          <TabsContent value="filters">
            <FilterConditionsBuilder
              conditions={filterConditions}
              onChange={setFilterConditions}
              targetTable={targetTable}
              targetOperation={targetOperation}
            />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="auth">Authentication</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="basic">Basic Auth</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {authType === "bearer" && (
              <div className="space-y-2">
                <Label htmlFor="token">Bearer Token</Label>
                <Input
                  id="token"
                  type="password"
                  value={authConfig.token || ""}
                  onChange={(e) =>
                    setAuthConfig({ ...authConfig, token: e.target.value })
                  }
                />
              </div>
            )}

            {authType === "api_key" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="header">Header Name</Label>
                  <Input
                    id="header"
                    value={authConfig.header_name || ""}
                    onChange={(e) =>
                      setAuthConfig({ ...authConfig, header_name: e.target.value })
                    }
                    placeholder="X-API-Key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={authConfig.api_key || ""}
                    onChange={(e) =>
                      setAuthConfig({ ...authConfig, api_key: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            {authType === "basic" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={authConfig.username || ""}
                    onChange={(e) =>
                      setAuthConfig({ ...authConfig, username: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={authConfig.password || ""}
                    onChange={(e) =>
                      setAuthConfig({ ...authConfig, password: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="retry">Retry Attempts</Label>
                <Input
                  id="retry"
                  type="number"
                  min="0"
                  max="5"
                  value={retryConfig.max_retries}
                  onChange={(e) => setRetryConfig({...retryConfig, max_retries: parseInt(e.target.value)})}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (seconds)</Label>
                <Input
                  id="timeout"
                  type="number"
                  min="5"
                  max="300"
                  value={retryConfig.timeout_seconds}
                  onChange={(e) => setRetryConfig({...retryConfig, timeout_seconds: parseInt(e.target.value)})}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : webhook ? "Update" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
