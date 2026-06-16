import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Search, Plus, Receipt, Download, Trash2, Filter, Users, Building2, Contact, ArrowRight, Loader2, Sparkles, Upload, Pencil, Check, X } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { EntitySelector, SelectedEntity } from "./EntitySelector";
import { RevenueAnalytics } from "./RevenueAnalytics";
import { SmartInvoiceUploadDialog } from "./SmartInvoiceUploadDialog";
import { MonthlyTaxSummary } from "@/components/Clients/MonthlyTaxSummary";
import { format } from "date-fns";

const invoiceStatuses = [
  { value: "draft", label: "Draft", variant: "outline" as const },
  { value: "sent", label: "Sent", variant: "secondary" as const },
  { value: "paid", label: "Paid", variant: "default" as const },
  { value: "overdue", label: "Overdue", variant: "destructive" as const },
  { value: "cancelled", label: "Cancelled", variant: "outline" as const },
];

export function InvoicesTab() {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSmartUploadOpen, setIsSmartUploadOpen] = useState(false);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  // Form state
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [documentType, setDocumentType] = useState<"invoice" | "quotation">("invoice");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [status, setStatus] = useState("draft");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // Inline editing state
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editTdsAmount, setEditTdsAmount] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");
  const [editActualPayment, setEditActualPayment] = useState("");

  // Fetch organization issuer details
  const { data: orgDetails } = useQuery({
    queryKey: ["org-issuer-details", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return null;

      const { data, error } = await supabase
        .from("organizations")
        .select("issuer_company_name, issuer_gst_number, banking_details")
        .eq("id", effectiveOrgId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch all invoices with entity info
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["all-invoices", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];

      const { data, error } = await supabase
        .from("client_invoices")
        .select(`
          *,
          client:clients(id, first_name, last_name, company),
          contact:contacts(id, first_name, last_name, company),
          external_entity:external_entities(id, name, company)
        `)
        .eq("org_id", effectiveOrgId)
        .order("invoice_date", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  // Filter invoices
  const filteredInvoices = invoices?.filter((inv) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      inv.invoice_number?.toLowerCase().includes(searchLower) ||
      inv.notes?.toLowerCase().includes(searchLower);
    
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    const matchesType = typeFilter === "all" || inv.document_type === typeFilter;
    
    let matchesEntityType = true;
    if (entityTypeFilter === "client") matchesEntityType = !!inv.client_id;
    else if (entityTypeFilter === "contact") matchesEntityType = !!inv.contact_id;
    else if (entityTypeFilter === "external") matchesEntityType = !!inv.external_entity_id;
    
    return matchesSearch && matchesStatus && matchesType && matchesEntityType;
  });

  const getEntityInfo = (inv: any) => {
    if (inv.client) {
      return {
        type: "Client",
        name: `${inv.client.first_name} ${inv.client.last_name || ""}`.trim(),
        company: inv.client.company,
        icon: <Users className="h-3 w-3" />,
      };
    }
    if (inv.contact) {
      return {
        type: "Contact",
        name: `${inv.contact.first_name} ${inv.contact.last_name || ""}`.trim(),
        company: inv.contact.company,
        icon: <Contact className="h-3 w-3" />,
      };
    }
    if (inv.external_entity) {
      return {
        type: "External",
        name: inv.external_entity.name,
        company: inv.external_entity.company,
        icon: <Building2 className="h-3 w-3" />,
      };
    }
    return { type: "Unknown", name: "-", company: null, icon: null };
  };

  const formatCurrency = (value: number, curr: string = "INR") => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: curr,
    }).format(value);
  };

  const extractDataFromFile = async (uploadedFile: File) => {
    setIsExtracting(true);
    try {
      const fileExt = uploadedFile.name.split(".").pop();
      const tempFileName = `temp/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("client-documents")
        .upload(tempFileName, uploadedFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("client-documents")
        .getPublicUrl(tempFileName);

      const { data, error } = await supabase.functions.invoke("extract-document-data", {
        body: { fileUrl: urlData.publicUrl, documentType: "invoice" },
      });

      if (error) throw error;

      if (data?.success && data.extractedData) {
        const extracted = data.extractedData;
        if (extracted.invoice_number) setInvoiceNumber(extracted.invoice_number);
        if (extracted.invoice_date) setInvoiceDate(extracted.invoice_date);
        if (extracted.due_date) setDueDate(extracted.due_date);
        if (extracted.amount) setAmount(String(extracted.amount));
        if (extracted.tax_amount) setTaxAmount(String(extracted.tax_amount));
        if (extracted.currency) setCurrency(extracted.currency);
        if (extracted.notes) setNotes(extracted.notes);
        
        notify.success("Data extracted", "Please review the extracted values");
      }
    } catch (error) {
      console.error("Extraction error:", error);
      notify.error("Extraction failed", "Please fill in manually");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    if (selectedFile) {
      await extractDataFromFile(selectedFile);
    }
  };

  const addInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEntity || !effectiveOrgId) throw new Error("Please select an entity");
      
      setIsUploading(true);
      let fileUrl = null;

      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${selectedEntity.type}/${selectedEntity.id}/invoices/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("client-documents")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("client-documents")
          .getPublicUrl(fileName);

        fileUrl = urlData.publicUrl;
      }

      const insertData: any = {
        org_id: effectiveOrgId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        amount: parseFloat(amount) || 0,
        tax_amount: parseFloat(taxAmount) || 0,
        currency,
        status,
        notes: notes || null,
        file_url: fileUrl,
        document_type: documentType,
      };

      if (selectedEntity.type === "client") insertData.client_id = selectedEntity.id;
      else if (selectedEntity.type === "contact") insertData.contact_id = selectedEntity.id;
      else if (selectedEntity.type === "external") insertData.external_entity_id = selectedEntity.id;

      const { error } = await supabase.from("client_invoices").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Added", `${documentType === "quotation" ? "Quotation" : "Invoice"} added successfully`);
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      notify.error("Error", error.message || "Failed to add");
    },
    onSettled: () => {
      setIsUploading(false);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ invoiceId, newStatus }: { invoiceId: string; newStatus: string }) => {
     const updateData: Record<string, unknown> = { status: newStatus };
     
     // Auto-set payment_received_date when marking as paid
     if (newStatus === "paid") {
       updateData.payment_received_date = new Date().toISOString().split('T')[0];
     }
     
     const { error } = await supabase
        .from("client_invoices")
       .update(updateData)
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Updated", "Status updated");
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
    },
  });

  const updatePaymentDetailsMutation = useMutation({
    mutationFn: async ({ 
      invoiceId, 
      tds_amount, 
      payment_received_date, 
      actual_payment_received,
      net_received_amount 
    }: { 
      invoiceId: string; 
      tds_amount: number | null; 
      payment_received_date: string | null;
      actual_payment_received: number | null;
      net_received_amount: number;
    }) => {
      const { error } = await supabase
        .from("client_invoices")
        .update({ 
          tds_amount, 
          payment_received_date, 
          actual_payment_received,
          net_received_amount
        })
        .eq("id", invoiceId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Updated", "Payment details have been updated");
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
      setEditingInvoiceId(null);
    },
    onError: () => {
      notify.error("Error", "Failed to update payment details");
    },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.from("client_invoices").delete().eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Deleted", "Invoice removed");
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
    },
  });

  const startEditing = (invoice: any) => {
    setEditingInvoiceId(invoice.id);
    setEditTdsAmount(String(invoice.tds_amount || ""));
    setEditPaymentDate(invoice.payment_received_date || "");
    setEditActualPayment(String(invoice.actual_payment_received || ""));
  };

  const cancelEditing = () => {
    setEditingInvoiceId(null);
    setEditTdsAmount("");
    setEditPaymentDate("");
    setEditActualPayment("");
  };

  const savePaymentDetails = (invoice: any) => {
    const gstAmount = invoice.tax_amount || 0;
    const tds = parseFloat(editTdsAmount) || 0;
    const netReceived = invoice.amount + gstAmount - tds;
    
    updatePaymentDetailsMutation.mutate({
      invoiceId: invoice.id,
      tds_amount: tds || null,
      payment_received_date: editPaymentDate || null,
      actual_payment_received: parseFloat(editActualPayment) || null,
      net_received_amount: netReceived
    });
  };

  const convertToInvoiceMutation = useMutation({
    mutationFn: async (quotation: any) => {
      const invoiceCount = invoices?.filter((inv) => inv.document_type === "invoice").length || 0;
      const newInvoiceNumber = `INV-${String(invoiceCount + 1).padStart(3, "0")}`;

      const insertData: any = {
        org_id: effectiveOrgId,
        invoice_number: newInvoiceNumber,
        invoice_date: new Date().toISOString().split("T")[0],
        due_date: quotation.due_date,
        amount: quotation.amount,
        tax_amount: quotation.tax_amount,
        currency: quotation.currency,
        status: "draft",
        notes: `Converted from ${quotation.invoice_number}`,
        file_url: quotation.file_url,
        document_type: "invoice",
        converted_from_quotation_id: quotation.id,
        client_id: quotation.client_id,
        contact_id: quotation.contact_id,
        external_entity_id: quotation.external_entity_id,
      };

      const { error } = await supabase.from("client_invoices").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Converted", "Quotation converted to invoice");
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
    },
  });

  const resetForm = () => {
    setSelectedEntity(null);
    setDocumentType("invoice");
    setInvoiceNumber("");
    setInvoiceDate("");
    setDueDate("");
    setAmount("");
    setTaxAmount("");
    setCurrency("INR");
    setStatus("draft");
    setNotes("");
    setFile(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber || !invoiceDate || !amount) {
      notify.error("Error", "Please fill in all required fields");
      return;
    }
    if (!selectedEntity) {
      notify.error("Error", "Please select an entity");
      return;
    }
    addInvoiceMutation.mutate();
  };

  return (
    <div className="space-y-4">
      {/* Issuer & Banking Details Card */}
      {orgDetails && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-sm mb-2">Issued By</h3>
                <p className="text-sm text-gray-700">{orgDetails.issuer_company_name}</p>
                {orgDetails.issuer_gst_number && (
                  <p className="text-xs text-gray-600 mt-1">GST: {orgDetails.issuer_gst_number}</p>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Banking Details</h3>
                {orgDetails.banking_details && (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p><strong>Bank:</strong> {orgDetails.banking_details.bank_name}</p>
                    <p><strong>Branch:</strong> {orgDetails.banking_details.branch}</p>
                    <p><strong>Account:</strong> {orgDetails.banking_details.account_number}</p>
                    <p><strong>IFSC:</strong> {orgDetails.banking_details.ifsc_code}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Analytics */}
      <RevenueAnalytics invoices={invoices || []} />


      {/* Filters and Actions */}
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="invoice">Invoice</SelectItem>
              <SelectItem value="quotation">Quotation</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {invoiceStatuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              <SelectItem value="client">Clients</SelectItem>
              <SelectItem value="contact">Contacts</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsSmartUploadOpen(true)} className="gap-2">
            <Sparkles className="h-4 w-4" />
            Smart Upload
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Invoice
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New {documentType === "quotation" ? "Quotation" : "Invoice"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Document Type Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Document Type</Label>
                  <p className="text-xs text-muted-foreground">
                    {documentType === "quotation" ? "Pre-revenue, no tax liability" : "Revenue with tax liability"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${documentType === "invoice" ? "font-medium" : "text-muted-foreground"}`}>Invoice</span>
                  <Switch
                    checked={documentType === "quotation"}
                    onCheckedChange={(checked) => setDocumentType(checked ? "quotation" : "invoice")}
                  />
                  <span className={`text-xs ${documentType === "quotation" ? "font-medium" : "text-muted-foreground"}`}>Quotation</span>
                </div>
              </div>

              <EntitySelector
                value={selectedEntity}
                onChange={setSelectedEntity}
                showCreateExternal
              />

              <div className="space-y-2">
                <Label>Upload Document</Label>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  disabled={isExtracting}
                />
                {isExtracting && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Extracting data...</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{documentType === "quotation" ? "Quotation" : "Invoice"} Number *</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder={documentType === "quotation" ? "QT-001" : "INV-001"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date *</Label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {invoiceStatuses.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount *</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tax Amount</Label>
                  <Input
                    type="number"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes..."
                />
              </div>

              <Button type="submit" className="w-full" disabled={isUploading}>
                {isUploading ? "Saving..." : `Add ${documentType === "quotation" ? "Quotation" : "Invoice"}`}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>

        <SmartInvoiceUploadDialog 
          open={isSmartUploadOpen} 
          onOpenChange={setIsSmartUploadOpen} 
        />
      </div>

      {/* Invoices Table */}
      {isLoading ? (
        <LoadingState message="Loading invoices..." />
      ) : !filteredInvoices?.length ? (
        <EmptyState
          icon={<Receipt className="h-12 w-12" />}
          title="No invoices found"
          message="Add invoices and quotations to track your revenue"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Amount</TableHead>
                 <TableHead className="text-right">TDS</TableHead>
                 <TableHead>Payment Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((inv) => {
                  const entityInfo = getEntityInfo(inv);
                  const statusInfo = invoiceStatuses.find((s) => s.value === inv.status);
                  const total = (inv.amount || 0) + (inv.tax_amount || 0);
                  const isQuotation = inv.document_type === "quotation";
                 const isEditing = editingInvoiceId === inv.id;
                 const tdsDeducted = inv.tds_amount || 0;

                  return (
                    <TableRow 
                      key={inv.id}
                     className={inv.file_url && !isEditing ? "cursor-pointer hover:bg-muted/50" : ""}
                     onClick={() => !isEditing && inv.file_url && setViewingFile(inv.file_url)}
                    >
                      <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                      <TableCell>
                        <Badge variant={isQuotation ? "secondary" : "default"}>
                          {isQuotation ? "Quotation" : "Invoice"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="flex items-center gap-1">
                            {entityInfo.icon}
                            {entityInfo.type}
                          </Badge>
                          <span className="text-sm">{entityInfo.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(total, inv.currency)}</TableCell>
                     {/* TDS - Editable */}
                     <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                       {isEditing ? (
                         <Input
                           type="number"
                           value={editTdsAmount}
                           onChange={(e) => setEditTdsAmount(e.target.value)}
                           className="w-24 h-8 text-right text-sm"
                           placeholder="0.00"
                         />
                       ) : (
                         <span className="text-orange-600">{formatCurrency(tdsDeducted, inv.currency)}</span>
                       )}
                     </TableCell>
                     {/* Payment Date - Editable */}
                     <TableCell onClick={(e) => e.stopPropagation()}>
                       {isEditing ? (
                         <Input
                           type="date"
                           value={editPaymentDate}
                           onChange={(e) => setEditPaymentDate(e.target.value)}
                           className="w-32 h-8 text-sm"
                         />
                       ) : (
                         inv.payment_received_date ? format(new Date(inv.payment_received_date), "MMM d, yyyy") : "-"
                       )}
                     </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={inv.status}
                          onValueChange={(newStatus) => updateStatusMutation.mutate({ invoiceId: inv.id, newStatus })}
                        >
                          <SelectTrigger className="w-[100px] h-7">
                            <Badge variant={statusInfo?.variant}>{statusInfo?.label}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {invoiceStatuses.map((s) => (
                              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{format(new Date(inv.invoice_date), "MMM d, yyyy")}</TableCell>
                      <TableCell>{inv.due_date ? format(new Date(inv.due_date), "MMM d, yyyy") : "-"}</TableCell>
                      <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                       {/* Edit button */}
                      {!isEditing && inv.status === "paid" && (
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => startEditing(inv)}
                           title="Edit TDS & Payment Details"
                         >
                           <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                         </Button>
                       )}
                       {/* Save/Cancel when editing */}
                       {isEditing && (
                         <>
                           <Button
                             variant="ghost"
                             size="icon"
                             onClick={() => savePaymentDetails(inv)}
                             title="Save"
                           >
                             <Check className="h-4 w-4 text-green-600" />
                           </Button>
                           <Button
                             variant="ghost"
                             size="icon"
                             onClick={cancelEditing}
                             title="Cancel"
                           >
                             <X className="h-4 w-4 text-destructive" />
                           </Button>
                         </>
                       )}
                        {isQuotation && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => convertToInvoiceMutation.mutate(inv)}
                            title="Convert to Invoice"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        )}
                        {inv.file_url && (
                          <Button variant="ghost" size="icon" asChild title="Download">
                            <a href={inv.file_url} download target="_blank" rel="noopener noreferrer">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteInvoiceMutation.mutate(inv.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Document Viewer Dialog */}
      <Dialog open={!!viewingFile} onOpenChange={(open) => !open && setViewingFile(null)}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Document Viewer</DialogTitle>
          </DialogHeader>
          {viewingFile && (
            <iframe
              src={`https://docs.google.com/viewer?url=${encodeURIComponent(viewingFile)}&embedded=true`}
              className="w-full h-full rounded-md border"
              title="Document Viewer"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
