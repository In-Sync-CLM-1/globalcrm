import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Mail, Phone, MessageSquare, PhoneCall, Link as LinkIcon, Copy } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useDialogState } from "@/hooks/useDialogState";
import { useNotification } from "@/hooks/useNotification";
import { useOrgData } from "@/hooks/useOrgData";
import { useUserRole } from "@/hooks/useUserRole";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
  calling_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  designation_id: string | null;
  reports_to_user_id: string | null;
}

interface UserRole {
  id: string;
  user_id: string;
  role: string;
  profiles: Profile & {
    designations: {
      id: string;
      name: string;
    } | null;
  };
}

interface Designation {
  id: string;
  name: string;
  role: string;
}

type UserFormData = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: "admin" | "analyst" | "sales_agent" | "sales_manager" | "super_admin" | "support_agent" | "support_manager";
  calling_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  designation_id: string | null;
  reports_to_user_id: string | null;
};

const initialFormData: UserFormData = {
  email: "",
  password: "",
  first_name: "",
  last_name: "",
  phone: "",
  role: "sales_agent",
  calling_enabled: false,
  whatsapp_enabled: false,
  email_enabled: false,
  sms_enabled: false,
  designation_id: null,
  reports_to_user_id: null,
};

async function ensureBillingOkForUserAdd(
  orgId: string,
): Promise<{ ok: boolean; reason: string }> {
  // Fetch the org's subscription + active pricing in parallel
  const [{ data: sub }, { data: pricing }] = await Promise.all([
    supabase
      .from("organization_subscriptions")
      .select("subscription_status, next_billing_date, last_payment_date, wallet_balance, user_count")
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase
      .from("subscription_pricing")
      .select("per_user_monthly_cost")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (!sub) {
    // No subscription row → allow (other guards handle this elsewhere)
    return { ok: true, reason: "" };
  }
  if (sub.subscription_status !== "active") {
    return { ok: false, reason: `Subscription is ${sub.subscription_status}. Please reactivate before adding users.` };
  }
  // Trial = no payment made yet AND next_billing_date is still in the future
  const today = new Date().toISOString().slice(0, 10);
  const inTrial = !sub.last_payment_date && sub.next_billing_date && sub.next_billing_date >= today;
  if (inTrial) return { ok: true, reason: "" };

  const seatCost = Number(pricing?.per_user_monthly_cost ?? 799);
  const wallet = Number(sub.wallet_balance ?? 0);
  if (wallet >= seatCost) return { ok: true, reason: "" };

  return {
    ok: false,
    reason: `Trial has ended. Top up the wallet by at least ₹${seatCost.toFixed(0)} before adding a user.`,
  };
}

export default function Users() {
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; userId: string; roleId: string; hardDelete: boolean }>({
    open: false,
    userId: "",
    roleId: "",
    hardDelete: false,
  });
  const [actionLoading, setActionLoading] = useState(false);
  
  const { effectiveOrgId, isPlatformAdmin } = useOrgContext();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const notification = useNotification();
  const queryClient = useQueryClient();
  const dialog = useDialogState<UserFormData>(initialFormData);
  
  // Fetch designations using useOrgData
  const { data: designations = [], isLoading: designationsLoading } = useOrgData<Designation>(
    "designations",
    {
      select: "id, name, role",
      filter: { is_active: true },
      orderBy: { column: "name", ascending: true },
    }
  );

  // Fetch users with React Query
  const { data: users = [], isLoading: loading } = useQuery({
    queryKey: ['users', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      
      const { data, error } = await supabase
        .from("user_roles")
        .select(`
          id,
          user_id,
          role,
          is_active
        `)
        .eq("org_id", effectiveOrgId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch profiles separately
      const userIds = data?.map(ur => ur.user_id) || [];
      
      const { data: profilesData } = await supabase
        .from("profiles")
        .select(`
          id, 
          first_name, 
          last_name, 
          phone, 
          avatar_url, 
          calling_enabled, 
          whatsapp_enabled, 
          email_enabled, 
          sms_enabled,
          designation_id,
          reports_to_user_id,
          designations(id, name)
        `)
        .in("id", userIds);

      // Combine the data
      const usersWithProfiles = data?.map(ur => ({
        ...ur,
        profiles: profilesData?.find(p => p.id === ur.user_id) || {
          id: ur.user_id,
          first_name: "",
          last_name: "",
          phone: null,
          avatar_url: null,
          calling_enabled: false,
          whatsapp_enabled: false,
          email_enabled: false,
          sms_enabled: false,
          designation_id: null,
          reports_to_user_id: null,
          designations: null
        }
      })) || [];

      return usersWithProfiles as UserRole[];
    },
    enabled: !!effectiveOrgId,
  });

  const canManageUsers = () => {
    return isPlatformAdmin || isAdmin || isSuperAdmin;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[Users] handleSubmit called', { isEditing: dialog.isEditing, formData: dialog.formData });
    
    if (!effectiveOrgId) {
      notification.error("Error", "Organization context not available");
      return;
    }

    // Validate required fields for new user
    if (!dialog.isEditing) {
      if (!dialog.formData.email || !dialog.formData.email.trim()) {
        notification.error("Validation Error", "Email is required for new users");
        return;
      }
      if (!dialog.formData.password || !dialog.formData.password.trim()) {
        notification.error("Validation Error", "Password is required for new users");
        return;
      }

      // Adding a user requires either an active trial or wallet credit to cover
      // the next-cycle prorated charge. Org admins must top up before inviting.
      const billingOk = await ensureBillingOkForUserAdd(effectiveOrgId);
      if (!billingOk.ok) {
        notification.error("Billing required", billingOk.reason);
        return;
      }
    }

    setActionLoading(true);

    try {
      if (dialog.isEditing) {
        // Update existing user via edge function
        const { data, error } = await supabase.functions.invoke('manage-user', {
          body: {
            action: 'update',
            userId: dialog.editingItem.user_id,
            first_name: dialog.formData.first_name,
            last_name: dialog.formData.last_name,
            role: dialog.formData.role,
            phone: dialog.formData.phone,
            designation_id: dialog.formData.designation_id,
            reports_to_user_id: dialog.formData.reports_to_user_id,
            calling_enabled: dialog.formData.calling_enabled,
            whatsapp_enabled: dialog.formData.whatsapp_enabled,
            email_enabled: dialog.formData.email_enabled,
            sms_enabled: dialog.formData.sms_enabled,
          }
        });

        if (error) {
          const errorMessage = data?.error || error.message || "Failed to update user";
          throw new Error(errorMessage);
        }
        notification.success("User updated", "User has been updated successfully");
      } else {
        // Create new user via edge function
        const { data, error } = await supabase.functions.invoke('manage-user', {
          body: {
            email: dialog.formData.email,
            password: dialog.formData.password,
            first_name: dialog.formData.first_name,
            last_name: dialog.formData.last_name,
            role: dialog.formData.role,
            phone: dialog.formData.phone,
            designation_id: dialog.formData.designation_id,
            reports_to_user_id: dialog.formData.reports_to_user_id,
            calling_enabled: dialog.formData.calling_enabled,
            whatsapp_enabled: dialog.formData.whatsapp_enabled,
            email_enabled: dialog.formData.email_enabled,
            sms_enabled: dialog.formData.sms_enabled,
          }
        });

        if (error) {
          const errorMessage = data?.error || error.message || "Failed to create user";
          throw new Error(errorMessage);
        }
        notification.success("User created", "User has been created successfully");
      }

      // Invalidate query to refresh data
      await queryClient.invalidateQueries({ queryKey: ['users', effectiveOrgId] });
      
      dialog.closeDialog();
    } catch (error: any) {
      notification.error("Error", error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    const { userId, roleId, hardDelete } = deleteConfirm;
    
    setActionLoading(true);
    
    try {
      if (hardDelete) {
        // Hard delete - completely remove user from all orgs and auth
        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId }),
        });

        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || 'Failed to delete user');
        }

        notification.success("User deleted permanently", "User has been removed from all organizations");
      } else {
        // Soft delete - set is_active to false
        const { error: roleError } = await supabase
          .from("user_roles")
          .update({ is_active: false })
          .eq("id", roleId);

        if (roleError) throw roleError;

        // Also soft delete the profile
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ is_active: false })
          .eq("id", userId);

        if (profileError) throw profileError;

        notification.success("User deactivated", "User has been deactivated in this organization");
      }

      await queryClient.invalidateQueries({ queryKey: ['users', effectiveOrgId] });
    } catch (error: any) {
      notification.error(`Error ${hardDelete ? 'deleting' : 'deactivating'} user`, error);
    } finally {
      setActionLoading(false);
      setDeleteConfirm({ open: false, userId: "", roleId: "", hardDelete: false });
    }
  };

  const openEditDialog = async (user: UserRole) => {
    // Fetch fresh profile data to ensure we have the latest values
    const { data: freshProfile } = await supabase
      .from("profiles")
      .select(`
        id, 
        first_name, 
        last_name, 
        phone, 
        calling_enabled, 
        whatsapp_enabled, 
        email_enabled,
        sms_enabled,
        designation_id,
        reports_to_user_id
      `)
      .eq("id", user.user_id)
      .single();

    dialog.openDialog({
      ...user,
      email: "",
      password: "",
      first_name: freshProfile?.first_name || user.profiles.first_name || "",
      last_name: freshProfile?.last_name || user.profiles.last_name || "",
      phone: freshProfile?.phone || user.profiles.phone || "",
      role: user.role as any,
      calling_enabled: freshProfile?.calling_enabled ?? user.profiles.calling_enabled ?? false,
      whatsapp_enabled: freshProfile?.whatsapp_enabled ?? user.profiles.whatsapp_enabled ?? false,
      email_enabled: freshProfile?.email_enabled ?? user.profiles.email_enabled ?? false,
      sms_enabled: freshProfile?.sms_enabled ?? user.profiles.sms_enabled ?? false,
      designation_id: freshProfile?.designation_id ?? user.profiles.designation_id ?? null,
      reports_to_user_id: freshProfile?.reports_to_user_id ?? user.profiles.reports_to_user_id ?? null,
    });
  };

  const generateInviteLink = async (role: string, email?: string) => {
    if (!effectiveOrgId) {
      notification.error("Error", "Organization context not available");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const inviteCode = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      const { error } = await supabase
        .from("org_invites")
        .insert([{
          org_id: effectiveOrgId,
          invited_by: user?.id,
          invite_code: inviteCode,
          email: email || null,
          role: role,
          expires_at: expiresAt.toISOString(),
        }] as any);

      if (error) throw error;

      const link = `https://crm.in-sync.co.in/signup?invite=${inviteCode}`;
      setInviteLink(link);
      setIsInviteDialogOpen(true);

      notification.success("Invite link generated", "Share this link with the person you want to invite");
    } catch (error: any) {
      notification.error("Error", error.message);
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    notification.success("Copied!", "Invite link copied to clipboard");
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      super_admin: "bg-purple-500",
      admin: "bg-red-500",
      sales_manager: "bg-blue-500",
      sales_agent: "bg-green-500",
      support_manager: "bg-yellow-500",
      support_agent: "bg-orange-500",
      analyst: "bg-gray-500",
    };
    return colors[role] || "bg-gray-500";
  };

  if (loading && users.length === 0) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading users..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground">Manage your organization's users and roles</p>
          </div>
          {canManageUsers() && (
            <div className="flex gap-2">
              <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Generate Invite Link
                  </Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Generate Invite Link</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Select Role</Label>
                    <Select onValueChange={(role) => generateInviteLink(role)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sales_agent">Sales Agent</SelectItem>
                        <SelectItem value="sales_manager">Sales Manager</SelectItem>
                        <SelectItem value="support_agent">Support Agent</SelectItem>
                        <SelectItem value="support_manager">Support Manager</SelectItem>
                        <SelectItem value="analyst">Analyst</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {inviteLink && (
                    <div className="space-y-2">
                      <Label>Invite Link</Label>
                      <div className="flex gap-2">
                        <Input value={inviteLink} readOnly />
                        <Button onClick={copyInviteLink} size="icon" variant="outline">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This link expires in 7 days
                      </p>
                    </div>
                  )}
                </div>
              </DialogContent>
              </Dialog>

              <Dialog open={dialog.isOpen} onOpenChange={(open) => (open ? dialog.openDialog() : dialog.closeDialog())}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add User
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{dialog.isEditing ? "Edit User" : "Add New User"}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {!dialog.isEditing && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email *</Label>
                          <Input
                            id="email"
                            type="email"
                            value={dialog.formData.email}
                            onChange={(e) => dialog.updateFormData({ email: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="password">Password *</Label>
                          <Input
                            id="password"
                            type="password"
                            value={dialog.formData.password}
                            onChange={(e) => dialog.updateFormData({ password: e.target.value })}
                            required
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="first_name">First Name *</Label>
                      <Input
                        id="first_name"
                        value={dialog.formData.first_name}
                        onChange={(e) => dialog.updateFormData({ first_name: e.target.value })}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="last_name">Last Name</Label>
                      <Input
                        id="last_name"
                        value={dialog.formData.last_name}
                        onChange={(e) => dialog.updateFormData({ last_name: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={dialog.formData.phone}
                        onChange={(e) => dialog.updateFormData({ phone: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="designation">Designation</Label>
                      <Select
                        value={dialog.formData.designation_id || undefined}
                        onValueChange={(value) => dialog.updateFormData({ designation_id: value || null })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select designation (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {designations.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">
                              No designations available. Create one in Designations page.
                            </div>
                          ) : (
                            designations.map((designation) => (
                              <SelectItem key={designation.id} value={designation.id}>
                                {designation.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reports_to">Reports To</Label>
                      <Select
                        value={dialog.formData.reports_to_user_id || undefined}
                        onValueChange={(value) => dialog.updateFormData({ reports_to_user_id: value || null })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select manager (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {users
                            .filter((u) => u.user_id !== dialog.editingItem?.user_id)
                            .map((u) => (
                              <SelectItem key={u.user_id} value={u.user_id}>
                                {u.profiles.first_name} {u.profiles.last_name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="role">Role *</Label>
                      <Select 
                        value={dialog.formData.role} 
                        onValueChange={(value) => dialog.updateFormData({ role: value as any })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sales_agent">Sales Agent</SelectItem>
                          <SelectItem value="sales_manager">Sales Manager</SelectItem>
                          <SelectItem value="support_agent">Support Agent</SelectItem>
                          <SelectItem value="support_manager">Support Manager</SelectItem>
                          <SelectItem value="analyst">Analyst</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <Label>Communication Enablement</Label>
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="calling_enabled"
                            checked={dialog.formData.calling_enabled}
                            onCheckedChange={(checked) => 
                              dialog.updateFormData({ calling_enabled: checked as boolean })
                            }
                          />
                          <label
                            htmlFor="calling_enabled"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                          >
                            <PhoneCall className="h-4 w-4" />
                            Calling
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="whatsapp_enabled"
                            checked={dialog.formData.whatsapp_enabled}
                            onCheckedChange={(checked) => 
                              dialog.updateFormData({ whatsapp_enabled: checked as boolean })
                            }
                          />
                          <label
                            htmlFor="whatsapp_enabled"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                          >
                            <MessageSquare className="h-4 w-4" />
                            WhatsApp
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="email_enabled"
                            checked={dialog.formData.email_enabled}
                            onCheckedChange={(checked) => 
                              dialog.updateFormData({ email_enabled: checked as boolean })
                            }
                          />
                          <label
                            htmlFor="email_enabled"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                          >
                            <Mail className="h-4 w-4" />
                            Email
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="sms_enabled"
                            checked={dialog.formData.sms_enabled}
                            onCheckedChange={(checked) => 
                              dialog.updateFormData({ sms_enabled: checked as boolean })
                            }
                          />
                          <label
                            htmlFor="sms_enabled"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                          >
                            <MessageSquare className="h-4 w-4" />
                            SMS
                          </label>
                        </div>
                      </div>
                    </div>

                    <Button type="submit" className="w-full" disabled={actionLoading}>
                      {dialog.isEditing ? "Update User" : "Create User"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Users ({users.length})</CardTitle>
            <CardDescription>All users in your organization</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState message="Loading users..." />
            ) : users.length === 0 ? (
              <EmptyState
                message="No users found"
                action={
                  canManageUsers() ? (
                    <Button onClick={() => dialog.openDialog()}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add First User
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="py-2 text-xs">Name</TableHead>
                    <TableHead className="py-2 text-xs">Designation</TableHead>
                    <TableHead className="py-2 text-xs">Reports To</TableHead>
                    <TableHead className="py-2 text-xs">Contact</TableHead>
                    <TableHead className="py-2 text-xs">Communication</TableHead>
                    <TableHead className="py-2 text-xs">Role</TableHead>
                    {canManageUsers() && <TableHead className="py-2 text-xs text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="py-1.5 font-medium">
                        {user.profiles.first_name} {user.profiles.last_name}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs">
                        {user.profiles.designations?.name || "-"}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs">
                        {(() => {
                          const manager = users.find((u) => u.user_id === user.profiles.reports_to_user_id);
                          return manager ? `${manager.profiles.first_name} ${manager.profiles.last_name}` : "-";
                        })()}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex flex-col gap-1 text-xs">
                          {user.profiles.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {user.profiles.phone}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex gap-1 flex-wrap">
                          {user.profiles.calling_enabled && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">
                              <PhoneCall className="h-3 w-3 mr-1" />
                              Call
                            </Badge>
                          )}
                          {user.profiles.whatsapp_enabled && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">
                              <MessageSquare className="h-3 w-3 mr-1" />
                              WA
                            </Badge>
                          )}
                          {user.profiles.email_enabled && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">
                              <Mail className="h-3 w-3 mr-1" />
                              Email
                            </Badge>
                          )}
                          {user.profiles.sms_enabled && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">
                              <MessageSquare className="h-3 w-3 mr-1" />
                              SMS
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge className={`text-xs ${getRoleBadgeColor(user.role)}`}>
                          {user.role.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      {canManageUsers() && (
                        <TableCell className="py-1.5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => openEditDialog(user)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setDeleteConfirm({ open: true, userId: user.user_id, roleId: user.id, hardDelete: false })}
                              title="Deactivate user in this organization"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            {(isPlatformAdmin || isSuperAdmin) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={() => setDeleteConfirm({ open: true, userId: user.user_id, roleId: user.id, hardDelete: true })}
                                title="Permanently delete user from all organizations"
                              >
                                <Trash2 className="h-3 w-3 fill-current" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => !open && setDeleteConfirm({ open: false, userId: "", roleId: "", hardDelete: false })}
        title={deleteConfirm.hardDelete ? "Permanently Delete User" : "Deactivate User"}
        description={
          deleteConfirm.hardDelete 
            ? "Are you sure you want to PERMANENTLY delete this user from ALL organizations? This action cannot be undone."
            : "Are you sure you want to deactivate this user?"
        }
        onConfirm={handleDeleteConfirm}
        confirmText={deleteConfirm.hardDelete ? "Delete Permanently" : "Deactivate"}
      />
    </DashboardLayout>
  );
}
