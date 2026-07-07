import { useState, useEffect, useMemo, useCallback } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/common/LoadingState";
import { useNotification } from "@/hooks/useNotification";
import { Mail, Phone as PhoneIcon, Building, LayoutGrid, Table as TableIcon, Loader2, Phone, MapPin, Factory, MessageSquare, MoreHorizontal, Pencil, Trash2, UserPlus, MessageCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePagination } from "@/hooks/usePagination";
import PaginationControls from "@/components/common/PaginationControls";
import { ConvertToClientButton } from "@/components/Clients/ConvertToClientButton";
import { useOrgContext } from "@/hooks/useOrgContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PipelineFilters, PipelineFiltersState, emptyFilters } from "@/components/Pipeline/PipelineFilters";
import { SendEmailDialog } from "@/components/Contact/SendEmailDialog";
import { SendWhatsAppDialog } from "@/components/Contact/SendWhatsAppDialog";
import { EditContactDialog } from "@/components/Contact/EditContactDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { UserSelector } from "@/components/common/UserSelector";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuickDial } from "@/components/Contact/QuickDial";
import { CreateContactDialog } from "@/components/Contact/CreateContactDialog";
import { useUrlFilterState } from "@/hooks/useUrlFilterState";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkCallDialog } from "@/components/Pipeline/BulkCallDialog";
import { PostCallDispositionDialog } from "@/components/Contact/PostCallDispositionDialog";
import IedupPipeline from "@/pages/IedupPipeline";
import { IEDUP_ORG_ID } from "@/hooks/useIsIedup";
interface PipelineStage {
  id: string;
  name: string;
  color: string;
  stage_order: number;
  probability: number;
}

interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  pipeline_stage_id: string | null;
  job_title?: string | null;
  source?: string | null;
  status?: string | null;
  notes?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  updated_at?: string | null;
  industry_type?: string | null;
  nature_of_business?: string | null;
  created_by?: string | null;
  assigned_to?: string | null;
  product?: string | null;
  whatsapp_outreach_status?: string | null;
  primaryPhone?: string | null;
}

interface User {
  id: string;
  first_name: string;
  last_name: string;
}

// Org ID that should see enhanced pipeline fields
const ENHANCED_PIPELINE_ORG_ID = 'bfdb6856-6756-40d6-9e43-8a60f878bc0c';

