import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { openStoredFile, signedFileUrl, useSignedFileUrl } from "@/lib/storedFiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Receipt, Trash2, Download, Loader2, Sparkles, FileText, ArrowRight, Calendar, Pencil, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useNotification } from "@/hooks/useNotification";
import { EmptyState } from "@/components/common/EmptyState";
import { format } from "date-fns";

interface ClientInvoicesProps {
  clientId: string;
  orgId: string;
}

const invoiceStatuses = [
  { value: "draft", label: "Draft", variant: "outline" as const },
  { value: "sent", label: "Sent", variant: "secondary" as const },
  { value: "paid", label: "Paid", variant: "default" as const },
  { value: "overdue", label: "Overdue", variant: "destructive" as const },
  { value: "cancelled", label: "Cancelled", variant: "outline" as const },
];

const documentTypes = [
  { value: "invoice", label: "Invoice", prefix: "INV-" },
  { value: "quotation", label: "Quotation", prefix: "QT-" },
];

const gstRates = [
  { value: "0", label: "0%" },
  { value: "5", label: "5%" },
  { value: "12", label: "12%" },
  { value: "18", label: "18%" },
  { value: "28", label: "28%" },
];

const tdsRates = [
  { value: "0", label: "0%" },
  { value: "1", label: "1%" },
  { value: "2", label: "2%" },
  { value: "10", label: "10%" },
];

