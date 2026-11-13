import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/Layout/DashboardLayout";
import { MessageSquare, Mail, PhoneCall, MessageCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { Loader2, CheckCircle2, AlertCircle, Copy, RefreshCw, Check } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UrlTabs } from "@/components/UrlTabs";

// WhatsApp Settings Component (Now uses Exotel)
function WhatsAppSettingsTab() {
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState({
    whatsapp_enabled: false,
    whatsapp_source_number: "",
    waba_id: "",
  });

  const { data: whatsappData, isLoading: loading } = useQuery({
    queryKey: ['whatsapp-settings', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exotel_settings")
        .select("*")
        .eq("org_id", effectiveOrgId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      const exotelConfigured = data ? !!data.api_key && !!data.api_token && !!data.account_sid : false;
      
      if (data) {
        setSettings({
          whatsapp_enabled: data.whatsapp_enabled ?? false,
          whatsapp_source_number: data.whatsapp_source_number || "",
          waba_id: data.waba_id || "",
        });
      }

      // Fetch template count
      const result = await supabase
        .from("communication_templates")
        .select("*", { count: 'exact', head: true })
        .eq("org_id", effectiveOrgId)
        .eq("template_type", "whatsapp");

      return {
        exotelConfigured,
        templateCount: result.count || 0,
      };
    },
    enabled: !!effectiveOrgId,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("exotel_settings")
        .update({
          whatsapp_enabled: settings.whatsapp_enabled,
          whatsapp_source_number: settings.whatsapp_source_number,
          waba_id: settings.waba_id,
        })
        .eq("org_id", effectiveOrgId);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['whatsapp-settings', effectiveOrgId] });
      notify.success("Settings saved", "WhatsApp settings have been updated");
    } catch (error) {
      notify.error("Error saving settings", error as Error);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncTemplates = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('sync-exotel-whatsapp-templates');
      if (error) throw error;
      
      notify.success("Templates synced", "WhatsApp templates have been synced from Exotel");
      queryClient.invalidateQueries({ queryKey: ['whatsapp-settings', effectiveOrgId] });
    } catch (error) {
      notify.error("Error syncing templates", error as Error);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading WhatsApp settings..." />;
  }

  if (!whatsappData?.exotelConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Exotel Configuration Required</CardTitle>
          <CardDescription>
            Please configure your Exotel API credentials in the Exotel tab first to enable WhatsApp messaging.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Exotel WhatsApp Configuration</CardTitle>
          <CardDescription>
            Configure your Exotel WhatsApp Business API settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="whatsapp_enabled"
              checked={settings.whatsapp_enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, whatsapp_enabled: checked })}
            />
            <Label htmlFor="whatsapp_enabled">Enable WhatsApp Integration</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="whatsapp_source_number">WhatsApp Business Number</Label>
            <Input
              id="whatsapp_source_number"
              value={settings.whatsapp_source_number}
              onChange={(e) => setSettings({ ...settings, whatsapp_source_number: e.target.value })}
              placeholder="+919XXXXXXXXX"
            />
            <p className="text-xs text-muted-foreground">Enter in E.164 format (e.g., +919876543210)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="waba_id">WABA ID (WhatsApp Business Account ID)</Label>
            <Input
              id="waba_id"
              value={settings.waba_id}
              onChange={(e) => setSettings({ ...settings, waba_id: e.target.value })}
              placeholder="Enter your WABA ID"
            />
            <p className="text-xs text-muted-foreground">Required for syncing templates from Meta</p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Template Management</CardTitle>
          <CardDescription>
            Sync and manage your WhatsApp message templates from Exotel
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Active Templates</p>
              <p className="text-2xl font-bold">{whatsappData?.templateCount ?? 0}</p>
            </div>
            <Button onClick={handleSyncTemplates} disabled={syncing || !settings.waba_id} variant="outline">
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sync Templates
            </Button>
          </div>
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Templates are synced from your Exotel/Meta WhatsApp Business Account
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

