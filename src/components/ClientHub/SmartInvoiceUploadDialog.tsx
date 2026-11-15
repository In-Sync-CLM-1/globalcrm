import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signedFileUrl } from "@/lib/storedFiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { 
  Upload, Loader2, FileText, CheckCircle, AlertTriangle, 
  Building2, Plus, Sparkles, Save, Link2
} from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";

interface ExtractedData {
  client_company?: string;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  client_address?: string;
  client_gstin?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  amount?: number;
  tax_amount?: number;
  total_amount?: number;
  currency?: string;
  description?: string;
}

interface DuplicateMatch {
  id: string;
  type: 'client' | 'contact';
  first_name: string;
  last_name?: string;
  company?: string;
  email?: string;
  phone?: string;
  match_reason: string;
}

type Step = 'upload' | 'extracting' | 'review' | 'saving';
type AutoDecision = 'link_existing' | 'create_new';

interface SmartInvoiceUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SmartInvoiceUploadDialog({ open, onOpenChange }: SmartInvoiceUploadDialogProps) {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const notify = useNotification();

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);
  const [duplicateStatus, setDuplicateStatus] = useState<'none' | 'exact_match' | 'potential_match'>('none');
  
  // Auto-decision states
  const [autoDecision, setAutoDecision] = useState<AutoDecision>('create_new');
  const [selectedMatch, setSelectedMatch] = useState<DuplicateMatch | null>(null);
  const [overrideToCreateNew, setOverrideToCreateNew] = useState(false);

  // Editable form fields - all always editable for mandatory review
  const [clientName, setClientName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [notes, setNotes] = useState('');

  const resetDialog = () => {
    setStep('upload');
    setFile(null);
    setFileUrl('');
    setExtractedData(null);
    setDuplicateMatches([]);
    setDuplicateStatus('none');
    setAutoDecision('create_new');
    setSelectedMatch(null);
    setOverrideToCreateNew(false);
    setClientName('');
    setClientCompany('');
    setClientEmail('');
    setClientPhone('');
    setClientAddress('');
    setInvoiceNumber('');
    setInvoiceDate('');
    setDueDate('');
    setAmount('');
    setTaxAmount('');
    setCurrency('INR');
    setNotes('');
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const populateFormFields = (data: ExtractedData) => {
    setClientName(data.client_name || '');
    setClientCompany(data.client_company || '');
    setClientEmail(data.client_email || '');
    setClientPhone(data.client_phone || '');
    setClientAddress(data.client_address || '');
    setInvoiceNumber(data.invoice_number || '');
    setInvoiceDate(data.invoice_date || '');
    setDueDate(data.due_date || '');
    setAmount(data.amount?.toString() || '');
    setTaxAmount(data.tax_amount?.toString() || '');
    setCurrency(data.currency || 'INR');
    setNotes(data.description || '');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setStep('extracting');

    try {
      // Upload file to storage
      const fileExt = selectedFile.name.split('.').pop();
      const tempFileName = `${effectiveOrgId}/temp/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('client-documents')
        .upload(tempFileName, selectedFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('client-documents')
        .getPublicUrl(tempFileName);

      setFileUrl(urlData.publicUrl);

      // Extract data using AI
      const { data, error } = await supabase.functions.invoke('extract-invoice-client-data', {
        body: { fileUrl: await signedFileUrl(urlData.publicUrl, 600) }
      });

      if (error) throw error;

      if (data?.success && data.extractedData) {
        setExtractedData(data.extractedData);
        populateFormFields(data.extractedData);

        // Check for duplicates
        const { data: duplicateResult, error: dupError } = await supabase.functions.invoke('process-invoice-import', {
          body: {
            action: 'check_duplicates',
            extractedData: data.extractedData
          }
        });

        if (!dupError && duplicateResult?.matches) {
          setDuplicateMatches(duplicateResult.matches);
          setDuplicateStatus(duplicateResult.status || 'none');
          
          // Auto-decision logic
          if (duplicateResult.status === 'exact_match' && duplicateResult.matches.length > 0) {
            setAutoDecision('link_existing');
            setSelectedMatch(duplicateResult.matches[0]);
          } else if (duplicateResult.status === 'potential_match' && duplicateResult.matches.length > 0) {
            setAutoDecision('link_existing');
            setSelectedMatch(duplicateResult.matches[0]);
          } else {
            setAutoDecision('create_new');
            setSelectedMatch(null);
          }
        } else {
          setAutoDecision('create_new');
          setSelectedMatch(null);
        }

        setStep('review');
      } else {
        throw new Error(data?.error || 'Extraction failed');
      }
    } catch (error) {
      console.error('Extraction error:', error);
      notify.error('Extraction failed', 'Please try again or enter details manually');
      setStep('upload');
      setFile(null);
    }
  };

  // Determine final action based on auto-decision and override
  const getFinalAction = (): { action: 'link_existing' | 'create_new'; matchId?: string; matchType?: 'client' | 'contact' } => {
    if (overrideToCreateNew) {
      return { action: 'create_new' };
    }
    if (autoDecision === 'link_existing' && selectedMatch) {
      return { action: 'link_existing', matchId: selectedMatch.id, matchType: selectedMatch.type };
    }
    return { action: 'create_new' };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveOrgId) throw new Error('Organization not found');

      setStep('saving');

      const finalAction = getFinalAction();

      // Use fetch directly to properly handle non-2xx responses with body
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-invoice-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({
          action: 'auto_process_single',
          finalAction: finalAction.action,
          matchId: finalAction.matchId,
          matchType: finalAction.matchType,
          clientData: {
            name: clientName,
            company: clientCompany,
            email: clientEmail,
            phone: clientPhone,
            address: clientAddress
          },
          invoiceData: {
            invoice_number: invoiceNumber || `INV-${Date.now()}`,
            invoice_date: invoiceDate || new Date().toISOString().split('T')[0],
            due_date: dueDate || null,
            amount: parseFloat(amount) || 0,
            tax_amount: parseFloat(taxAmount) || 0,
            currency: currency,
            notes: notes || null,
            file_url: fileUrl || null
          }
        })
      });

      const data = await response.json();

      // Handle error response
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Failed to process invoice');
      }

      return data;
    },
    onSuccess: (result) => {
      const finalAction = getFinalAction();
      const message = finalAction.action === 'link_existing' 
        ? `Invoice linked to existing ${selectedMatch?.type || 'entity'}`
        : 'New client created and invoice added';
      
      notify.success('Success', message);
      queryClient.invalidateQueries({ queryKey: ['all-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      handleClose();
    },
    onError: (error: Error) => {
      if (error.message.includes('already exists')) {
        notify.error('Duplicate Invoice', error.message);
      } else {
        notify.error('Error', error.message);
      }
      setStep('review');
    }
  });

  // Check if required fields are filled
  const isFormValid = invoiceNumber.trim() && invoiceDate && (parseFloat(amount) > 0);

  // Get the action description for the save button
  const getActionDescription = () => {
    const finalAction = getFinalAction();
    if (finalAction.action === 'link_existing' && selectedMatch) {
      return `Link to ${selectedMatch.company || `${selectedMatch.first_name} ${selectedMatch.last_name || ''}`.trim()}`;
    }
    return 'Create new client';
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); else onOpenChange(true); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Smart Invoice Upload
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="invoice-upload"
                />
                <label htmlFor="invoice-upload" className="cursor-pointer">
                  <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium">Upload Invoice</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    PDF, PNG, or JPG - AI will extract company & invoice details automatically
                  </p>
                </label>
              </div>
            </div>
          )}

          {/* Extracting Step */}
          {step === 'extracting' && (
            <div className="py-12 text-center space-y-4">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
              <div>
                <p className="font-medium">Analyzing Invoice...</p>
                <p className="text-sm text-muted-foreground">
                  Extracting company information and matching existing records
                </p>
              </div>
              {file && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  {file.name}
                </div>
              )}
            </div>
          )}

          {/* Review Step - Mandatory Review with Auto-Decision */}
          {step === 'review' && (
            <div className="space-y-6 py-4">
              {/* Auto-Decision Banner */}
              {autoDecision === 'link_existing' && selectedMatch && !overrideToCreateNew ? (
                <Card className={duplicateStatus === 'exact_match' 
                  ? 'border-green-500 bg-green-50 dark:bg-green-950/20' 
                  : 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                }>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-full ${duplicateStatus === 'exact_match' ? 'bg-green-100 dark:bg-green-900' : 'bg-amber-100 dark:bg-amber-900'}`}>
                        {duplicateStatus === 'exact_match' 
                          ? <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                          : <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        }
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">
                            {duplicateStatus === 'exact_match' ? 'Matched to existing entity' : 'Potential match found'}
                          </h4>
                          <Badge variant={selectedMatch.type === 'client' ? 'default' : 'secondary'} className="text-xs">
                            {selectedMatch.type === 'client' ? 'Client' : 'Contact'}
                          </Badge>
                        </div>
                        <p className="text-sm mt-1">
                          <span className="font-medium">{selectedMatch.company || `${selectedMatch.first_name} ${selectedMatch.last_name || ''}`.trim()}</span>
                          {selectedMatch.email && <span className="text-muted-foreground"> • {selectedMatch.email}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <Link2 className="h-3 w-3 inline mr-1" />
                          {selectedMatch.match_reason}
                        </p>
                        
                        {/* Override option for potential matches */}
                        {duplicateStatus === 'potential_match' && (
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                            <Switch 
                              id="override-create-new"
                              checked={overrideToCreateNew}
                              onCheckedChange={setOverrideToCreateNew}
                            />
                            <Label htmlFor="override-create-new" className="text-sm cursor-pointer">
                              Create as new client instead
                            </Label>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900">
                        <Plus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h4 className="font-medium">New client will be created</h4>
                        <p className="text-sm text-muted-foreground">
                          Review and edit details below before saving
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Separator />

              {/* Mandatory Review Form - Always Editable */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-base font-medium">Review & Edit Details</Label>
                  <Badge variant="outline" className="text-xs">Mandatory</Badge>
                </div>

                {/* Client Information */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Company/Client Details</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Contact Name</Label>
                      <Input
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Enter contact name"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Company</Label>
                      <Input
                        value={clientCompany}
                        onChange={(e) => setClientCompany(e.target.value)}
                        placeholder="Enter company name"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Email</Label>
                      <Input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="Enter email"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Phone</Label>
                      <Input
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        placeholder="Enter phone number"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label className="text-xs">Address</Label>
                      <Textarea
                        value={clientAddress}
                        onChange={(e) => setClientAddress(e.target.value)}
                        placeholder="Enter address"
                        className="min-h-[60px] resize-none"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Invoice Information */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Invoice Details</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Invoice Number <span className="text-destructive">*</span></Label>
                      <Input
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        placeholder="Enter invoice number"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Currency</Label>
                      <Input
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        placeholder="INR"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Invoice Date <span className="text-destructive">*</span></Label>
                      <Input
                        type="date"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Due Date</Label>
                      <Input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Amount <span className="text-destructive">*</span></Label>
                      <Input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Tax Amount</Label>
                      <Input
                        type="number"
                        value={taxAmount}
                        onChange={(e) => setTaxAmount(e.target.value)}
                        placeholder="0.00"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label className="text-xs">Notes/Description</Label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add any notes"
                        className="min-h-[60px] resize-none"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Action Summary */}
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Save className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">On save:</span>
                    <span className="font-medium">{getActionDescription()}</span>
                    <span className="text-muted-foreground">→ Invoice #{invoiceNumber || 'Auto'}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Saving Step */}
          {step === 'saving' && (
            <div className="py-12 text-center space-y-4">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
              <div>
                <p className="font-medium">Saving...</p>
                <p className="text-sm text-muted-foreground">
                  {getFinalAction().action === 'link_existing' 
                    ? 'Linking invoice to existing entity' 
                    : 'Creating new client and saving invoice'
                  }
                </p>
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button 
                onClick={() => saveMutation.mutate()}
                disabled={!isFormValid}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Review & Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
