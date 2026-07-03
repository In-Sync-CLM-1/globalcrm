import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useDialogState } from "@/hooks/useDialogState";
import { useNotification } from "@/hooks/useNotification";
import { useOrgData } from "@/hooks/useOrgData";
import { useCRUD } from "@/hooks/useCRUD";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, FileText, Link2, Copy } from "lucide-react";

interface CustomField {
  id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  is_active: boolean;
}

interface Form {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  connector_type: string;
}

interface FormWithFields extends Form {
  field_count: number;
}

interface FormData {
  name: string;
  description: string;
  is_active: boolean;
  connector_type: string;
}

export default function Forms() {
  const { effectiveOrgId } = useOrgContext();
  const notification = useNotification();
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formsWithCounts, setFormsWithCounts] = useState<FormWithFields[]>([]);
  
  const dialog = useDialogState<FormData>({
    name: "",
    description: "",
    is_active: true,
    connector_type: "manual",
  });

  const { data: forms = [], isLoading: formsLoading, refetch: refetchForms } = useOrgData<Form>(
    "forms",
    {
      orderBy: { column: "created_at", ascending: false },
    }
  );

  const { data: customFields = [], isLoading: fieldsLoading } = useOrgData<CustomField>(
    "custom_fields",
    {
      filter: { is_active: true },
      orderBy: { column: "field_order", ascending: true },
    }
  );

  const loading = formsLoading || fieldsLoading;

  const fetchFormsWithCounts = useCallback(async () => {
    if (forms.length === 0) {
      setFormsWithCounts([]);
      return;
    }

    const formsWithCountsData = await Promise.all(
      forms.map(async (form) => {
        const { count } = await supabase
          .from("form_fields")
          .select("*", { count: "exact", head: true })
          .eq("form_id", form.id);

        return {
          ...form,
          field_count: count || 0,
        };
      })
    );

    setFormsWithCounts(formsWithCountsData as any);
  }, [forms]);

  const { create, update, delete: deleteForm } = useCRUD("forms", {
    onSuccess: () => {
      refetchForms();
    },
  });

  useEffect(() => {
    fetchFormsWithCounts();
  }, [fetchFormsWithCounts]);

  const fetchFormFields = async (formId: string) => {
    try {
      const { data, error } = await supabase
        .from("form_fields")
        .select("custom_field_id")
        .eq("form_id", formId);

      if (error) throw error;
      return data.map((ff) => ff.custom_field_id);
    } catch (error: any) {
      notification.error("Error loading form fields", error);
      return [];
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (selectedFields.length === 0) {
      notification.error("No fields selected", "Please select at least one field for the form");
      return;
    }

    if (!effectiveOrgId) return;

    try {
      let formId: string;

      if (dialog.editingItem) {
        await update({
          id: dialog.editingItem.id,
          data: {
            name: dialog.formData.name,
            description: dialog.formData.description,
            is_active: dialog.formData.is_active,
            connector_type: dialog.formData.connector_type,
          }
        });
        formId = dialog.editingItem.id;

        // Delete existing form fields
        await supabase
          .from("form_fields")
          .delete()
          .eq("form_id", formId);
      } else {
        const { data: newForm, error: insertError } = await supabase
          .from("forms")
          .insert([{
            org_id: effectiveOrgId,
            name: dialog.formData.name,
            description: dialog.formData.description,
            is_active: dialog.formData.is_active,
            connector_type: dialog.formData.connector_type,
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        formId = newForm.id;
      }

      // Insert form fields
      const formFields = selectedFields.map((fieldId, index) => ({
        form_id: formId,
        custom_field_id: fieldId,
        field_order: index,
      }));

      const { error: fieldsError } = await supabase
        .from("form_fields")
        .insert(formFields);

      if (fieldsError) throw fieldsError;

      notification.success(
        dialog.editingItem ? "Form updated" : "Form created",
        `Form has been ${dialog.editingItem ? "updated" : "created"} successfully`
      );

      dialog.closeDialog();
      setSelectedFields([]);
      refetchForms();
      fetchFormsWithCounts();
    } catch (error: any) {
      notification.error("Error", error.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      await deleteForm(deleteConfirm);
      notification.success("Form deleted", "Form has been removed successfully");
    } catch (error: any) {
      notification.error("Error deleting form", error);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const openEditDialog = async (form: Form) => {
    dialog.openDialog(form);
    dialog.setFormData({
      name: form.name,
      description: form.description || "",
      is_active: form.is_active,
      connector_type: form.connector_type || "manual",
    });
    
    const fields = await fetchFormFields(form.id);
    setSelectedFields(fields);
  };

  const toggleFieldSelection = (fieldId: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldId) 
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    );
  };

  const copyFormLink = (formId: string) => {
    const link = `${window.location.origin}/form/${formId}`;
    navigator.clipboard.writeText(link);
    notification.success("Link copied", "Form link has been copied to clipboard");
  };

  const getConnectorTypeBadge = (type: string) => {
    const badges = {
      manual: { label: "Manual", variant: "secondary" as const },
      public_form: { label: "Public Form", variant: "default" as const },
    };
    const config = badges[type as keyof typeof badges] || badges.manual;
    
    return (
      <Badge variant={config.variant} className="flex items-center gap-1 w-fit">
        {config.label}
      </Badge>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Forms</h1>
            <p className="text-muted-foreground">Create custom forms for lead data collection</p>
          </div>
          <Dialog open={dialog.isOpen} onOpenChange={(open) => { if (!open) dialog.closeDialog(); }}>
            <DialogTrigger asChild>
              <Button onClick={() => {
                dialog.openDialog();
                setSelectedFields([]);
              }}>
                <Plus className="mr-2 h-4 w-4" />
                Create Form
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{dialog.editingItem ? "Edit Form" : "Create New Form"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Form Name *</Label>
                  <Input
                    id="name"
                    value={dialog.formData.name}
                    onChange={(e) => dialog.updateFormData({ name: e.target.value })}
                    placeholder="e.g., Lead Intake Form"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={dialog.formData.description}
                    onChange={(e) => dialog.updateFormData({ description: e.target.value })}
                    placeholder="Brief description of this form"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="connector_type">Form Type</Label>
                  <Select
                    value={dialog.formData.connector_type}
                    onValueChange={(value) => dialog.updateFormData({ connector_type: value })}
                  >
                    <SelectTrigger id="connector_type" className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="manual">Manual Entry</SelectItem>
                      <SelectItem value="public_form">Public Form</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {dialog.formData.connector_type === "manual" && "Form for manual data entry"}
                    {dialog.formData.connector_type === "public_form" && "Public form that anyone can submit"}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="is_active">Active</Label>
                  <Switch
                    id="is_active"
                    checked={dialog.formData.is_active}
                    onCheckedChange={(checked) => dialog.updateFormData({ is_active: checked })}
                  />
                </div>

                <div className="space-y-3">
                  <Label>Select Fields for Form *</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose which custom fields to include in this form
                  </p>
                  <div className="border rounded-lg p-4 space-y-2 max-h-64 overflow-y-auto">
                    {customFields.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No custom fields available. Create some fields first.
                      </p>
                    ) : (
                      customFields.map((field) => (
                        <div key={field.id} className="flex items-center space-x-2 p-2 hover:bg-muted rounded">
                          <Checkbox
                            id={field.id}
                            checked={selectedFields.includes(field.id)}
                            onCheckedChange={() => toggleFieldSelection(field.id)}
                          />
                          <Label
                            htmlFor={field.id}
                            className="flex-1 cursor-pointer flex items-center gap-2"
                          >
                            <span>{field.field_label}</span>
                            <Badge variant="outline" className="text-xs">
                              {field.field_type}
                            </Badge>
                          </Label>
                        </div>
                      ))
                    )}
                  </div>
                  {selectedFields.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {selectedFields.length} field{selectedFields.length !== 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>

                <div className="flex gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={dialog.closeDialog} className="flex-1">
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1">
                    {dialog.editingItem ? "Update Form" : "Create Form"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <LoadingState message="Loading forms..." />
        ) : formsWithCounts.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-12 w-12 text-muted-foreground" />}
            message="No forms created yet. Click 'Create Form' to get started."
          />
        ) : (
          <div className="grid gap-4">
            {formsWithCounts.map((form) => (
              <Card key={form.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground mt-1" />
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {form.name}
                          {getConnectorTypeBadge(form.connector_type || "manual")}
                          {!form.is_active && (
                            <Badge variant="outline" className="text-xs">Inactive</Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="space-y-2">
                          <div>{form.description || "No description"}</div>
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            <span>{form.field_count} field{form.field_count !== 1 ? 's' : ''}</span>
                            {form.connector_type === "public_form" && (
                              <>
                                <span>•</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyFormLink(form.id);
                                  }}
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  <Link2 className="h-3 w-3" />
                                  Public link
                                </button>
                              </>
                            )}
                          </div>
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {form.connector_type === "public_form" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyFormLink(form.id)}
                          title="Copy form link"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(form)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteConfirm(form.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Delete Form"
        description="Are you sure? This will delete the form and all its field associations."
        onConfirm={handleDelete}
        confirmText="Delete"
        variant="destructive"
      />
    </DashboardLayout>
  );
}
