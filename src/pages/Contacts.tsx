import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/common/LoadingState";
import { useNotification } from "@/hooks/useNotification";
import { Plus, Pencil, Trash2, Mail, Phone as PhoneIcon, Download, Upload, Building, MessageSquare, Loader2 } from "lucide-react";
import { SendEmailDialog } from "@/components/Contact/SendEmailDialog";
import { SendWhatsAppDialog } from "@/components/Contact/SendWhatsAppDialog";
import { exportToCSV, formatDateForExport } from "@/utils/exportUtils";
import { useOrgContext } from "@/hooks/useOrgContext";
import { Checkbox } from "@/components/ui/checkbox";
import { usePagination } from "@/hooks/usePagination";
import PaginationControls from "@/components/common/PaginationControls";
import { BulkDeleteButton } from "@/components/common/BulkDeleteButton";
import { BulkUploadDialog } from "@/components/Contacts/BulkUpload/BulkUploadDialog";
import { UploadHistoryTable } from "@/components/Contacts/BulkUpload/UploadHistoryTable";
import { ActiveUploadProgress } from "@/components/Contacts/BulkUpload/ActiveUploadProgress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoDialer } from "@/components/Contact/AutoDialer";
import { ContactFilters, ContactFiltersState, emptyContactFilters } from "@/components/Contacts/ContactFilters";
import { useUrlFilterState } from "@/hooks/useUrlFilterState";
import { CreateContactDialog } from "@/components/Contact/CreateContactDialog";
import { UrlTabs } from "@/components/UrlTabs";
import { useGamingAccess } from "@/hooks/useGamingAccess";

interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  city: string | null;
  industry_type: string | null;
  nature_of_business: string | null;
  status: string;
  source: string | null;
  assigned_to: string | null;
  pipeline_stage_id: string | null;
  enrichment_status?: string | null;
  last_enriched_at?: string | null;
  pipeline_stages?: {
    name: string;
    color: string;
  } | null;
  created_at: string;
}

interface PipelineStage {
  id: string;
  name: string;
}

interface User {
  id: string;
  first_name: string;
  last_name: string;
}