const EMAIL_OUTREACH_STATUS_STYLE: Record<string, { label: string; className: string }> = {
  clicked: { label: 'Clicked', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  opened: { label: 'Opened', className: 'bg-sky-600 hover:bg-sky-600 text-white' },
  'delivered-no-open': { label: 'Delivered', className: 'bg-amber-500 hover:bg-amber-500 text-white' },
  'sent-pending': { label: 'Sent', className: 'bg-slate-500 hover:bg-slate-500 text-white' },
  queued: { label: 'Queued', className: 'bg-slate-200 hover:bg-slate-200 text-slate-600' },
  skipped: { label: 'Skipped', className: 'bg-slate-300 hover:bg-slate-300 text-slate-700' },
  bounced: { label: 'Bounced', className: 'bg-red-600 hover:bg-red-600 text-white' },
  failed: { label: 'Failed', className: 'bg-red-600 hover:bg-red-600 text-white' },
};

const WHATSAPP_OUTREACH_STATUS_STYLE: Record<string, { label: string; className: string }> = {
  delivered: { label: 'Delivered', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  sent: { label: 'Sent', className: 'bg-amber-500 hover:bg-amber-500 text-white' },
  failed: { label: 'Failed', className: 'bg-red-600 hover:bg-red-600 text-white' },
  skipped: { label: 'Skipped', className: 'bg-slate-300 hover:bg-slate-300 text-slate-700' },
  'not-attempted': { label: 'Not Attempted', className: 'bg-slate-200 hover:bg-slate-200 text-slate-600' },
};

const DISPOSITION_CATEGORY_STYLE: Record<string, string> = {
  positive: 'bg-emerald-600 hover:bg-emerald-600 text-white',
  negative: 'bg-red-600 hover:bg-red-600 text-white',
  follow_up: 'bg-sky-600 hover:bg-sky-600 text-white',
  neutral: 'bg-slate-400 hover:bg-slate-400 text-white',
  default: 'bg-slate-300 hover:bg-slate-300 text-slate-700',
};

function parseEmailOutreach(source: string | null | undefined): { campaign: string; status: string } | null {
  if (!source) return null;
  const idx = source.indexOf('-');
  if (idx <= 0 || idx === source.length - 1) return null;
  const campaign = source.slice(0, idx);
  const status = source.slice(idx + 1).toLowerCase();
  if (!EMAIL_OUTREACH_STATUS_STYLE[status]) return null;
  return { campaign, status };
}

export default function PipelineBoard() {
  // IEDUP-only minimal pipeline view (CSV upload + dialer controls + beneficiary list)
  const { effectiveOrgId: pipelineOrgId } = useOrgContext();
  if (pipelineOrgId === IEDUP_ORG_ID) {
    return <IedupPipeline />;
  }

  const [filteredContacts, setFilteredContacts] = useState<Contact[] | null>(null);
  const [draggedContact, setDraggedContact] = useState<string | null>(null);
  // Board perf: render a capped number of cards per column, expandable on demand,
  // so a stage with hundreds of contacts doesn't paint hundreds of DOM cards at once.
  const STAGE_CARD_PAGE = 25;
  const [stageCardLimits, setStageCardLimits] = useState<Record<string, number>>({});
  
  // Use URL-based filter state for persistence across navigation
  const [urlFilters, setUrlFilters, clearUrlFilters] = useUrlFilterState<PipelineFiltersState>(
    emptyFilters,
    "pf"
  );
  const [filters, setFilters] = useState<PipelineFiltersState>(urlFilters);
  const [isSearching, setIsSearching] = useState(false);
  
  // Sync local filters with URL filters when URL changes (e.g., back button)
  useEffect(() => {
    setFilters(urlFilters);
    // Don't manipulate filteredContacts here - let the auto-apply effect handle it
  }, [urlFilters]);
  const [activeTab, setActiveTab] = useState("table");
  const [callingContactId, setCallingContactId] = useState<string | null>(null);

  // Post-call disposition flow (for calls dialed from the pipeline table)
  const [pendingCallSid, setPendingCallSid] = useState<string | null>(null);
  const [pendingCallContactId, setPendingCallContactId] = useState<string | null>(null);
  const [dispositionCallLogId, setDispositionCallLogId] = useState<string | null>(null);
  const [dispositionCallDuration, setDispositionCallDuration] = useState<number>(0);
  const [showDispositionDialog, setShowDispositionDialog] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedContactForEmail, setSelectedContactForEmail] = useState<Contact | null>(null);
  
  // WhatsApp dialog state
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  const [selectedContactForWhatsapp, setSelectedContactForWhatsapp] = useState<Contact | null>(null);
  
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedContactForEdit, setSelectedContactForEdit] = useState<Contact | null>(null);
  
  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedContactForDelete, setSelectedContactForDelete] = useState<Contact | null>(null);
  
  // Assign dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedContactForAssign, setSelectedContactForAssign] = useState<Contact | null>(null);
  const [assignToUserId, setAssignToUserId] = useState("");
  
  // Create contact dialog state
  const [createContactDialogOpen, setCreateContactDialogOpen] = useState(false);

  // Bulk multi-select state (table view)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCallOpen, setBulkCallOpen] = useState(false);
  const [bulkCallContacts, setBulkCallContacts] = useState<Contact[]>([]);
  const [openingBulkCall, setOpeningBulkCall] = useState(false);

  // Bulk assign state
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignToUserId, setBulkAssignToUserId] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);

  // Bulk delete state
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const notify = useNotification();
  const navigate = useNavigate();
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  
  const tablePagination = usePagination({ defaultPageSize: 100 });

  const { data: stagesData } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("is_active", true)
        .order("stage_order");
      if (error) throw error;
      return data as PipelineStage[];
    },
  });

  // Fetch contact IDs that have been converted to clients
  const { data: clientContactIds } = useQuery({
    queryKey: ['client-contact-ids', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("contact_id");
      if (error) throw error;
      return data.map(c => c.contact_id);
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch users for Created By filter - only system users with roles in the org
  const { data: usersData } = useQuery({
    queryKey: ['pipeline-users', effectiveOrgId],
    queryFn: async () => {
      // First get user IDs that have roles in this org
      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("org_id", effectiveOrgId)
        .eq("is_active", true);
      
      if (roleError) throw roleError;
      
      if (!roleData || roleData.length === 0) {
        return [] as User[];
      }
      
      const userIds = roleData.map(r => r.user_id);
      
      // Then fetch profiles for those users
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", userIds)
        .order("first_name");
      
      if (error) throw error;
      return data as User[];
    },
    enabled: !!effectiveOrgId,
  });

  const applyServerFilters = useCallback((q: any, f: PipelineFiltersState) => {
    const exact = f.matchMode === "exact";
    if (f.name) {
      if (exact) {
        const [firstWord, ...rest] = f.name.trim().split(/\s+/);
        if (rest.length > 0) {
          q = q.ilike("first_name", firstWord).ilike("last_name", rest.join(" "));
        } else {
          q = q.or(`first_name.ilike.${firstWord},last_name.ilike.${firstWord}`);
        }
      } else {
        q = q.or(`first_name.ilike.%${f.name}%,last_name.ilike.%${f.name}%`);
      }
    }
    if (f.company) q = q.ilike("company", exact ? f.company : `%${f.company}%`);
    if (f.stageId) q = q.eq("pipeline_stage_id", f.stageId);
    if (f.product) q = q.ilike("product", exact ? f.product : `%${f.product}%`);
    if (f.emailOutreachStatus) q = q.ilike("source", `%-${f.emailOutreachStatus}`);
    if (f.whatsappOutreachStatus) q = q.eq("whatsapp_outreach_status", f.whatsappOutreachStatus);
    if (f.assignedTo === "unassigned") q = q.is("assigned_to", null);
    else if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
    return q;
  }, []);

  // Dispositions list for the filter dropdown
  const { data: dispositionsList } = useQuery({
    queryKey: ['pipeline-dispositions', effectiveOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_dispositions")
        .select("id, name, category")
        .eq("org_id", effectiveOrgId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; category: string | null }[];
    },
    enabled: !!effectiveOrgId,
  });

  // Pre-fetch contact_ids whose LATEST disposition matches the filter (when set).
  // We need this before the main contacts query so we can scope its IN clause.
  const dispositionFilterId = urlFilters.dispositionId;
  const { data: dispositionFilterIds } = useQuery({
    queryKey: ['pipeline-disposition-filter-ids', effectiveOrgId, dispositionFilterId],
    queryFn: async () => {
      if (!dispositionFilterId) return null;
      if (dispositionFilterId === 'none') {
        const { data, error } = await supabase
          .from("contact_latest_disposition")
          .select("contact_id")
          .eq("org_id", effectiveOrgId);
        if (error) throw error;
        // Return contacts WITHOUT any disposition: caller will negate this set.
        return { mode: 'exclude' as const, ids: (data || []).map(r => r.contact_id) };
      }
      const { data, error } = await supabase
        .from("contact_latest_disposition")
        .select("contact_id")
        .eq("org_id", effectiveOrgId)
        .eq("disposition_id", dispositionFilterId);
      if (error) throw error;
      return { mode: 'include' as const, ids: (data || []).map(r => r.contact_id) };
    },
    enabled: !!effectiveOrgId && !!dispositionFilterId,
  });

  const dispositionFilterReady = !dispositionFilterId || dispositionFilterIds !== undefined;
  const { data: contactsData } = useQuery({
    queryKey: ['pipeline-contacts', effectiveOrgId, activeTab, tablePagination.currentPage, tablePagination.pageSize, urlFilters, dispositionFilterIds?.mode, dispositionFilterIds?.ids?.length],
    queryFn: async () => {
      if (activeTab === "board") {
        // Board view: load all contacts (client-side filtering for board)
        const query = supabase
          .from("contacts")
          .select("id, first_name, last_name, email, phone, company, pipeline_stage_id, job_title, source, status, notes, website, address, city, state, country, created_at, updated_at, industry_type, nature_of_business, created_by, assigned_to, product, whatsapp_outreach_status")
          .order("updated_at", { ascending: false })
          .limit(500);

        const { data, error } = await query;
        if (error) throw error;
        return { data: data as Contact[], count: data?.length || 0 };
      } else {
        // Table view: server-side pagination + server-side filtering
        const offset = (tablePagination.currentPage - 1) * tablePagination.pageSize;
        let query: any = supabase
          .from("contacts")
          .select("id, first_name, last_name, email, phone, company, pipeline_stage_id, job_title, source, status, notes, website, address, city, state, country, created_at, updated_at, industry_type, nature_of_business, created_by, assigned_to, product, whatsapp_outreach_status", { count: 'exact' })
          .order("updated_at", { ascending: false });
        query = applyServerFilters(query, urlFilters);

        // Latest-disposition filter: applied via pre-fetched contact_ids.
        if (dispositionFilterIds) {
          const ids = dispositionFilterIds.ids;
          if (dispositionFilterIds.mode === 'include') {
            if (ids.length === 0) return { data: [] as Contact[], count: 0 };
            query = query.in("id", ids);
          } else {
            // mode === 'exclude' (contacts WITHOUT any disposition yet)
            if (ids.length > 0) {
              query = query.not("id", "in", `(${ids.join(',')})`);
            }
          }
        }

        const { data, error, count } = await query.range(offset, offset + tablePagination.pageSize - 1);
        if (error) throw error;
        return { data: data as Contact[], count: count || 0 };
      }
    },
    enabled: !!effectiveOrgId && dispositionFilterReady,
    // Keep showing the previous page/tab's data while the next loads, so
    // switching pages or board/table doesn't blank-flash and refetch from empty.
    placeholderData: keepPreviousData,
  });

  // Latest disposition per visible contact (for the table column)
  const { data: latestDispositionsByContact } = useQuery({
    queryKey: ['pipeline-latest-dispositions', contactsData?.data?.map(c => c.id)],
    queryFn: async () => {
      if (!contactsData?.data?.length) return {} as Record<string, { name: string; category: string | null }>;
      const ids = contactsData.data.map(c => c.id);
      const { data, error } = await supabase
        .from("contact_latest_disposition")
        .select("contact_id, disposition_name, disposition_category")
        .in("contact_id", ids);
      if (error) throw error;
      const map: Record<string, { name: string; category: string | null }> = {};
      (data || []).forEach((r: any) => {
        map[r.contact_id] = { name: r.disposition_name, category: r.disposition_category };
      });
      return map;
    },
    enabled: !!contactsData?.data?.length,
  });

  // Fetch primary phones for all contacts
  const { data: primaryPhonesData } = useQuery({
    queryKey: ['contact-primary-phones', contactsData?.data?.map(c => c.id)],
    queryFn: async () => {
      if (!contactsData?.data?.length) return {};
      const contactIds = contactsData.data.map(c => c.id);
      const { data, error } = await supabase
        .from("contact_phones")
        .select("contact_id, phone")
        .in("contact_id", contactIds)
        .eq("is_primary", true);
      if (error) throw error;
      // Create a map of contact_id -> primary phone
      const phoneMap: Record<string, string> = {};
      data?.forEach(p => {
        phoneMap[p.contact_id] = p.phone;
      });
      return phoneMap;
    },
    enabled: !!contactsData?.data?.length,
  });

  // Memoize contacts excluding those converted to clients, with primary phones attached
  const baseContacts = useMemo(() => {
    if (!contactsData?.data) return [];
    const excludeIds = new Set(clientContactIds || []);
    return contactsData.data
      .filter(c => !excludeIds.has(c.id))
      .map(c => ({
        ...c,
        primaryPhone: primaryPhonesData?.[c.id] || null,
      }));
  }, [contactsData?.data, clientContactIds, primaryPhonesData]);

  // Update pagination when data changes
  useEffect(() => {
    if (contactsData && activeTab === "table") {
      tablePagination.setTotalRecords(contactsData.count);
    }
  }, [contactsData?.count, activeTab]);

  // Derive contacts: table view uses server-filtered baseContacts directly;
  // board view falls back to client-side filteredContacts (which only filters loaded rows)
  const contacts = activeTab === "table" ? baseContacts : (filteredContacts ?? baseContacts);

  const stages = stagesData || [];
  const loading = !stagesData || !contactsData;
  const showEnhancedFields = effectiveOrgId === ENHANCED_PIPELINE_ORG_ID;

  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    (usersData ?? []).forEach((u) => {
      m.set(u.id, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'User');
    });
    return m;
  }, [usersData]);

  const handleDragStart = (contactId: string) => {
    setDraggedContact(contactId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (stageId: string) => {
    if (!draggedContact) return;

    try {
      const { error } = await supabase
        .from("contacts")
        .update({ pipeline_stage_id: stageId })
        .eq("id", draggedContact);

      if (error) throw error;

      // Invalidate query to refresh data
      queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });

      notify.success("Contact moved", "Contact has been moved to new stage");
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setDraggedContact(null);
    }
  };

  const getContactsInStage = (stageId: string) => {
    return contacts.filter(contact => contact.pipeline_stage_id === stageId);
  };

  const getContactsWithoutStage = () => {
    return contacts.filter(contact => !contact.pipeline_stage_id);
  };

  const handleCall = async (contact: Contact, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    // Use primary phone from contact_phones table, fallback to contact.phone
    const phoneToCall = contact.primaryPhone || contact.phone;

    if (!phoneToCall) {
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

      const { data, error } = await supabase.functions.invoke('exotel-make-call', {
        body: {
          contactId: contact.id,
          agentPhoneNumber: profile.phone,
          customerPhoneNumber: phoneToCall,
        },
      });

      if (error) throw error;

      // Track this call so the post-call disposition dialog fires when it ends
      setPendingCallSid(data?.exotelCallSid || null);
      setPendingCallContactId(contact.id);
      setDispositionCallLogId(data?.callLog?.id || null);

      notify.success("Call initiated", `Calling ${contact.first_name} ${contact.last_name || ''}`);
    } catch (error: any) {
      notify.error("Call failed", error.message);
    } finally {
      setCallingContactId(null);
    }
  };

  // Listen for end of any call initiated from the pipeline table and open
  // the post-call disposition dialog (matches the ClickToCall behavior on
  // the contact-detail page).
  useEffect(() => {
    if (!pendingCallSid) return;

    const channel = supabase
      .channel(`pipeline-call-session-${pendingCallSid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_call_sessions',
        },
        async (payload) => {
          const row: any = payload.new;
          if (!row || row.exotel_call_sid !== pendingCallSid) return;
          if (row.status !== 'ended') return;

          // Resolve the call_log + duration before opening the dialog
          let callLogId = dispositionCallLogId;
          let duration = 0;
          const { data: cl } = await supabase
            .from('call_logs')
            .select('id, conversation_duration, call_duration')
            .eq('exotel_call_sid', pendingCallSid)
            .maybeSingle();
          if (cl) {
            callLogId = callLogId || cl.id;
            duration = cl.conversation_duration || cl.call_duration || 0;
          }

          if (callLogId) {
            setDispositionCallLogId(callLogId);
            setDispositionCallDuration(duration);
            setShowDispositionDialog(true);
          }
          setPendingCallSid(null);
        }
      )
      .subscribe();

    // Safety net: if realtime delivery fails, poll the call_log every 5s
    // and fire when it lands in a terminal state.
    const poll = setInterval(async () => {
      const { data: cl } = await supabase
        .from('call_logs')
        .select('id, status, conversation_duration, call_duration')
        .eq('exotel_call_sid', pendingCallSid)
        .maybeSingle();
      if (cl && ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes((cl.status || '').toLowerCase())) {
        setDispositionCallLogId(cl.id);
        setDispositionCallDuration(cl.conversation_duration || cl.call_duration || 0);
        setShowDispositionDialog(true);
        setPendingCallSid(null);
      }
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [pendingCallSid, dispositionCallLogId]);

  const handleEmailClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedContactForEmail(contact);
    setEmailDialogOpen(true);
  };

  const handleWhatsAppClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedContactForWhatsapp(contact);
    setWhatsappDialogOpen(true);
  };

  const handleEditClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedContactForEdit(contact);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedContactForDelete(contact);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedContactForDelete) return;
    try {
      const { error } = await supabase
        .from("contacts")
        .delete()
        .eq("id", selectedContactForDelete.id);
      if (error) throw error;
      notify.success("Contact deleted", "Contact has been deleted successfully");
      queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
    } catch (error: any) {
      notify.error("Error", error.message);
    } finally {
      setDeleteDialogOpen(false);
      setSelectedContactForDelete(null);
    }
  };

  const handleAssignClick = (contact: Contact, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedContactForAssign(contact);
    setAssignToUserId("");
    setAssignDialogOpen(true);
  };

  const handleAssignConfirm = async () => {
    if (!selectedContactForAssign || !assignToUserId) return;
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ assigned_to: assignToUserId })
        .eq("id", selectedContactForAssign.id);
      if (error) throw error;
      notify.success("Contact assigned", "Contact has been assigned successfully");
      queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
    } catch (error: any) {
      notify.error("Error", error.message);
    } finally {
      setAssignDialogOpen(false);
      setSelectedContactForAssign(null);
    }
  };

  // Open the bulk call dialog — fetches full contact rows for IDs not on the current page
  const openBulkCall = async () => {
    if (openingBulkCall) return;
    setOpeningBulkCall(true);
    try {
      const idsOnPage = new Set(contacts.map((c) => c.id));
      const missingIds = Array.from(selectedIds).filter((id) => !idsOnPage.has(id));
      let extras: Contact[] = [];
      if (missingIds.length > 0) {
        // Supabase IN clause: chunk to avoid URL length cap (~2k chars)
        const chunkSize = 100;
        for (let i = 0; i < missingIds.length; i += chunkSize) {
          const chunk = missingIds.slice(i, i + chunkSize);
          const { data, error } = await supabase
            .from("contacts")
            .select("id, first_name, last_name, email, phone, company, pipeline_stage_id, job_title, source, status")
            .in("id", chunk);
          if (error) throw error;
          extras = extras.concat((data ?? []) as Contact[]);
        }
        // Attach primary phones for the extras
        if (extras.length > 0) {
          const { data: phoneRows } = await supabase
            .from("contact_phones")
            .select("contact_id, phone")
            .in("contact_id", extras.map((e) => e.id))
            .eq("is_primary", true);
          const phoneMap: Record<string, string> = {};
          (phoneRows ?? []).forEach((p: any) => { phoneMap[p.contact_id] = p.phone; });
          extras = extras.map((e) => ({ ...e, primaryPhone: phoneMap[e.id] ?? null }));
        }
      }
      const onPageSelected = contacts.filter((c) => selectedIds.has(c.id));
      setBulkCallContacts([...onPageSelected, ...extras]);
      setBulkCallOpen(true);
    } catch (error: any) {
      notify.error("Error", error.message || String(error));
    } finally {
      setOpeningBulkCall(false);
    }
  };

  // Bulk-assign all selected contacts to a single user
  const handleBulkAssignConfirm = async () => {
    if (!bulkAssignToUserId || selectedIds.size === 0) return;
    setBulkAssigning(true);
    try {
      const ids = Array.from(selectedIds);
      const chunkSize = 200;
      let updated = 0;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("contacts")
          .update({ assigned_to: bulkAssignToUserId })
          .in("id", chunk);
        if (error) throw error;
        updated += chunk.length;
      }
      notify.success("Contacts assigned", `${updated} contacts assigned successfully`);
      queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
      setBulkAssignOpen(false);
      setBulkAssignToUserId("");
      setSelectedIds(new Set());
    } catch (error: any) {
      notify.error("Error", error.message || String(error));
    } finally {
      setBulkAssigning(false);
    }
  };

  // Bulk-delete all selected contacts
  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const chunkSize = 200;
      let deleted = 0;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("contacts")
          .delete()
          .in("id", chunk);
        if (error) throw error;
        deleted += chunk.length;
      }
      notify.success("Contacts deleted", `${deleted} contact${deleted === 1 ? "" : "s"} deleted successfully`);
      queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
    } catch (error: any) {
      notify.error("Error", error.message || String(error));
    } finally {
      setBulkDeleting(false);
    }
  };

  // Select-all-across-pages: fetch every contact id matching the current URL filters
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);
  const handleSelectAllMatching = async () => {
    if (selectingAllMatching) return;
    setSelectingAllMatching(true);
    try {
      let q: any = supabase.from("contacts").select("id");
      q = applyServerFilters(q, urlFilters);
      // Same client-conversion exclusion as the main list
      const { data, error } = await q;
      if (error) throw error;
      const excludeIds = new Set(clientContactIds || []);
      const ids = (data ?? []).map((r: any) => r.id).filter((id: string) => !excludeIds.has(id));
      setSelectedIds(new Set(ids));
      notify.success("Selected", `${ids.length} contacts selected across all pages`);
    } catch (error: any) {
      notify.error("Error", error.message || String(error));
    } finally {
      setSelectingAllMatching(false);
    }
  };

  // Handle inline stage change from table view
  const handleStageChange = async (contactId: string, newStageId: string) => {
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ pipeline_stage_id: newStageId })
        .eq("id", contactId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
      notify.success("Stage updated", "Contact stage has been updated");
    } catch (error: any) {
      notify.error("Error", error.message);
    }
  };

  // Apply field-based filters to contacts
  const applyFilters = useCallback(() => {
    setIsSearching(true);

    // Persist filters to URL — the table query reads urlFilters and refetches server-side
    setUrlFilters(filters);
    setSelectedIds(new Set()); // Clear selection when filter changes
    tablePagination.setPage(1); // Reset to first page on new filter

    if (activeTab === "table") {
      // Server handles filtering for the table view
      setFilteredContacts(null);
      setIsSearching(false);
      return;
    }

    // Board view: filter client-side over the loaded 500 contacts
    const exact = filters.matchMode === "exact";
    const textMatches = (haystack: string | null | undefined, needle: string) => {
      const h = (haystack || "").trim().toLowerCase();
      const n = needle.trim().toLowerCase();
      return exact ? h === n : h.includes(n);
    };
    const filtered = baseContacts.filter((contact) => {
      const fullName = `${contact.first_name} ${contact.last_name || ""}`;

      if (filters.name && !textMatches(fullName, filters.name)) return false;
      if (filters.company && !textMatches(contact.company, filters.company)) return false;
      if (filters.stageId && contact.pipeline_stage_id !== filters.stageId) return false;
      if (filters.product && !textMatches(contact.product, filters.product)) return false;
      if (filters.emailOutreachStatus && !contact.source?.toLowerCase().endsWith(`-${filters.emailOutreachStatus.toLowerCase()}`)) return false;
      if (filters.whatsappOutreachStatus && contact.whatsapp_outreach_status !== filters.whatsappOutreachStatus) return false;
      if (filters.assignedTo === "unassigned" && contact.assigned_to) return false;
      if (filters.assignedTo && filters.assignedTo !== "unassigned" && contact.assigned_to !== filters.assignedTo) return false;

      return true;
    });

    setFilteredContacts(filtered);
    setIsSearching(false);
    notify.success("Filters applied", `Found ${filtered.length} matching contacts`);
  }, [baseContacts, filters, setUrlFilters, notify, activeTab, tablePagination]);

  // Auto-apply filters from URL when base contacts load and URL has filters (board view only;
  // table view uses server-side filtering driven by urlFilters in the query key)
  useEffect(() => {
    if (activeTab === "table") {
      // Server-side filter is applied via the query; no client-side pass needed
      setFilteredContacts(null);
      return;
    }

    const hasUrlFilters = Object.values(urlFilters).some(v => v !== "");

    if (!hasUrlFilters) {
      setFilteredContacts(null);
      return;
    }

    if (baseContacts.length === 0) {
      return;
    }

    const filtered = baseContacts.filter((contact) => {
      const fullName = `${contact.first_name} ${contact.last_name || ""}`.toLowerCase();

      if (urlFilters.name && !fullName.includes(urlFilters.name.toLowerCase())) return false;
      if (urlFilters.company && !contact.company?.toLowerCase().includes(urlFilters.company.toLowerCase())) return false;
      if (urlFilters.stageId && contact.pipeline_stage_id !== urlFilters.stageId) return false;
      if (urlFilters.product && !contact.product?.toLowerCase().includes(urlFilters.product.toLowerCase())) return false;
      if (urlFilters.emailOutreachStatus && !contact.source?.toLowerCase().endsWith(`-${urlFilters.emailOutreachStatus.toLowerCase()}`)) return false;
      if (urlFilters.whatsappOutreachStatus && contact.whatsapp_outreach_status !== urlFilters.whatsappOutreachStatus) return false;
      if (urlFilters.assignedTo === "unassigned" && contact.assigned_to) return false;
      if (urlFilters.assignedTo && urlFilters.assignedTo !== "unassigned" && contact.assigned_to !== urlFilters.assignedTo) return false;

      return true;
    });
    setFilteredContacts(filtered);
  }, [baseContacts, urlFilters, activeTab]);

  const handleClearFilters = () => {
    setFilters(emptyFilters);
    clearUrlFilters(); // Clear URL params
    setFilteredContacts(null);
  };

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some((v) => v !== "");
  }, [filters]);

  if (loading) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading pipeline..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pipeline Board</h1>
            <p className="text-muted-foreground">View and manage your sales pipeline</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setCreateContactDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Contact
            </Button>
            <QuickDial />
          </div>
        </div>

        {/* Field-Based Filters */}
        <PipelineFilters
          filters={filters}
          stages={stages}
          users={usersData ?? []}
          dispositions={dispositionsList ?? []}
          onFiltersChange={setFilters}
          onSearch={applyFilters}
          onClear={handleClearFilters}
          isSearching={isSearching}
          resultCount={hasActiveFilters ? (activeTab === "table" ? (contactsData?.count ?? 0) : contacts.length) : undefined}
          totalCount={hasActiveFilters && activeTab === "board" ? baseContacts.length : undefined}
        />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="board">
              <LayoutGrid className="h-4 w-4 mr-2" />
              Board View
            </TabsTrigger>
            <TabsTrigger value="table">
              <TableIcon className="h-4 w-4 mr-2" />
              Table View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="mt-6">
            <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map(stage => {
            const stageContacts = getContactsInStage(stage.id);
            const visibleCount = stageCardLimits[stage.id] ?? STAGE_CARD_PAGE;
            const visibleContacts = stageContacts.slice(0, visibleCount);
            const hiddenCount = stageContacts.length - visibleContacts.length;
            return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-80"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(stage.id)}
            >
              <Card className="h-full" style={{ borderTopColor: stage.color, borderTopWidth: 3 }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span>{stage.name}</span>
                    <Badge variant="secondary">{stageContacts.length}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {stage.probability}% probability
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto">
                  {visibleContacts.map(contact => (
                    <Card
                       key={contact.id}
                       draggable
                       onDragStart={() => handleDragStart(contact.id)}
                       className="cursor-move hover:shadow-md transition-shadow animate-fade-in"
                       onClick={() => navigate(`/contacts/${contact.id}`)}
                     >
                       <CardContent className="p-3">
                         <p className="font-medium text-sm">
                           {contact.first_name} {contact.last_name}
                         </p>
                         {contact.company && (
                           <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                             <Building className="h-3 w-3" />
                             {contact.company}
                           </div>
                         )}
                         {showEnhancedFields && (
                           <div className="space-y-0.5 mt-1">
                             {contact.city && (
                               <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                 <MapPin className="h-3 w-3" />
                                 {contact.city}
                               </div>
                             )}
                             {contact.industry_type && (
                               <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                 <Factory className="h-3 w-3" />
                                 {contact.industry_type}
                               </div>
                             )}
                             {contact.nature_of_business && (
                               <p className="text-xs text-muted-foreground truncate" title={contact.nature_of_business}>
                                 {contact.nature_of_business}
                               </p>
                             )}
                           </div>
                         )}
                          {(() => {
                            const eo = parseEmailOutreach(contact.source);
                            const ws = contact.whatsapp_outreach_status;
                            const wsStyle = ws ? WHATSAPP_OUTREACH_STATUS_STYLE[ws] : null;
                            if (!eo && !wsStyle) return null;
                            return (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {eo && (() => {
                                  const style = EMAIL_OUTREACH_STATUS_STYLE[eo.status];
                                  return (
                                    <Badge className={`text-[10px] px-1.5 py-0 ${style.className}`} title={`Email — ${eo.campaign}: ${eo.status}`}>
                                      ✉ {style.label}
                                    </Badge>
                                  );
                                })()}
                                {wsStyle && (
                                  <Badge className={`text-[10px] px-1.5 py-0 ${wsStyle.className}`} title={`WhatsApp — ${ws}`}>
                                    💬 {wsStyle.label}
                                  </Badge>
                                )}
                              </div>
                            );
                          })()}
                          <div className="flex items-center justify-between mt-2">
                           <div className="flex gap-2">
                             {contact.email && (
                               <Mail className="h-3 w-3 text-muted-foreground" />
                             )}
                             {(contact.primaryPhone || contact.phone) && (
                               <PhoneIcon className="h-3 w-3 text-muted-foreground" />
                             )}
                           </div>
                           {stage.name?.toLowerCase() === 'won' && effectiveOrgId && (
                             <div onClick={(e) => e.stopPropagation()}>
                               <ConvertToClientButton
                                 contact={{
                                   id: contact.id,
                                   org_id: effectiveOrgId,
                                   first_name: contact.first_name,
                                   last_name: contact.last_name,
                                   email: contact.email,
                                   phone: contact.primaryPhone || contact.phone,
                                   company: contact.company,
                                   job_title: contact.job_title,
                                   address: contact.address,
                                   city: contact.city,
                                   state: contact.state,
                                   country: contact.country,
                                   notes: contact.notes,
                                 }}
                                 isWonStage={true}
                                 onConverted={() => queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] })}
                               />
                             </div>
                           )}
                         </div>
                         <p className="text-[10px] text-muted-foreground mt-1">
                           Updated: {contact.updated_at ? format(new Date(contact.updated_at), 'MMM d, h:mm a') : '-'}
                         </p>
                       </CardContent>
                     </Card>
                  ))}
                  {hiddenCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-muted-foreground"
                      onClick={() =>
                        setStageCardLimits(prev => ({
                          ...prev,
                          [stage.id]: (prev[stage.id] ?? STAGE_CARD_PAGE) + STAGE_CARD_PAGE,
                        }))
                      }
                    >
                      Show {Math.min(hiddenCount, STAGE_CARD_PAGE)} more ({hiddenCount} hidden)
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
            );
            })}
            </div>
          </TabsContent>

          <TabsContent value="table" className="mt-4">
            {selectedIds.size > 0 && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
                <div className="text-sm font-medium flex items-center gap-3 flex-wrap">
                  <span>{selectedIds.size} selected</span>
                  {(() => {
                    const sel = Array.from(selectedIds);
                    const withPhone = contacts.filter((c) => selectedIds.has(c.id) && (c.primaryPhone || c.phone)).length;
                    const withoutPhone = contacts.filter((c) => selectedIds.has(c.id)).length - withPhone;
                    return withoutPhone > 0 ? (
                      <span className="text-xs text-amber-700">
                        ({withoutPhone} on this page have no phone — will be skipped)
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const totalMatching = contactsData?.count ?? 0;
                    const allCurrentPageSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
                    if (allCurrentPageSelected && totalMatching > contacts.length && selectedIds.size < totalMatching) {
                      return (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 text-primary underline"
                          disabled={selectingAllMatching}
                          onClick={handleSelectAllMatching}
                        >
                          {selectingAllMatching ? "Selecting…" : `Select all ${totalMatching} matching across pages`}
                        </Button>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBulkAssignToUserId("");
                      setBulkAssignOpen(true);
                    }}
                    disabled={selectedIds.size === 0}
                  >
                    <UserPlus className="h-4 w-4 mr-1.5" />
                    Assign {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={openBulkCall}
                    disabled={openingBulkCall || selectedIds.size === 0}
                  >
                    {openingBulkCall ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Phone className="h-4 w-4 mr-1.5" />
                    )}
                    Call {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={selectedIds.size === 0 || bulkDeleting}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Delete {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            )}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">All Pipeline Contacts</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="py-2 text-xs h-8 w-10">
                        <Checkbox
                          checked={contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id))}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedIds(new Set(contacts.map((c) => c.id)));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead className="py-2 text-xs h-8">Name / Title</TableHead>
                      <TableHead className="py-2 text-xs h-8">Quick Actions</TableHead>
                      <TableHead className="py-2 text-xs h-8">Company</TableHead>
                      {showEnhancedFields && <TableHead className="py-2 text-xs h-8">Industry</TableHead>}
                      <TableHead className="py-2 text-xs h-8">Targeted Product</TableHead>
                      <TableHead className="py-2 text-xs h-8">Assigned To</TableHead>
                      <TableHead className="py-2 text-xs h-8">Latest Disposition</TableHead>
                      <TableHead className="py-2 text-xs h-8">Email Outreach</TableHead>
                      <TableHead className="py-2 text-xs h-8">WhatsApp Outreach</TableHead>
                      <TableHead className="py-2 text-xs h-8">Stage</TableHead>
                      <TableHead className="py-2 text-xs h-8">Updated</TableHead>
                      <TableHead className="py-2 text-xs h-8 w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((contact, index) => {
                      const stage = stages.find(s => s.id === contact.pipeline_stage_id);
                      return (
                        <TableRow
                          key={contact.id}
                          className={`hover:bg-muted/50 ${selectedIds.has(contact.id) ? 'bg-primary/5' : index % 2 === 0 ? 'bg-muted/20' : ''}`}
                        >
                          <TableCell className="py-1.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(contact.id)}
                              onCheckedChange={(checked) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(contact.id);
                                  else next.delete(contact.id);
                                  return next;
                                });
                              }}
                              aria-label={`Select ${contact.first_name}`}
                            />
                          </TableCell>
                          <TableCell
                            className="py-1.5 cursor-pointer"
                            onClick={() => navigate(`/contacts/${contact.id}`)}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium text-xs">
                                {contact.first_name} {contact.last_name}
                              </span>
                              {contact.job_title && (
                                <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                  {contact.job_title}
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
                                disabled={callingContactId === contact.id || (!contact.primaryPhone && !contact.phone)}
                                onClick={(e) => handleCall(contact, e)}
                                title="Call"
                              >
                                {callingContactId === contact.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Phone className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                disabled={!contact.primaryPhone && !contact.phone}
                                onClick={(e) => handleWhatsAppClick(contact, e)}
                                title="Send WhatsApp"
                              >
                                <MessageSquare className="h-4 w-4" />
                              </Button>
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
                          <TableCell onClick={() => navigate(`/contacts/${contact.id}`)} className="py-1.5 cursor-pointer text-xs">
                            {contact.company || '-'}
                          </TableCell>
                          {showEnhancedFields && (
                            <TableCell onClick={() => navigate(`/contacts/${contact.id}`)} className="py-1.5 cursor-pointer text-xs">
                              <span className="truncate max-w-[100px] block" title={contact.industry_type || ''}>
                                {contact.industry_type || '-'}
                              </span>
                            </TableCell>
                          )}
                          <TableCell onClick={() => navigate(`/contacts/${contact.id}`)} className="py-1.5 cursor-pointer text-xs">
                            {contact.product || '-'}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs">
                            {contact.assigned_to ? (
                              <span title={userNameById.get(contact.assigned_to) || 'User'}>
                                {userNameById.get(contact.assigned_to) || 'User'}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
                                onClick={(e) => handleAssignClick(contact, e)}
                                title="Assign this contact"
                              >
                                <UserPlus className="h-3 w-3 mr-1" />
                                Unassigned
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            {(() => {
                              const d = latestDispositionsByContact?.[contact.id];
                              if (!d) return <span className="text-[10px] text-muted-foreground">-</span>;
                              const style = DISPOSITION_CATEGORY_STYLE[d.category || ''] || DISPOSITION_CATEGORY_STYLE.default;
                              return (
                                <Badge className={`text-[10px] px-1.5 py-0 ${style}`} title={d.name}>
                                  {d.name}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell onClick={() => navigate(`/contacts/${contact.id}`)} className="py-1.5 cursor-pointer">
                            {(() => {
                              const eo = parseEmailOutreach(contact.source);
                              if (!eo) return <span className="text-[10px] text-muted-foreground">-</span>;
                              const style = EMAIL_OUTREACH_STATUS_STYLE[eo.status];
                              return (
                                <Badge className={`text-[10px] px-1.5 py-0 ${style.className}`} title={`${eo.campaign}: ${eo.status}`}>
                                  {style.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell onClick={() => navigate(`/contacts/${contact.id}`)} className="py-1.5 cursor-pointer">
                            {(() => {
                              const ws = contact.whatsapp_outreach_status;
                              const style = ws ? WHATSAPP_OUTREACH_STATUS_STYLE[ws] : null;
                              if (!style) return <span className="text-[10px] text-muted-foreground">-</span>;
                              return (
                                <Badge className={`text-[10px] px-1.5 py-0 ${style.className}`} title={ws}>
                                  {style.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="cursor-pointer focus:outline-none"
                                >
                                  {stage ? (
                                    <Badge
                                      className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity cursor-pointer"
                                      style={{ backgroundColor: stage.color }}
                                    >
                                      {stage.name}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 hover:opacity-80 transition-opacity cursor-pointer">
                                      No Stage
                                    </Badge>
                                  )}
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-40">
                                {stages.map((s) => (
                                  <DropdownMenuItem
                                    key={s.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStageChange(contact.id, s.id);
                                    }}
                                    className="flex items-center gap-2"
                                  >
                                    <div
                                      className="w-3 h-3 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: s.color }}
                                    />
                                    <span className={s.id === contact.pipeline_stage_id ? "font-semibold" : ""}>
                                      {s.name}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          <TableCell onClick={() => navigate(`/contacts/${contact.id}`)} className="py-1.5 cursor-pointer text-muted-foreground text-[10px]">
                            {contact.updated_at ? format(new Date(contact.updated_at), 'MMM d, h:mm a') : '-'}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex gap-1">
                              {stage?.name?.toLowerCase() === 'won' && effectiveOrgId && (
                                <ConvertToClientButton
                                  contact={{
                                    id: contact.id,
                                    org_id: effectiveOrgId,
                                    first_name: contact.first_name,
                                    last_name: contact.last_name,
                                    email: contact.email,
                                    phone: contact.primaryPhone || contact.phone,
                                    company: contact.company,
                                    job_title: contact.job_title,
                                    address: contact.address,
                                    city: contact.city,
                                    state: contact.state,
                                    country: contact.country,
                                    notes: contact.notes,
                                  }}
                                  isWonStage={true}
                                  onConverted={() => queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] })}
                                />
                              )}
                              
                              {/* More Actions Dropdown */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={(e) => handleEditClick(contact, e as unknown as React.MouseEvent)}>
                                    <Pencil className="h-4 w-4 mr-2" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => handleAssignClick(contact, e as unknown as React.MouseEvent)}>
                                    <UserPlus className="h-4 w-4 mr-2" /> Assign
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    className="text-destructive focus:text-destructive" 
                                    onClick={(e) => handleDeleteClick(contact, e as unknown as React.MouseEvent)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            {tablePagination.totalRecords > 0 && (
              <PaginationControls
                currentPage={tablePagination.currentPage}
                totalPages={tablePagination.totalPages}
                pageSize={tablePagination.pageSize}
                totalRecords={tablePagination.totalRecords}
                startRecord={tablePagination.startRecord}
                endRecord={tablePagination.endRecord}
                onPageChange={tablePagination.setPage}
                onPageSizeChange={tablePagination.setPageSize}
              />
            )}
          </TabsContent>
        </Tabs>

        {selectedContactForEmail && (
          <SendEmailDialog
            open={emailDialogOpen}
            onOpenChange={setEmailDialogOpen}
            contactId={selectedContactForEmail.id}
            contactName={`${selectedContactForEmail.first_name} ${selectedContactForEmail.last_name || ''}`.trim()}
          />
        )}

        {/* WhatsApp Dialog */}
        {selectedContactForWhatsapp && (
          <SendWhatsAppDialog
            open={whatsappDialogOpen}
            onOpenChange={setWhatsappDialogOpen}
            contactId={selectedContactForWhatsapp.id}
            contactName={`${selectedContactForWhatsapp.first_name} ${selectedContactForWhatsapp.last_name || ''}`.trim()}
            phoneNumber={selectedContactForWhatsapp.primaryPhone || selectedContactForWhatsapp.phone || ""}
            onMessageSent={() => queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] })}
          />
        )}

        {/* Post-call disposition prompt for calls dialed from the pipeline table */}
        {dispositionCallLogId && (
          <PostCallDispositionDialog
            open={showDispositionDialog}
            onOpenChange={(o) => {
              setShowDispositionDialog(o);
              if (!o) {
                setDispositionCallLogId(null);
                setPendingCallContactId(null);
                setDispositionCallDuration(0);
              }
            }}
            callLogId={dispositionCallLogId}
            contactId={pendingCallContactId}
            callDuration={dispositionCallDuration}
            onDispositionSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
              queryClient.invalidateQueries({ queryKey: ['pipeline-latest-dispositions'] });
            }}
          />
        )}

        {selectedContactForEdit && effectiveOrgId && (
          <EditContactDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            contact={{ 
              id: selectedContactForEdit.id,
              org_id: effectiveOrgId,
              first_name: selectedContactForEdit.first_name,
              last_name: selectedContactForEdit.last_name ?? null,
              email: selectedContactForEdit.email ?? null,
              phone: selectedContactForEdit.phone ?? null,
              company: selectedContactForEdit.company ?? null,
              job_title: selectedContactForEdit.job_title ?? null,
              city: selectedContactForEdit.city ?? null,
              industry_type: selectedContactForEdit.industry_type ?? null,
              nature_of_business: selectedContactForEdit.nature_of_business ?? null,
              status: selectedContactForEdit.status || "new",
              source: selectedContactForEdit.source ?? null,
              linkedin_url: null,
              notes: selectedContactForEdit.notes ?? null,
              pipeline_stage_id: selectedContactForEdit.pipeline_stage_id ?? null
            }}
            onContactUpdated={() => queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] })}
          />
        )}

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="Delete Contact"
          description={`Are you sure you want to delete ${selectedContactForDelete?.first_name} ${selectedContactForDelete?.last_name || ''}? This action cannot be undone.`}
          onConfirm={handleDeleteConfirm}
          confirmText="Delete"
          variant="destructive"
        />

        {/* Bulk Delete Confirmation Dialog */}
        <ConfirmDialog
          open={bulkDeleteOpen}
          onOpenChange={(o) => { if (!bulkDeleting) setBulkDeleteOpen(o); }}
          title={`Delete ${selectedIds.size} contact${selectedIds.size === 1 ? "" : "s"}?`}
          description={`This will permanently delete ${selectedIds.size} selected contact${selectedIds.size === 1 ? "" : "s"} and all related data (phones, activities, notes). This action cannot be undone.`}
          onConfirm={handleBulkDeleteConfirm}
          confirmText={bulkDeleting ? "Deleting…" : `Delete ${selectedIds.size}`}
          variant="destructive"
        />

        {/* Assign Dialog */}
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Assign Contact</DialogTitle>
              <DialogDescription>
                Assign {selectedContactForAssign?.first_name} {selectedContactForAssign?.last_name || ''} to a team member
              </DialogDescription>
            </DialogHeader>
            <UserSelector selectedUserId={assignToUserId} onChange={setAssignToUserId} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAssignConfirm} disabled={!assignToUserId}>Assign</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Assign Dialog */}
        <Dialog open={bulkAssignOpen} onOpenChange={(o) => { if (!bulkAssigning) setBulkAssignOpen(o); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Assign {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"}</DialogTitle>
              <DialogDescription>
                Pick a team member to take ownership of the selected leads. Existing assignments will be overwritten.
              </DialogDescription>
            </DialogHeader>
            <UserSelector selectedUserId={bulkAssignToUserId} onChange={setBulkAssignToUserId} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkAssignOpen(false)} disabled={bulkAssigning}>Cancel</Button>
              <Button onClick={handleBulkAssignConfirm} disabled={!bulkAssignToUserId || bulkAssigning}>
                {bulkAssigning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Assigning…
                  </>
                ) : (
                  `Assign ${selectedIds.size} contact${selectedIds.size === 1 ? "" : "s"}`
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Contact Dialog */}
        <CreateContactDialog
          open={createContactDialogOpen}
          onOpenChange={setCreateContactDialogOpen}
          onContactCreated={() => queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] })}
        />

        <BulkCallDialog
          open={bulkCallOpen}
          onOpenChange={setBulkCallOpen}
          contacts={bulkCallContacts}
          onComplete={() => {
            setSelectedIds(new Set());
            setBulkCallContacts([]);
            queryClient.invalidateQueries({ queryKey: ['pipeline-contacts'] });
          }}
        />
      </div>
    </DashboardLayout>
  );
}
