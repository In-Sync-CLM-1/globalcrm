import { useEffect, useState, useRef } from "react";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import { Building2, Palette, Users, Upload } from "lucide-react";

export default function TechAdmin() {
  const notify = useNotification();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [orgData, setOrgData] = useState({
    name: "",
    slug: "",
    logo_url: "",
    primary_color: "#01B8AA",
  });
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalTeams: 0,
  });

  useEffect(() => {
    fetchOrgData();
    fetchStats();
  }, []);

  const fetchOrgData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (profile?.org_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", profile.org_id)
        .single();

      if (org) {
        setOrgData({
          name: org.name,
          slug: org.slug,
          logo_url: org.logo_url || "",
          primary_color: org.primary_color || "#01B8AA",
        });
      }
    }
  };

  const fetchStats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (profile?.org_id) {
      const { count: userCount } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("org_id", profile.org_id);

      const { count: teamCount } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("org_id", profile.org_id);

      setStats({
        totalUsers: userCount || 0,
        totalTeams: teamCount || 0,
      });
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      notify.error("Invalid file type", "Please upload an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      notify.error("File too large", "Please upload an image smaller than 5MB");
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!profile?.org_id) throw new Error("No organization found");

      // Create unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile.org_id}/logo-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('org-logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('org-logos')
        .getPublicUrl(filePath);

      // Update organization with new logo URL
      setOrgData({ ...orgData, logo_url: publicUrl });

      notify.success("Logo uploaded", "Logo uploaded successfully. Don't forget to save changes.");
    } catch (error: any) {
      notify.error("Upload failed", error);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!profile?.org_id) throw new Error("No organization found");

      const { error } = await supabase
        .from("organizations")
        .update({
          name: orgData.name,
          logo_url: orgData.logo_url,
          primary_color: orgData.primary_color,
        })
        .eq("id", profile.org_id);

      if (error) throw error;

      notify.success("Settings saved", "Your organization settings have been updated");
      
      // Reload page to show new logo in sidebar
      window.location.reload();
    } catch (error: any) {
      notify.error("Failed to save", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Organization Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your organization configuration and branding</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
              <p className="text-xs text-muted-foreground">Active organization members</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Teams</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalTeams}</div>
              <p className="text-xs text-muted-foreground">Active teams</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Brand Color</CardTitle>
              <Palette className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div 
                  className="w-8 h-8 rounded border" 
                  style={{ backgroundColor: orgData.primary_color }}
                />
                <span className="text-sm font-mono">{orgData.primary_color}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Organization Information</CardTitle>
            <CardDescription>Update your organization's basic information and branding</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="orgName">Organization Name</Label>
                <Input
                  id="orgName"
                  value={orgData.name}
                  onChange={(e) => setOrgData({ ...orgData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgSlug">Organization ID (URL)</Label>
                <Input
                  id="orgSlug"
                  value={orgData.slug}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Organization ID cannot be changed after creation
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoUrl">Organization Logo</Label>
              <div className="flex gap-4 items-start">
                <div className="flex-1">
                  <Input
                    id="logoUrl"
                    type="url"
                    placeholder="https://example.com/logo.png"
                    value={orgData.logo_url}
                    onChange={(e) => setOrgData({ ...orgData, logo_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter a URL to your organization's logo
                  </p>
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? "Uploading..." : "Upload Logo"}
                  </Button>
                </div>
              </div>
              {orgData.logo_url && (
                <div className="mt-2 p-4 border rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                  <img 
                    src={orgData.logo_url} 
                    alt="Organization logo preview" 
                    className="h-16 object-contain"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primary Brand Color</Label>
              <div className="flex gap-2">
                <Input
                  id="primaryColor"
                  type="color"
                  value={orgData.primary_color}
                  onChange={(e) => setOrgData({ ...orgData, primary_color: e.target.value })}
                  className="w-20 h-10"
                />
                <Input
                  type="text"
                  value={orgData.primary_color}
                  onChange={(e) => setOrgData({ ...orgData, primary_color: e.target.value })}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This color will be used throughout your organization's interface
              </p>
            </div>

            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}