export default function Contacts() {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const notify = useNotification();
  const navigate = useNavigate();
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const gaming = useGamingAccess();
  const [exporting, setExporting] = useState(false);
  const [callingContactId, setCallingContactId] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedContactForEmail, setSelectedContactForEmail] = useState<Contact | null>(null);
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  const [selectedContactForWhatsapp, setSelectedContactForWhatsapp] = useState<Contact | null>(null);
  
  // Use URL-based filter state for persistence across navigation
  const [appliedFilters, setAppliedFilters, clearUrlFilters] = useUrlFilterState<ContactFiltersState>(
    emptyContactFilters,
    "filter"
  );
  const [filters, setFilters] = useState<ContactFiltersState>(appliedFilters);
  const [isSearching, setIsSearching] = useState(false);
  
  // Sync local filters with URL filters when URL changes (e.g., back button)
  useEffect(() => {
    setFilters(appliedFilters);
  }, [appliedFilters]);
  
  const pagination = usePagination({ defaultPageSize: 25 });

  // Fetch contacts with React Query
  const { data: contactsData, isLoading: contactsLoading } = useQuery({
    queryKey: ['contacts', effectiveOrgId, pagination.currentPage, pagination.pageSize, appliedFilters],
    queryFn: async () => {
      const offset = (pagination.currentPage - 1) * pagination.pageSize;
      
      let query = supabase
        .from("contacts")
        .select(`
          *,
          pipeline_stages (
            name,
            color
          )
        `, { count: 'exact' })
        .eq("org_id", effectiveOrgId);

      // Apply filters
      if (appliedFilters.name) {
        query = query.or(`first_name.ilike.%${appliedFilters.name}%,last_name.ilike.%${appliedFilters.name}%`);
      }
      if (appliedFilters.email) {
        query = query.ilike("email", `%${appliedFilters.email}%`);
      }
      if (appliedFilters.phone) {
        query = query.ilike("phone", `%${appliedFilters.phone}%`);
      }
      if (appliedFilters.company) {
        query = query.ilike("company", `%${appliedFilters.company}%`);
      }
      if (appliedFilters.city) {
        query = query.ilike("city", `%${appliedFilters.city}%`);
      }
      if (appliedFilters.source) {
        query = query.ilike("source", `%${appliedFilters.source}%`);
      }
      if (appliedFilters.status) {
        query = query.eq("status", appliedFilters.status);
      }
      if (appliedFilters.stageId) {
        query = query.eq("pipeline_stage_id", appliedFilters.stageId);
      }
      if (appliedFilters.industryType) {
        query = query.eq("industry_type", appliedFilters.industryType);
      }
      if (appliedFilters.jobTitle) {
        query = query.ilike("job_title", `%${appliedFilters.jobTitle}%`);
      }
      if (appliedFilters.createdBy) {
        query = query.eq("created_by", appliedFilters.createdBy);
      }

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + pagination.pageSize - 1);

      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch total count (unfiltered) for display
  const { data: totalCountData } = useQuery({
    queryKey: ['contacts-total-count', effectiveOrgId],
    queryFn: async () => {
      const { count } = await supabase
        .from("contacts")
        .select("*", { count: 'exact', head: true })
        .eq("org_id", effectiveOrgId);
      return count || 0;
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch pipeline stages with React Query
  const { data: pipelineStages = [] } = useQuery({
    queryKey: ['pipeline-stages', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("org_id", effectiveOrgId)
        .eq("is_active", true)
        .order("stage_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch users with React Query
  const { data: users = [] } = useQuery({
    queryKey: ['contacts-users', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .eq("org_id", effectiveOrgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  // Derive contacts from query data
  const contacts = contactsData?.data || [];
  const loading = contactsLoading;
  const unfilteredCount = totalCountData || 0;

  // Update pagination total when data changes
  useEffect(() => {
    if (contactsData) {
      pagination.setTotalRecords(contactsData.count);
    }
  }, [contactsData?.count]);

  // Listen for org context changes
  useEffect(() => {
    const handleOrgChange = () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stages'] });
      queryClient.invalidateQueries({ queryKey: ['contacts-users'] });
    };

    window.addEventListener("orgContextChange", handleOrgChange);
    return () => window.removeEventListener("orgContextChange", handleOrgChange);
  }, [queryClient]);

  const handleFilterSearch = () => {
    setIsSearching(true);
    pagination.reset();
    setAppliedFilters(filters); // This updates URL params
    setIsSearching(false);
  };

  const handleFilterClear = () => {
    const empty = emptyContactFilters;
    setFilters(empty);
    clearUrlFilters(); // Clears URL params
    pagination.reset();
  };

  const handleContactCreated = () => {
    pagination.reset();
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  const handleCall = async (contact: Contact, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (!contact.phone) {
      notify.error("No phone number", "This contact doesn't have a phone number");
      return;
    }

    setCallingContactId(contact.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single();

      if (!profile?.phone) {
        notify.error("Phone number required", "Please add your phone number in profile settings");
        return;
      }

      const { error } = await supabase.functions.invoke('exotel-make-call', {
        body: {
          contactId: contact.id,
          agentPhoneNumber: profile.phone,
          customerPhoneNumber: contact.phone,
        },
      });

      if (error) throw error;

      notify.success("Call initiated", `Calling ${contact.first_name} ${contact.last_name || ''}`);
    } catch (error: any) {
      notify.error("Call failed", error.message || error);
    } finally {
      setCallingContactId(null);
    }
  };

  const handleEmailClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedContactForEmail(contact);
    setEmailDialogOpen(true);
  };

  const handleWhatsAppClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedContactForWhatsapp(contact);
    setWhatsappDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;

    try {
      const { data, error } = await supabase
        .from("contacts")
        .delete()
        .eq("id", id)
        .select();

      if (error) throw error;

      // Check if any row was actually deleted (RLS may silently block)
      if (!data || data.length === 0) {
        notify.error("Delete failed", "You don't have permission to delete this contact");
        return;
      }

      notify.success("Contact deleted", "Contact has been removed successfully");
      
      // Remove from selection without resetting filters
      setSelectedContacts(prev => prev.filter(cid => cid !== id));
      
      // Refetch contacts with current filters preserved
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    } catch (error: any) {
      notify.error("Error deleting contact", error);
    }
  };

  const toggleContactSelection = (contactId: string) => {
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const toggleAllSelection = () => {
    if (selectedContacts.length === contacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(contacts.map(c => c.id));
    }
  };


  const downloadTemplate = () => {
    const template = `first_name,last_name,email,phone,company,job_title,status,source
John,Doe,john.doe@example.com,+1234567890,Acme Corp,Sales Manager,new,Website
Jane,Smith,jane.smith@example.com,+0987654321,Tech Inc,CEO,contacted,Referral`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    notify.info("Template Downloaded", "Use this template to format your contacts CSV file.");
  };

  const handleCSVUpload = async (parsedData: any[]) => {
    // LIMIT: Check count already validated by useBulkUpload
    if (parsedData.length > 10000) {
      throw new Error(`Maximum 10,000 contacts allowed per import. Your file contains ${parsedData.length} rows.`);
    }

    // Validate required first_name field
    const missingFirstName = parsedData.filter(row => !row.first_name || row.first_name.trim() === '');
    if (missingFirstName.length > 0) {
      throw new Error(`${missingFirstName.length} row(s) are missing required 'first_name' field. Please ensure all contacts have a first name.`);
    }

    // Map CSV data to contact format
    const contactsToInsert = parsedData.map(row => ({
      first_name: row.first_name.trim(),
      last_name: row.last_name || null,
      email: row.email || null,
      phone: row.phone || null,
      company: row.company || null,
      job_title: row.job_title || row.title || null,
      status: row.status || 'new',
      source: row.source || 'csv_import',
    }));

    // PERFORMANCE: Use queue manager for batch processing with rate limiting
    const { data, error } = await supabase.functions.invoke('queue-manager', {
      body: {
        operation: 'contact_import',
        data: contactsToInsert,
        priority: 5,
      },
    });

    if (error) {
      if (error.message?.includes('Rate limit')) {
        throw new Error("Please wait a minute before importing more contacts.");
      } else if (error.message?.includes('Item limit exceeded')) {
        throw error;
      } else {
        throw error;
      }
    }

    pagination.reset();
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      new: "bg-blue-500",
      contacted: "bg-yellow-500",
      qualified: "bg-green-500",
      converted: "bg-purple-500",
      lost: "bg-red-500",
    };
    return colors[status] || "bg-gray-500";
  };

  const handleExport = async () => {
    if (!effectiveOrgId) return;
    
    setExporting(true);
    try {
      let dataToExport: Contact[] = [];
      
      if (selectedContacts.length > 0) {
        dataToExport = contacts.filter(c => selectedContacts.includes(c.id));
      } else {
        // Fetch all contacts in batches of 500
        const batchSize = 500;
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
          const { data, error } = await supabase
            .from("contacts")
            .select(`*, pipeline_stages (name, color)`)
            .eq("org_id", effectiveOrgId)
            .order("created_at", { ascending: false })
            .range(offset, offset + batchSize - 1);
          
          if (error) throw error;
          
          if (data && data.length > 0) {
            dataToExport = [...dataToExport, ...data];
            offset += batchSize;
            hasMore = data.length === batchSize;
          } else {
            hasMore = false;
          }
        }
      }

      if (dataToExport.length === 0) {
        notify.info("No Data", "No contacts to export");
        return;
      }

      const columns = [
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'company', label: 'Company' },
        { key: 'job_title', label: 'Job Title' },
        { key: 'status', label: 'Status' },
        { key: 'source', label: 'Source' },
        { key: 'pipeline_stages', label: 'Pipeline Stage', format: (val: any) => val?.name || '' },
        { key: 'enrichment_status', label: 'Enrichment Status' },
        { key: 'created_at', label: 'Created At', format: formatDateForExport },
      ];
      
      const filename = `contacts_export_${new Date().toISOString().split('T')[0]}`;
      exportToCSV(dataToExport, columns, filename);
      notify.success("Export Complete", `${dataToExport.length} contacts exported`);
    } catch (error: any) {
      notify.error("Export Failed", error);
    } finally {
      setExporting(false);
    }
  };

  if (loading && contacts.length === 0) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading contacts..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <UrlTabs param="tab" defaultValue="all" className="space-y-4">
        {/* Mobile-first header with responsive layout */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">Contact Management</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">Manage your leads and contacts</p>
            </div>
            <TabsList className="w-fit">
              <TabsTrigger value="all" className="text-xs sm:text-sm">All Contacts</TabsTrigger>
              {gaming.canUpload && <TabsTrigger value="uploads" className="text-xs sm:text-sm">Uploads</TabsTrigger>}
            </TabsList>
          </div>
          <div className="flex gap-2">
            {gaming.canExport && (
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="flex-1 sm:flex-none">
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{exporting ? "Exporting..." : selectedContacts.length > 0 ? `Download (${selectedContacts.length})` : "Download All"}</span>
              </Button>
            )}
            {gaming.canUpload && (
              <Button size="sm" onClick={() => setShowBulkUpload(true)} className="flex-1 sm:flex-none">
                <Upload className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Bulk Upload</span>
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="all" className="space-y-6">
          {effectiveOrgId && <ActiveUploadProgress orgId={effectiveOrgId} />}
          
          <ContactFilters
            filters={filters}
            stages={pipelineStages}
            users={users}
            onFiltersChange={setFilters}
            onSearch={handleFilterSearch}
            onClear={handleFilterClear}
            isSearching={isSearching}
            resultCount={pagination.totalRecords}
            totalCount={unfilteredCount}
          />
          
          <div className="space-y-6">
            <div className="flex gap-2">
              {selectedContacts.length > 0 && (
                <>
                  <BulkDeleteButton
                    selectedIds={selectedContacts}
                    tableName="contacts"
                    onSuccess={() => {
                      setSelectedContacts([]);
                      queryClient.invalidateQueries({ queryKey: ['contacts'] });
                    }}
                  />
                  <AutoDialer preSelectedContacts={selectedContacts} />
                </>
              )}
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Contact
              </Button>
              <CreateContactDialog
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
                onContactCreated={handleContactCreated}
              />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Contacts ({contacts.length})</CardTitle>
            <CardDescription>All your leads and contacts</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading...</div>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 py-2 sticky left-0 bg-card z-10">
                        <Checkbox 
                          checked={selectedContacts.length === contacts.length && contacts.length > 0}
                          onCheckedChange={toggleAllSelection}
                        />
                      </TableHead>
                      <TableHead className="py-2 text-xs">Name</TableHead>
                      <TableHead className="py-2 text-xs">Quick Actions</TableHead>
                      <TableHead className="py-2 text-xs hidden md:table-cell">Company</TableHead>
                      <TableHead className="py-2 text-xs hidden lg:table-cell">Contact Info</TableHead>
                      <TableHead className="py-2 text-xs">Stage</TableHead>
                      <TableHead className="py-2 text-xs hidden xl:table-cell">Enrichment</TableHead>
                      <TableHead className="py-2 text-xs text-right sticky right-0 bg-card z-10">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((contact) => (
                      <TableRow key={contact.id} className="touch-action-pan-y">
                        <TableCell className="py-1.5 sticky left-0 bg-card z-10">
                          <Checkbox 
                            checked={selectedContacts.includes(contact.id)}
                            onCheckedChange={() => toggleContactSelection(contact.id)}
                          />
                        </TableCell>
                        <TableCell className="py-1.5 font-medium">
                          <div className="flex flex-col">
                            <span className="truncate max-w-[120px] sm:max-w-none">
                              {contact.first_name} {contact.last_name}
                            </span>
                            {contact.job_title && (
                              <span className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-none">{contact.job_title}</span>
                            )}
                            {/* Show company on mobile within name cell */}
                            {contact.company && (
                              <span className="text-xs text-muted-foreground md:hidden flex items-center gap-1">
                                <Building className="h-3 w-3 shrink-0" />
                                <span className="truncate">{contact.company}</span>
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="default"
                              className="h-8 w-8 bg-green-600 hover:bg-green-700 text-white"
                              disabled={callingContactId === contact.id || !contact.phone}
                              onClick={(e) => handleCall(contact, e)}
                              title="Call"
                            >
                              {callingContactId === contact.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <PhoneIcon className="h-4 w-4" />
                              )}
                            </Button>
                            {gaming.whatsapp && (
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                disabled={!contact.phone}
                                onClick={(e) => handleWhatsAppClick(contact, e)}
                                title="Send WhatsApp"
                              >
                                <MessageSquare className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              disabled={!contact.email}
                              onClick={(e) => handleEmailClick(contact, e)}
                              title="Send Email"
                            >
                              <Mail className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="py-1.5 hidden md:table-cell">
                          {contact.company && (
                            <div className="flex items-center gap-1 text-xs">
                              <Building className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[150px]">{contact.company}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 hidden lg:table-cell">
                          <div className="flex flex-col gap-0.5 text-xs">
                            {contact.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3 shrink-0" />
                                <span className="truncate max-w-[180px]">{gaming.email(contact.email)}</span>
                              </span>
                            )}
                            {contact.phone && (
                              <span className="flex items-center gap-1">
                                <PhoneIcon className="h-3 w-3 shrink-0" />
                                {gaming.phone(contact.phone)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-1.5">
                          {contact.pipeline_stages && (
                            <Badge 
                              className="text-[10px] sm:text-xs whitespace-nowrap"
                              style={{ 
                                backgroundColor: contact.pipeline_stages.color || '#8AD4EB',
                                color: '#fff'
                              }}
                            >
                              {contact.pipeline_stages.name}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 hidden xl:table-cell">
                          {contact.enrichment_status === 'enriched' && (
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-800 border-green-300">
                              ✓ Enriched
                            </Badge>
                          )}
                          {contact.enrichment_status === 'failed' && (
                            <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-300">
                              ✗ Failed
                            </Badge>
                          )}
                          {contact.enrichment_status === 'pending' && (
                            <Badge variant="outline" className="text-xs bg-yellow-100 text-yellow-800 border-yellow-300">
                              ⏳ Pending
                            </Badge>
                          )}
                          {!contact.enrichment_status && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-right sticky right-0 bg-card z-10">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 touch-target"
                              onClick={() => navigate(`/contacts/${contact.id}`)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 touch-target"
                              onClick={() => handleDelete(contact.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            </CardContent>
            
            <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              totalRecords={pagination.totalRecords}
              startRecord={pagination.startRecord}
              endRecord={pagination.endRecord}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              disabled={loading}
            />
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="uploads" className="space-y-4">
        {effectiveOrgId && (
          <>
            <ActiveUploadProgress orgId={effectiveOrgId} />
            <div>
              <h3 className="text-lg font-semibold mb-4">Recent Uploads</h3>
              <UploadHistoryTable orgId={effectiveOrgId} />
            </div>
          </>
        )}
      </TabsContent>
    </UrlTabs>

    {effectiveOrgId && (
      <BulkUploadDialog
        open={showBulkUpload}
        onOpenChange={setShowBulkUpload}
        orgId={effectiveOrgId}
        onUploadStarted={() => {
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
        }}
      />
    )}

    {selectedContactForEmail && (
      <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        contactId={selectedContactForEmail.id}
        contactName={`${selectedContactForEmail.first_name} ${selectedContactForEmail.last_name || ''}`.trim()}
      />
    )}

    {selectedContactForWhatsapp && selectedContactForWhatsapp.phone && (
      <SendWhatsAppDialog
        open={whatsappDialogOpen}
        onOpenChange={setWhatsappDialogOpen}
        contactId={selectedContactForWhatsapp.id}
        contactName={`${selectedContactForWhatsapp.first_name} ${selectedContactForWhatsapp.last_name || ''}`.trim()}
        phoneNumber={selectedContactForWhatsapp.phone}
      />
    )}
  </DashboardLayout>
  );
}