// Email Settings Component
function EmailSettingsTab() {
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['email-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-resend-domain', {
        body: { action: 'get-domain' },
      });

      if (error) throw error;
      return data;
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    notify.success("Copied", "DNS record copied to clipboard");
  };

  const handleAddDomain = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-resend-domain', {
        body: { 
          action: 'add-domain',
          domain,
        },
      });

      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['email-settings'] });
      notify.success("Domain added", "Email domain has been configured");
      setDomain("");
    } catch (error) {
      notify.error("Error", (error as Error).message || "Failed to add domain");
    }
  };

  const handleVerifyDomain = async () => {
    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-resend-domain', {
        body: { action: 'verify-domain' },
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['email-settings'] });
      
      if (data.verified) {
        notify.success("Domain verified", "Your email domain is now verified");
      } else {
        notify.error("Verification pending", "DNS records not yet propagated. Please wait a few minutes.");
      }
    } catch (error) {
      notify.error("Error", (error as Error).message || "Failed to verify domain");
    } finally {
      setIsVerifying(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading email settings..." />;
  }

  return (
    <div className="space-y-6">
      {!settings?.domain ? (
        <Card>
          <CardHeader>
            <CardTitle>Configure Email Domain</CardTitle>
            <CardDescription>
              Add your domain to start sending emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="domain">Domain Name</Label>
              <Input
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
              />
            </div>
            <Button onClick={handleAddDomain}>
              Add Domain
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Domain Status</CardTitle>
              <CardDescription>{settings.domain}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                {settings.verified ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-600" />
                )}
                <span className="font-medium">
                  {settings.verified ? "Verified" : "Pending Verification"}
                </span>
              </div>

              {!settings.verified && (
                <Button onClick={handleVerifyDomain} disabled={isVerifying}>
                  {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify Domain
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>DNS Records</CardTitle>
              <CardDescription>
                Add these DNS records to your domain provider
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.dns_records?.map((record: any, index: number) => (
                <div key={index} className="p-4 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{record.type}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(record.value)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="text-sm space-y-1">
                    <div><span className="text-muted-foreground">Name:</span> {record.name}</div>
                    <div className="break-all"><span className="text-muted-foreground">Value:</span> {record.value}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ExoPhone interface
interface ExoPhone {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  is_default: boolean;
  is_active: boolean;
}

// Exotel Settings Component
function ExotelSettingsTab() {
  const notify = useNotification();
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newExoPhone, setNewExoPhone] = useState({ phone_number: "", friendly_name: "" });
  const [addingExoPhone, setAddingExoPhone] = useState(false);
  const [settings, setSettings] = useState({
    api_key: "",
    api_token: "",
    account_sid: "",
    subdomain: "api.exotel.com",
    call_recording_enabled: true,
    is_active: true,
  });

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exotel-webhook`;

  // Fetch ExoPhones
  const { data: exoPhones = [], isLoading: loadingExoPhones, refetch: refetchExoPhones } = useQuery({
    queryKey: ['exotel-exophones', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exotel_exophones')
        .select('*')
        .eq('org_id', effectiveOrgId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data as ExoPhone[];
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch Exotel Settings
  const { isLoading: loading } = useQuery({
    queryKey: ['exotel-settings-tab', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exotel_settings')
        .select('*')
        .eq('org_id', effectiveOrgId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setSettings({
          api_key: data.api_key || "",
          api_token: data.api_token || "",
          account_sid: data.account_sid || "",
          subdomain: data.subdomain || "api.exotel.com",
          call_recording_enabled: data.call_recording_enabled ?? true,
          is_active: data.is_active ?? true,
        });
      }
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('exotel_settings')
        .upsert({
          org_id: effectiveOrgId,
          api_key: settings.api_key,
          api_token: settings.api_token,
          account_sid: settings.account_sid,
          subdomain: settings.subdomain,
          call_recording_enabled: settings.call_recording_enabled,
          is_active: settings.is_active,
          caller_id: '', // Legacy field, kept for backward compatibility
        }, { onConflict: 'org_id' });

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['exotel-settings-tab', effectiveOrgId] });
      notify.success("Settings saved", "Exotel settings have been updated successfully");
    } catch (error) {
      notify.error("Error saving settings", error as Error);
    } finally {
      setSaving(false);
    }
  };

  const handleAddExoPhone = async () => {
    if (!newExoPhone.phone_number.trim()) {
      notify.error("Error", "Phone number is required");
      return;
    }

    setAddingExoPhone(true);
    try {
      const isFirst = exoPhones.length === 0;
      const { error } = await supabase
        .from('exotel_exophones')
        .insert({
          org_id: effectiveOrgId,
          phone_number: newExoPhone.phone_number.trim(),
          friendly_name: newExoPhone.friendly_name.trim() || null,
          is_default: isFirst, // First ExoPhone is default
        });

      if (error) throw error;
      
      notify.success("ExoPhone added", "ExoPhone has been added successfully");
      setNewExoPhone({ phone_number: "", friendly_name: "" });
      refetchExoPhones();
    } catch (error: any) {
      if (error.code === '23505') {
        notify.error("Error", "This phone number already exists");
      } else {
        notify.error("Error adding ExoPhone", error as Error);
      }
    } finally {
      setAddingExoPhone(false);
    }
  };

  const handleSetDefault = async (exophoneId: string) => {
    try {
      const { error } = await supabase
        .from('exotel_exophones')
        .update({ is_default: true })
        .eq('id', exophoneId);

      if (error) throw error;
      
      notify.success("Default updated", "Default ExoPhone has been changed");
      refetchExoPhones();
    } catch (error) {
      notify.error("Error updating default", error as Error);
    }
  };

  const handleToggleActive = async (exophoneId: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('exotel_exophones')
        .update({ is_active: !currentActive })
        .eq('id', exophoneId);

      if (error) throw error;
      
      notify.success("Status updated", `ExoPhone ${!currentActive ? 'activated' : 'deactivated'}`);
      refetchExoPhones();
    } catch (error) {
      notify.error("Error updating status", error as Error);
    }
  };

  const handleDeleteExoPhone = async (exophoneId: string) => {
    try {
      const { error } = await supabase
        .from('exotel_exophones')
        .delete()
        .eq('id', exophoneId);

      if (error) throw error;
      
      notify.success("ExoPhone removed", "ExoPhone has been removed");
      refetchExoPhones();
    } catch (error) {
      notify.error("Error removing ExoPhone", error as Error);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    notify.success("Copied", "Webhook URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <LoadingState message="Loading Exotel settings..." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Exotel API Configuration</CardTitle>
          <CardDescription>
            Configure your Exotel calling credentials
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api_key">API Key</Label>
            <Input
              id="api_key"
              type="password"
              value={settings.api_key}
              onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
              placeholder="Enter your Exotel API key"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_token">API Token</Label>
            <Input
              id="api_token"
              type="password"
              value={settings.api_token}
              onChange={(e) => setSettings({ ...settings, api_token: e.target.value })}
              placeholder="Enter your Exotel API token"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_sid">Account SID</Label>
            <Input
              id="account_sid"
              value={settings.account_sid}
              onChange={(e) => setSettings({ ...settings, account_sid: e.target.value })}
              placeholder="Enter your Exotel Account SID"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subdomain">Subdomain</Label>
            <Input
              id="subdomain"
              value={settings.subdomain}
              onChange={(e) => setSettings({ ...settings, subdomain: e.target.value })}
              placeholder="api.exotel.com"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="call_recording_enabled"
              checked={settings.call_recording_enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, call_recording_enabled: checked })}
            />
            <Label htmlFor="call_recording_enabled">Enable Call Recording</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={settings.is_active}
              onCheckedChange={(checked) => setSettings({ ...settings, is_active: checked })}
            />
            <Label htmlFor="is_active">Enable Exotel Integration</Label>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* ExoPhones Management Card */}
      <Card>
        <CardHeader>
          <CardTitle>ExoPhones (Caller IDs)</CardTitle>
          <CardDescription>
            Manage virtual phone numbers for outbound calls. The default ExoPhone will be used when making calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new ExoPhone */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={newExoPhone.phone_number}
                onChange={(e) => setNewExoPhone({ ...newExoPhone, phone_number: e.target.value })}
                placeholder="Phone number (e.g., 0XXXXXXXXXX)"
              />
            </div>
            <div className="flex-1">
              <Input
                value={newExoPhone.friendly_name}
                onChange={(e) => setNewExoPhone({ ...newExoPhone, friendly_name: e.target.value })}
                placeholder="Friendly name (optional)"
              />
            </div>
            <Button onClick={handleAddExoPhone} disabled={addingExoPhone}>
              {addingExoPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>

          {/* ExoPhones List */}
          {loadingExoPhones ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : exoPhones.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No ExoPhones configured. Add your first ExoPhone above to start making calls.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              {exoPhones.map((exophone) => (
                <div
                  key={exophone.id}
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    exophone.is_default ? 'border-primary bg-primary/5' : ''
                  } ${!exophone.is_active ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{exophone.phone_number}</p>
                      {exophone.friendly_name && (
                        <p className="text-sm text-muted-foreground">{exophone.friendly_name}</p>
                      )}
                    </div>
                    {exophone.is_default && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={exophone.is_active}
                      onCheckedChange={() => handleToggleActive(exophone.id, exophone.is_active)}
                    />
                    {!exophone.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(exophone.id)}
                      >
                        Set Default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteExoPhone(exophone.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Configuration</CardTitle>
          <CardDescription>
            Configure this webhook URL in your Exotel dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              value={webhookUrl}
              readOnly
              className="font-mono text-sm"
            />
            <Button onClick={copyWebhookUrl} variant="outline" size="icon">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Add this webhook URL to your Exotel dashboard to receive call events
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CommunicationSettings() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Communication Settings</h1>
          <p className="text-muted-foreground">
            Configure WhatsApp, Email, and Calling integrations
          </p>
        </div>

        <UrlTabs param="tab" defaultValue="whatsapp" className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="whatsapp">
              <MessageSquare className="h-4 w-4 mr-2" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail className="h-4 w-4 mr-2" />
              Email
            </TabsTrigger>
            <TabsTrigger value="exotel">
              <PhoneCall className="h-4 w-4 mr-2" />
              Calling
            </TabsTrigger>
          </TabsList>

          <TabsContent value="whatsapp" className="space-y-6">
            <WhatsAppSettingsTab />
          </TabsContent>

          <TabsContent value="email" className="space-y-6">
            <EmailSettingsTab />
          </TabsContent>

          <TabsContent value="exotel" className="space-y-6">
            <ExotelSettingsTab />
          </TabsContent>
        </UrlTabs>
      </div>
    </DashboardLayout>
  );
}
