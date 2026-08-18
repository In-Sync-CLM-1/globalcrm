import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Building2, Trash2, Edit, UserPlus, Users, RefreshCw } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { format } from "date-fns";

const entityTypes = [
  { value: "prospect", label: "Prospect" },
  { value: "vendor", label: "Vendor" },
  { value: "partner", label: "Partner" },
  { value: "past_client", label: "Past Client" },
  { value: "other", label: "Other" },
];

interface ExternalEntityFormData {
  id?: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  entity_type: string;
  notes: string;
}

const initialFormData: ExternalEntityFormData = {
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  entity_type: "prospect",
  notes: "",
};

export function ExternalEntitiesTab() {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<ExternalEntityFormData>(initialFormData);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fetch external entities with counts
  const { data: entities, isLoading, refetch } = useQuery({
    queryKey: ["external-entities", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      
      const { data, error } = await supabase
        .from("external_entities")
        .select(`
          *,
          documents:client_documents(count),
          invoices:client_invoices(count)
        `)
        .eq("org_id", effectiveOrgId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  // Filter entities
  const filteredEntities = entities?.filter((entity) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      entity.name?.toLowerCase().includes(searchLower) ||
      entity.company?.toLowerCase().includes(searchLower) ||
      entity.email?.toLowerCase().includes(searchLower);
    
    const matchesType = typeFilter === "all" || entity.entity_type === typeFilter;
    
    return matchesSearch && matchesType;
  });

  const saveMutation = useMutation({
    mutationFn: async (data: ExternalEntityFormData) => {
      if (editingId) {
        const { error } = await supabase
          .from("external_entities")
          .update({
            name: data.name,
            company: data.company || null,
            email: data.email || null,
            phone: data.phone || null,
            address: data.address || null,
            entity_type: data.entity_type,
            notes: data.notes || null,
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("external_entities").insert({
          org_id: effectiveOrgId,
          name: data.name,
          company: data.company || null,
          email: data.email || null,
          phone: data.phone || null,
          address: data.address || null,
          entity_type: data.entity_type,
          notes: data.notes || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      notify.success(editingId ? "Updated" : "Created", "External entity saved successfully");
      queryClient.invalidateQueries({ queryKey: ["external-entities"] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      notify.error("Error", error.message || "Failed to save");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("external_entities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Deleted", "External entity removed");
      queryClient.invalidateQueries({ queryKey: ["external-entities"] });
    },
    onError: () => {
      notify.error("Error", "Failed to delete");
    },
  });

  const convertToContactMutation = useMutation({
    mutationFn: async (entity: any) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Create a contact (lead) from external entity
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          org_id: effectiveOrgId,
          first_name: entity.name,
          company: entity.company,
          email: entity.email,
          phone: entity.phone,
          address: entity.address,
          source: "External Entity",
          notes: entity.notes,
          created_by: user?.id ?? null,
        })
        .select()
        .single();

      if (contactError) throw contactError;

      // Update any documents/invoices linked to this external entity
      await supabase
        .from("client_documents")
        .update({ contact_id: contact.id, external_entity_id: null })
        .eq("external_entity_id", entity.id);

      await supabase
        .from("client_invoices")
        .update({ contact_id: contact.id, external_entity_id: null })
        .eq("external_entity_id", entity.id);

      // Delete the external entity
      await supabase.from("external_entities").delete().eq("id", entity.id);

      return contact;
    },
    onSuccess: () => {
      notify.success("Converted", "External entity converted to contact (lead)");
      queryClient.invalidateQueries({ queryKey: ["external-entities"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: Error) => {
      notify.error("Error", error.message || "Failed to convert");
    },
  });

  const resetForm = () => {
    setFormData(initialFormData);
    setEditingId(null);
  };

  const handleEdit = (entity: any) => {
    setFormData({
      id: entity.id,
      name: entity.name || "",
      company: entity.company || "",
      email: entity.email || "",
      phone: entity.phone || "",
      address: entity.address || "",
      entity_type: entity.entity_type || "prospect",
      notes: entity.notes || "",
    });
    setEditingId(entity.id);
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      notify.error("Error", "Name is required");
      return;
    }
    saveMutation.mutate(formData);
  };

  const stats = {
    total: entities?.length || 0,
    prospects: entities?.filter((e) => e.entity_type === "prospect").length || 0,
    vendors: entities?.filter((e) => e.entity_type === "vendor").length || 0,
    partners: entities?.filter((e) => e.entity_type === "partner").length || 0,
  };

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prospects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.prospects}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vendors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.vendors}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Partners</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.partners}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {entityTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Entity
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit" : "Add"} External Entity</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Contact name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Company</Label>
                    <Input
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                      placeholder="Company name"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+91 98765 43210"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Entity Type</Label>
                  <Select 
                    value={formData.entity_type} 
                    onValueChange={(v) => setFormData({ ...formData, entity_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {entityTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Full address"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Additional notes..."
                  />
                </div>

                <Button type="submit" className="w-full">
                  {editingId ? "Update" : "Create"} Entity
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Entities Table */}
      {isLoading ? (
        <LoadingState message="Loading external entities..." />
      ) : !filteredEntities?.length ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title="No external entities"
          message="Add external entities to manage vendors, partners, and past clients"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Invoices</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntities.map((entity) => (
                  <TableRow key={entity.id}>
                    <TableCell className="font-medium">{entity.name}</TableCell>
                    <TableCell>{entity.company || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {entityTypes.find((t) => t.value === entity.entity_type)?.label || entity.entity_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{entity.email || "-"}</TableCell>
                    <TableCell>{entity.phone || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{(entity.documents as any)?.[0]?.count || 0}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{(entity.invoices as any)?.[0]?.count || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => convertToContactMutation.mutate(entity)}
                        title="Convert to Contact (Lead)"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(entity)}
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(entity.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
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