export function ClientInvoices({ clientId, orgId }: ClientInvoicesProps) {
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const viewingLink = useSignedFileUrl(viewingFile);
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
  const [extractedData, setExtractedData] = useState<Record<string, unknown> | null>(null);
  const [documentType, setDocumentType] = useState<"invoice" | "quotation">("invoice");
  
  // New GST/TDS fields
  const [gstRate, setGstRate] = useState("18");
  const [tdsRate, setTdsRate] = useState("2");
  const [manualTds, setManualTds] = useState(false);
  const [tdsAmount, setTdsAmount] = useState("");
  const [paymentReceivedDate, setPaymentReceivedDate] = useState("");

  // Inline editing state
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editTdsAmount, setEditTdsAmount] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");
  const [editActualPayment, setEditActualPayment] = useState("");

  // Calculate GST and TDS amounts
  const baseAmount = parseFloat(amount) || 0;
  const calculatedGstAmount = baseAmount * (parseFloat(gstRate) / 100);
  const calculatedTdsAmount = manualTds ? (parseFloat(tdsAmount) || 0) : baseAmount * (parseFloat(tdsRate) / 100);
  const totalInvoice = baseAmount + calculatedGstAmount;
  const netReceivable = totalInvoice - calculatedTdsAmount;

  const { data: invoices } = useQuery({
    queryKey: ["client-invoices", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_invoices")
        .select("*")
        .eq("client_id", clientId)
        .order("invoice_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const extractDataFromFile = async (uploadedFile: File) => {
    setIsExtracting(true);
    try {
      // First upload the file temporarily to get a public URL
      const fileExt = uploadedFile.name.split(".").pop();
      const tempFileName = `${orgId}/${clientId}/temp/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("client-documents")
        .upload(tempFileName, uploadedFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("client-documents")
        .getPublicUrl(tempFileName);

      // Call the extraction edge function
      const { data, error } = await supabase.functions.invoke('extract-document-data', {
        body: { fileUrl: await signedFileUrl(urlData.publicUrl, 600), documentType: 'invoice' }
      });

      if (error) throw error;

      if (data?.success && data.extractedData) {
        setExtractedData(data.extractedData);
        
        // Auto-populate form fields
        const extracted = data.extractedData;
        if (extracted.invoice_number) setInvoiceNumber(extracted.invoice_number);
        if (extracted.invoice_date) setInvoiceDate(extracted.invoice_date);
        if (extracted.due_date) setDueDate(extracted.due_date);
        if (extracted.amount) setAmount(String(extracted.amount));
        if (extracted.tax_amount) setTaxAmount(String(extracted.tax_amount));
        if (extracted.currency) setCurrency(extracted.currency);
        if (extracted.notes) setNotes(extracted.notes);
        
        notify.success("Data extracted", "Please review and edit the extracted values before saving");
      } else {
        notify.info("Extraction incomplete", "Could not extract all data. Please fill in manually.");
      }
    } catch (error) {
      console.error("Extraction error:", error);
      notify.error("Extraction failed", "Could not extract data from document. Please fill in manually.");
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
      setIsUploading(true);
      let fileUrl = null;

      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${orgId}/${clientId}/invoices/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from("client-documents")
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("client-documents")
          .getPublicUrl(fileName);

        fileUrl = urlData.publicUrl;
      }

      const { error } = await supabase
        .from("client_invoices")
        .insert({
          client_id: clientId,
          org_id: orgId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          amount: parseFloat(amount) || 0,
          tax_amount: calculatedGstAmount,
          currency,
          status,
          notes: notes || null,
          file_url: fileUrl,
          document_type: documentType,
          gst_rate: parseFloat(gstRate) || 0,
          tds_amount: calculatedTdsAmount,
          net_received_amount: netReceivable,
          payment_received_date: paymentReceivedDate || null,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Invoice added", "The invoice has been added successfully");
      queryClient.invalidateQueries({ queryKey: ["client-invoices", clientId] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      console.error("Failed to add invoice:", error);
      notify.error("Error", error.message || "Failed to add invoice");
    },
    onSettled: () => {
      setIsUploading(false);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ invoiceId, newStatus }: { invoiceId: string; newStatus: string }) => {
     const updateData: Record<string, unknown> = { status: newStatus };
     
     // Auto-set payment_received_date to today when marking as paid
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
      notify.success("Status updated", "Invoice status has been updated");
      queryClient.invalidateQueries({ queryKey: ["client-invoices", clientId] });
    },
    onError: () => {
      notify.error("Error", "Failed to update status");
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
      queryClient.invalidateQueries({ queryKey: ["client-invoices", clientId] });
      setEditingInvoiceId(null);
    },
    onError: () => {
      notify.error("Error", "Failed to update payment details");
    },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase
        .from("client_invoices")
        .delete()
        .eq("id", invoiceId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Invoice deleted", "The invoice has been removed");
      queryClient.invalidateQueries({ queryKey: ["client-invoices", clientId] });
    },
    onError: () => {
      notify.error("Error", "Failed to delete invoice");
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
      // Generate new invoice number
      const invoiceCount = invoices?.filter(inv => (inv as any).document_type === 'invoice').length || 0;
      const newInvoiceNumber = `INV-${String(invoiceCount + 1).padStart(3, '0')}`;
      
      const { error } = await supabase
        .from("client_invoices")
        .insert({
          client_id: clientId,
          org_id: orgId,
          invoice_number: newInvoiceNumber,
          invoice_date: new Date().toISOString().split('T')[0],
          due_date: quotation.due_date,
          amount: quotation.amount,
          tax_amount: quotation.tax_amount,
          currency: quotation.currency,
          status: "draft",
          notes: quotation.notes ? `Converted from ${quotation.invoice_number}. ${quotation.notes}` : `Converted from ${quotation.invoice_number}`,
          file_url: quotation.file_url,
          document_type: "invoice",
          converted_from_quotation_id: quotation.id,
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Converted", "Quotation has been converted to an invoice");
      queryClient.invalidateQueries({ queryKey: ["client-invoices", clientId] });
    },
    onError: (error: Error) => {
      notify.error("Error", error.message || "Failed to convert quotation");
    },
  });

  const resetForm = () => {
    setInvoiceNumber("");
    setInvoiceDate("");
    setDueDate("");
    setAmount("");
    setTaxAmount("");
    setCurrency("INR");
    setStatus("draft");
    setNotes("");
    setFile(null);
    setExtractedData(null);
    setDocumentType("invoice");
    setGstRate("18");
    setTdsRate("2");
    setManualTds(false);
    setTdsAmount("");
    setPaymentReceivedDate("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber || !invoiceDate || !amount) {
      notify.error("Error", "Please fill in all required fields");
      return;
    }
    addInvoiceMutation.mutate();
  };

  const formatCurrency = (value: number, curr: string) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: curr,
    }).format(value);
  };

  // Only count invoices (not quotations) for revenue totals
  const invoicesOnly = invoices?.filter((inv) => (inv as any).document_type !== 'quotation') || [];
  const totalAmount = invoicesOnly.reduce((sum, inv) => sum + (inv.amount || 0) + ((inv as any).tax_amount || 0), 0);
  const paidAmount = invoicesOnly.filter((inv) => inv.status === "paid").reduce((sum, inv) => sum + (inv.amount || 0) + ((inv as any).tax_amount || 0), 0);
  const totalTds = invoicesOnly.reduce((sum, inv) => sum + ((inv as any).tds_amount || 0), 0);
  const totalNetReceived = invoicesOnly.reduce((sum, inv) => {
    const gst = (inv as any).tax_amount || 0;
    const tds = (inv as any).tds_amount || 0;
    return sum + ((inv as any).net_received_amount || (inv.amount + gst - tds));
  }, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Invoices / Quotations</CardTitle>
          <div className="flex flex-wrap gap-4 mt-2 text-sm">
            <span>Invoiced: <strong>{formatCurrency(totalAmount, "INR")}</strong></span>
            <span className="text-orange-600">TDS: <strong>{formatCurrency(totalTds, "INR")}</strong></span>
            <span className="text-green-600">Net Receivable: <strong>{formatCurrency(totalNetReceived, "INR")}</strong></span>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New {documentType === 'quotation' ? 'Quotation' : 'Invoice'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Document Type Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Document Type</Label>
                  <p className="text-xs text-muted-foreground">
                    {documentType === 'quotation' 
                      ? 'Quotation - Pre-revenue, no tax liability' 
                      : 'Invoice - Revenue with tax liability'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${documentType === 'invoice' ? 'font-medium' : 'text-muted-foreground'}`}>Invoice</span>
                  <Switch
                    checked={documentType === 'quotation'}
                    onCheckedChange={(checked) => setDocumentType(checked ? 'quotation' : 'invoice')}
                  />
                  <span className={`text-xs ${documentType === 'quotation' ? 'font-medium' : 'text-muted-foreground'}`}>Quotation</span>
                </div>
              </div>

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
                    <span>Extracting data from document...</span>
                  </div>
                )}
                {extractedData && !isExtracting && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Sparkles className="h-4 w-4" />
                    <span>Data extracted! Please review and edit below.</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{documentType === 'quotation' ? 'Quotation' : 'Invoice'} Number *</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder={documentType === 'quotation' ? 'QT-001' : 'INV-001'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{documentType === 'quotation' ? 'Quotation' : 'Invoice'} Date *</Label>
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
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Base Amount *</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>GST Rate</Label>
                  <Select value={gstRate} onValueChange={setGstRate}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {gstRates.map((rate) => (
                        <SelectItem key={rate.value} value={rate.value}>
                          {rate.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* GST Amount Display */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>GST Amount</Label>
                  <div className="h-10 px-3 py-2 border rounded-md bg-muted text-blue-600 font-medium">
                    {formatCurrency(calculatedGstAmount, currency)}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Total Invoice</Label>
                  <div className="h-10 px-3 py-2 border rounded-md bg-muted font-medium">
                    {formatCurrency(totalInvoice, currency)}
                  </div>
                </div>
              </div>

              {/* TDS Section */}
              <div className="p-3 rounded-lg border bg-orange-50 dark:bg-orange-950/20 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">TDS Deduction</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="manual-tds"
                      checked={manualTds}
                      onCheckedChange={(checked) => setManualTds(checked as boolean)}
                    />
                    <label htmlFor="manual-tds" className="text-xs text-muted-foreground cursor-pointer">
                      Enter TDS manually
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {!manualTds ? (
                    <div className="space-y-2">
                      <Label className="text-xs">TDS Rate</Label>
                      <Select value={tdsRate} onValueChange={setTdsRate}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {tdsRates.map((rate) => (
                            <SelectItem key={rate.value} value={rate.value}>
                              {rate.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-xs">TDS Amount (Manual)</Label>
                      <Input
                        type="number"
                        value={tdsAmount}
                        onChange={(e) => setTdsAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="text-xs">TDS Deducted</Label>
                    <div className="h-10 px-3 py-2 border rounded-md bg-white dark:bg-background text-orange-600 font-medium">
                      {formatCurrency(calculatedTdsAmount, currency)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Receivable */}
              <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-950/20">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Net Receivable (after TDS)</Label>
                  <span className="text-lg font-bold text-green-600">
                    {formatCurrency(netReceivable, currency)}
                  </span>
                </div>
              </div>

              {/* Payment Received Date - show when status is paid */}
              {status === "paid" && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Payment Received Date
                  </Label>
                  <Input
                    type="date"
                    value={paymentReceivedDate}
                    onChange={(e) => setPaymentReceivedDate(e.target.value)}
                  />
                </div>
              )}

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
                  placeholder="Add notes..."
                />
              </div>
              <Button type="submit" className="w-full" disabled={isUploading || isExtracting}>
                {isUploading ? "Uploading..." : `Add ${documentType === 'quotation' ? 'Quotation' : 'Invoice'}`}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        
        {!invoices?.length ? (
          <EmptyState
            icon={<Receipt className="h-12 w-12" />}
            title="No invoices"
            message="Add invoices and quotations for this client"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const statusInfo = invoiceStatuses.find((s) => s.value === invoice.status);
                const gstAmount = (invoice as any).tax_amount || 0;
                const tdsDeducted = (invoice as any).tds_amount || 0;
                const netReceived = (invoice as any).net_received_amount || (invoice.amount + gstAmount - tdsDeducted);
                const paymentDate = (invoice as any).payment_received_date;
                const actualPayment = (invoice as any).actual_payment_received;
                const isQuotation = (invoice as any).document_type === 'quotation';
                const isEditing = editingInvoiceId === invoice.id;
                
                return (
                  <TableRow 
                    key={invoice.id}
                    className={invoice.file_url && !isEditing ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => !isEditing && invoice.file_url && setViewingFile(invoice.file_url)}
                  >
                    <TableCell>
                      <Badge variant={isQuotation ? "secondary" : "default"} className="text-xs">
                        {isQuotation ? "Quote" : "Invoice"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                    <TableCell>{format(new Date(invoice.invoice_date), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right">{formatCurrency(invoice.amount, invoice.currency)}</TableCell>
                    <TableCell className="text-right text-blue-600">{formatCurrency(gstAmount, invoice.currency)}</TableCell>
                    
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
                        <span className="text-orange-600">{formatCurrency(tdsDeducted, invoice.currency)}</span>
                      )}
                    </TableCell>
                    
                    <TableCell className="text-right font-medium text-green-600">
                      {isEditing ? (
                        formatCurrency(invoice.amount + gstAmount - (parseFloat(editTdsAmount) || 0), invoice.currency)
                      ) : (
                        formatCurrency(netReceived, invoice.currency)
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
                        paymentDate ? format(new Date(paymentDate), "MMM d, yyyy") : "-"
                      )}
                    </TableCell>
                    
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Select
                          value={invoice.status}
                          onValueChange={(value) =>
                            updateStatusMutation.mutate({ invoiceId: invoice.id, newStatus: value })
                          }
                        >
                          <SelectTrigger className="w-[100px]">
                            <Badge variant={statusInfo?.variant}>{statusInfo?.label}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {invoiceStatuses.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {/* Edit button for invoices and quotations */}
                        {!isEditing && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditing(invoice)}
                            title="Edit TDS & Payment Details"
                            className="h-8 w-8"
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
                              onClick={() => savePaymentDetails(invoice)}
                              title="Save"
                              className="h-8 w-8"
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={cancelEditing}
                              title="Cancel"
                              className="h-8 w-8"
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        {/* Convert to Invoice for quotations */}
                        {isQuotation && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => convertToInvoiceMutation.mutate(invoice)}
                            title="Convert to Invoice"
                            className="h-8 w-8"
                          >
                            <ArrowRight className="h-4 w-4 text-primary" />
                          </Button>
                        )}
                        {invoice.file_url && (
                          <Button variant="ghost" size="icon" asChild title="Download" className="h-8 w-8">
                            <a href="#" onClick={(e) => { e.preventDefault(); openStoredFile(invoice.file_url, true); }}>
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteInvoiceMutation.mutate(invoice.id)}
                          title="Delete"
                          className="h-8 w-8"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Document Viewer Dialog */}
      <Dialog open={!!viewingFile} onOpenChange={(open) => !open && setViewingFile(null)}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              Document Viewer
            </DialogTitle>
          </DialogHeader>
          {viewingLink && (
            <iframe
              src={`https://docs.google.com/viewer?url=${encodeURIComponent(viewingLink)}&embedded=true`}
              className="w-full h-full rounded-md border"
              title="Document Viewer"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
