import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, ChevronDown, ChevronUp, Receipt, AlertTriangle, Clock, CheckCircle2, Building2, IndianRupee, Calendar } from "lucide-react";
import { LoadingState } from "@/components/common/LoadingState";
import { format, parseISO, isAfter, differenceInDays } from "date-fns";
import { toast } from "sonner";
import { UrlTabs } from "@/components/UrlTabs";

interface DashboardGSTSectionProps {
  dateRange: { from: Date; to: Date };
}

interface GSTMonthData {
  month: string;
  monthLabel: string;
  monthNum: number;
  year: number;
  baseAmount: number;
  gstCollected: number;
  gstPending: number;
  tdsDeducted: number;
  netReceived: number;
  invoiceCount: number;
  paidCount: number;
  pendingCount: number;
}

interface QuarterData {
  quarter: string;
  gstCollected: number;
  invoiceCount: number;
}

interface InvoiceDetail {
  id: string;
  clientName: string;
  company?: string;
  invoiceNumber: string;
  invoiceDate: string;
  paymentDate?: string;
  baseAmount: number;
  gstAmount: number;
  tdsAmount: number;
  netReceived: number;
  dueDate?: string;
  daysOverdue: number;
  status: string;
}

interface GSTPaymentTracking {
  id: string;
  org_id: string;
  month: number;
  year: number;
  gst_collected: number;
  payment_status: "pending" | "paid" | "partial";
  amount_paid: number;
  payment_date: string | null;
  payment_reference: string | null;
  notes: string | null;
}

export function DashboardGSTSection({ dateRange }: DashboardGSTSectionProps) {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedMonthForPayment, setSelectedMonthForPayment] = useState<GSTMonthData | null>(null);
  const [cardDetailDialogOpen, setCardDetailDialogOpen] = useState(false);
  const [selectedCardType, setSelectedCardType] = useState<"collected" | "pending_dept" | "paid_dept" | "due_dept" | null>(null);
  
  // Payment form state
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "partial">("pending");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  // Fetch invoices
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["gst-invoices", effectiveOrgId, format(dateRange.from, "yyyy-MM-dd"), format(dateRange.to, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("client_invoices")
        .select(`
          *,
          client:clients(first_name, last_name, company)
        `)
        .eq("org_id", effectiveOrgId)
        .neq("document_type", "quotation")
        .gte("invoice_date", format(dateRange.from, "yyyy-MM-dd"))
        .lte("invoice_date", format(dateRange.to, "yyyy-MM-dd"))
        .order("invoice_date", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch ALL invoices for GST Pending to Dept (ignores date range)
  const { data: allInvoices } = useQuery({
    queryKey: ["all-gst-invoices", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("client_invoices")
        .select(`
          *,
          client:clients(first_name, last_name, company)
        `)
        .eq("org_id", effectiveOrgId)
        .neq("document_type", "quotation")
        .eq("status", "paid")
        .order("invoice_date", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch GST payment tracking records
  const { data: gstPayments } = useQuery({
    queryKey: ["gst-payment-tracking", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("gst_payment_tracking")
        .select("*")
        .eq("org_id", effectiveOrgId);
      
      if (error) throw error;
      return (data || []) as GSTPaymentTracking[];
    },
    enabled: !!effectiveOrgId,
  });

  // Mutation to save GST payment
  const savePaymentMutation = useMutation({
    mutationFn: async (data: {
      month: number;
      year: number;
      gstCollected: number;
      paymentStatus: string;
      amountPaid: number;
      paymentDate: string | null;
      paymentReference: string | null;
      notes: string | null;
    }) => {
      if (!effectiveOrgId) throw new Error("No org selected");
      
      // Check if record exists
      const existing = gstPayments?.find(
        p => p.month === data.month && p.year === data.year
      );
      
      if (existing) {
        const { error } = await supabase
          .from("gst_payment_tracking")
          .update({
            gst_collected: data.gstCollected,
            payment_status: data.paymentStatus,
            amount_paid: data.amountPaid,
            payment_date: data.paymentDate,
            payment_reference: data.paymentReference,
            notes: data.notes,
          })
          .eq("id", existing.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("gst_payment_tracking")
          .insert({
            org_id: effectiveOrgId,
            month: data.month,
            year: data.year,
            gst_collected: data.gstCollected,
            payment_status: data.paymentStatus,
            amount_paid: data.amountPaid,
            payment_date: data.paymentDate,
            payment_reference: data.paymentReference,
            notes: data.notes,
          });
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gst-payment-tracking"] });
      toast.success("GST payment status updated");
      setPaymentDialogOpen(false);
      resetPaymentForm();
    },
    onError: (error) => {
      toast.error("Failed to update payment status: " + error.message);
    },
  });

  const resetPaymentForm = () => {
    setPaymentStatus("pending");
    setAmountPaid("");
    setPaymentDate("");
    setPaymentReference("");
    setPaymentNotes("");
    setSelectedMonthForPayment(null);
  };

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    if (!invoices) return { collected: 0, total: 0, paidToDept: 0, pendingToDept: 0 };
    
    let collected = 0, total = 0;

    invoices.forEach((inv) => {
      const gst = inv.tax_amount || 0;
      total += gst;
      
      if (inv.status === "paid" && inv.payment_received_date) {
        collected += gst;
      }
    });

    // Calculate paid to department from ALL months (ignore date range)
    // Use amount_paid for accurate tracking of what was actually remitted
    const paidToDept = gstPayments?.reduce((sum, p) => {
      if (p.payment_status === "paid" || p.payment_status === "partial") {
        return sum + (p.amount_paid || 0);
      }
      return sum;
    }, 0) || 0;

    // Calculate total GST collected from ALL invoices for pending to dept calculation
    let totalCollectedAllTime = 0;
    allInvoices?.forEach((inv) => {
      totalCollectedAllTime += inv.tax_amount || 0;
    });

    return { 
      collected, 
      total,
      paidToDept,
      pendingToDept: totalCollectedAllTime - paidToDept,
    };
  }, [invoices, gstPayments, allInvoices]);

  // Calculate unpaid months for GST Pending to Dept card (ignores date range)
  const unpaidMonthsData = useMemo(() => {
    if (!allInvoices) return [];
    
    const monthMap = new Map<string, GSTMonthData>();

    allInvoices.forEach((inv) => {
      const dateToUse = inv.payment_received_date || inv.invoice_date;
      const parsedDate = parseISO(dateToUse);
      const monthKey = format(parsedDate, "yyyy-MM");
      const monthLabel = format(parsedDate, "MMM yyyy");
      const monthNum = parsedDate.getMonth() + 1;
      const year = parsedDate.getFullYear();
      
      const current = monthMap.get(monthKey) || {
        month: monthKey,
        monthLabel,
        monthNum,
        year,
        baseAmount: 0,
        gstCollected: 0,
        gstPending: 0,
        tdsDeducted: 0,
        netReceived: 0,
        invoiceCount: 0,
        paidCount: 0,
        pendingCount: 0,
      };

      const gst = inv.tax_amount || 0;
      current.gstCollected += gst;
      current.paidCount += 1;
      monthMap.set(monthKey, current);
    });

    // Filter only months where payment to dept is not complete
    return Array.from(monthMap.values())
      .filter((m) => {
        const payment = gstPayments?.find(p => p.month === m.monthNum && p.year === m.year);
        // Show if not paid or partial
        return !payment || payment.payment_status !== "paid";
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [allInvoices, gstPayments]);

  // Calculate monthly GST breakdown
  const monthlyData = useMemo(() => {
    if (!invoices) return [];
    
    const monthMap = new Map<string, GSTMonthData>();

    invoices.forEach((inv) => {
      const dateToUse = inv.status === "paid" && inv.payment_received_date 
        ? inv.payment_received_date 
        : inv.invoice_date;
      
      const parsedDate = parseISO(dateToUse);
      const monthKey = format(parsedDate, "yyyy-MM");
      const monthLabel = format(parsedDate, "MMM yyyy");
      const monthNum = parsedDate.getMonth() + 1;
      const year = parsedDate.getFullYear();
      
      const current = monthMap.get(monthKey) || {
        month: monthKey,
        monthLabel,
        monthNum,
        year,
        baseAmount: 0,
        gstCollected: 0,
        gstPending: 0,
        tdsDeducted: 0,
        netReceived: 0,
        invoiceCount: 0,
        paidCount: 0,
        pendingCount: 0,
      };

      const baseAmount = inv.amount || 0;
      const gst = inv.tax_amount || 0;
      const tds = inv.tds_amount || 0;

      current.invoiceCount += 1;
      
      if (inv.status === "paid") {
        current.baseAmount += baseAmount;
        current.gstCollected += gst;
        current.tdsDeducted += tds;
        current.netReceived += (inv.actual_payment_received || inv.net_received_amount || (baseAmount + gst - tds));
        current.paidCount += 1;
      } else {
        current.gstPending += gst;
        current.pendingCount += 1;
      }

      monthMap.set(monthKey, current);
    });

    return Array.from(monthMap.values())
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [invoices]);

  // Get payment status for a month
  const getPaymentStatus = (monthNum: number, year: number) => {
    return gstPayments?.find(p => p.month === monthNum && p.year === year);
  };

  // Get invoices for selected month
  const getMonthInvoices = useMemo(() => {
    if (!invoices || !selectedMonth) return { paid: [], pending: [] };
    
    const today = new Date();
    const paid: InvoiceDetail[] = [];
    const pending: InvoiceDetail[] = [];

    invoices.forEach((inv) => {
      const dateToUse = inv.status === "paid" && inv.payment_received_date 
        ? inv.payment_received_date 
        : inv.invoice_date;
      
      const monthKey = format(parseISO(dateToUse), "yyyy-MM");
      
      if (monthKey !== selectedMonth) return;
      
      const clientName = inv.client 
        ? `${inv.client.first_name} ${inv.client.last_name || ""}`.trim()
        : "Unknown Client";
      
      const dueDate = inv.due_date ? parseISO(inv.due_date) : null;
      const daysOverdue = dueDate && isAfter(today, dueDate) && inv.status !== "paid"
        ? differenceInDays(today, dueDate) 
        : 0;

      const detail: InvoiceDetail = {
        id: inv.id,
        clientName,
        company: inv.client?.company,
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        paymentDate: inv.payment_received_date,
        baseAmount: inv.amount || 0,
        gstAmount: inv.tax_amount || 0,
        tdsAmount: inv.tds_amount || 0,
        netReceived: inv.actual_payment_received || inv.net_received_amount || ((inv.amount || 0) + (inv.tax_amount || 0) - (inv.tds_amount || 0)),
        dueDate: inv.due_date,
        daysOverdue,
        status: inv.status,
      };

      if (inv.status === "paid") {
        paid.push(detail);
      } else {
        pending.push(detail);
      }
    });

    return { paid, pending };
  }, [invoices, selectedMonth]);

  const handleMonthClick = (month: string) => {
    // Close Card Detail Dialog if open (prevent conflicts)
    setCardDetailDialogOpen(false);
    setSelectedCardType(null);
    
    setSelectedMonth(month);
    setDialogOpen(true);
  };

  const handleCardClick = (cardType: "collected" | "pending_dept" | "paid_dept" | "due_dept") => {
    // Close Month Detail Dialog if open (prevent conflicts)
    setDialogOpen(false);
    setSelectedMonth(null);
    
    setSelectedCardType(cardType);
    setCardDetailDialogOpen(true);
  };

  // Get invoices filtered by card type
  const getCardInvoices = useMemo(() => {
    if (!invoices || !selectedCardType) return [];
    
    const today = new Date();
    
    return invoices.filter((inv) => {
      const gst = inv.tax_amount || 0;
      if (gst === 0) return false;
      
      if (selectedCardType === "collected") {
        return inv.status === "paid" && inv.payment_received_date;
      }
      if (selectedCardType === "pending_dept") {
        // Show invoices where GST was collected but not yet paid to dept
        return inv.status === "paid" && inv.payment_received_date;
      }
      return false;
    }).map((inv) => {
      const clientName = inv.client 
        ? `${inv.client.first_name} ${inv.client.last_name || ""}`.trim()
        : "Unknown Client";
      const dueDate = inv.due_date ? parseISO(inv.due_date) : null;
      const daysOverdue = dueDate && isAfter(today, dueDate) && inv.status !== "paid"
        ? differenceInDays(today, dueDate) 
        : 0;

      return {
        id: inv.id,
        clientName,
        company: inv.client?.company,
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        paymentDate: inv.payment_received_date,
        baseAmount: inv.amount || 0,
        gstAmount: inv.tax_amount || 0,
        tdsAmount: inv.tds_amount || 0,
        netReceived: inv.actual_payment_received || inv.net_received_amount || ((inv.amount || 0) + (inv.tax_amount || 0) - (inv.tds_amount || 0)),
        dueDate: inv.due_date,
        daysOverdue,
        status: inv.status,
      } as InvoiceDetail;
    });
  }, [invoices, selectedCardType]);

  const getCardTitle = () => {
    switch (selectedCardType) {
      case "collected": return "GST Collected - Invoice Details";
      case "pending_dept": return "GST Pending to Department - Unpaid Months";
      case "paid_dept": return "GST Paid to Department - Payment History";
      case "due_dept": return "GST Due to Department - Unpaid Months";
      default: return "Details";
    }
  };

  // Get paid months data for "Paid to Dept" card
  const paidMonthsData = useMemo(() => {
    if (!gstPayments) return [];
    
    return gstPayments
      .filter(p => p.payment_status === "paid" || p.payment_status === "partial")
      .map(p => ({
        month: `${p.year}-${String(p.month).padStart(2, '0')}`,
        monthLabel: format(new Date(p.year, p.month - 1), "MMM yyyy"),
        monthNum: p.month,
        year: p.year,
        gstCollected: p.gst_collected || 0,
        amountPaid: p.amount_paid || 0,
        paymentStatus: p.payment_status,
        paymentDate: p.payment_date,
        paymentReference: p.payment_reference,
      }))
      .sort((a, b) => b.year - a.year || b.monthNum - a.monthNum);
  }, [gstPayments]);

  const handlePaymentClick = (monthData: GSTMonthData, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMonthForPayment(monthData);
    
    // Pre-fill form with existing data
    const existing = getPaymentStatus(monthData.monthNum, monthData.year);
    if (existing) {
      setPaymentStatus(existing.payment_status);
      setAmountPaid(existing.amount_paid?.toString() || "");
      setPaymentDate(existing.payment_date || "");
      setPaymentReference(existing.payment_reference || "");
      setPaymentNotes(existing.notes || "");
    } else {
      setPaymentStatus("pending");
      setAmountPaid(monthData.gstCollected.toString());
      setPaymentDate("");
      setPaymentReference("");
      setPaymentNotes("");
    }
    
    setPaymentDialogOpen(true);
  };

  const handleSavePayment = () => {
    if (!selectedMonthForPayment) return;
    
    savePaymentMutation.mutate({
      month: selectedMonthForPayment.monthNum,
      year: selectedMonthForPayment.year,
      gstCollected: selectedMonthForPayment.gstCollected,
      paymentStatus,
      amountPaid: parseFloat(amountPaid) || 0,
      paymentDate: paymentDate || null,
      paymentReference: paymentReference || null,
      notes: paymentNotes || null,
    });
  };

  // Calculate quarterly summary (Indian FY)
  const quarterlyData = useMemo(() => {
    if (!invoices) return [];
    
    const quarterMap = new Map<string, QuarterData>();
    
    invoices.forEach((inv) => {
      if (inv.status !== "paid" || !inv.payment_received_date) return;
      
      const paymentDate = parseISO(inv.payment_received_date);
      const month = paymentDate.getMonth();
      const year = paymentDate.getFullYear();
      
      let fyQuarter: number;
      let fyYear: string;
      
      if (month >= 3 && month <= 5) {
        fyQuarter = 1;
        fyYear = `${year}-${(year + 1).toString().slice(-2)}`;
      } else if (month >= 6 && month <= 8) {
        fyQuarter = 2;
        fyYear = `${year}-${(year + 1).toString().slice(-2)}`;
      } else if (month >= 9 && month <= 11) {
        fyQuarter = 3;
        fyYear = `${year}-${(year + 1).toString().slice(-2)}`;
      } else {
        fyQuarter = 4;
        fyYear = `${year - 1}-${year.toString().slice(-2)}`;
      }
      
      const quarterKey = `Q${fyQuarter} FY${fyYear}`;
      
      const current = quarterMap.get(quarterKey) || {
        quarter: quarterKey,
        gstCollected: 0,
        invoiceCount: 0,
      };
      
      current.gstCollected += inv.tax_amount || 0;
      current.invoiceCount += 1;
      quarterMap.set(quarterKey, current);
    });

    return Array.from(quarterMap.values())
      .sort((a, b) => b.quarter.localeCompare(a.quarter));
  }, [invoices]);

  // Pending invoices for the collapsible section
  const pendingInvoicesList = useMemo(() => {
    if (!invoices) return [];
    
    const today = new Date();
    
    return invoices
      .filter((inv) => inv.status !== "paid" && (inv.tax_amount || 0) > 0)
      .map((inv): InvoiceDetail => {
        const dueDate = inv.due_date ? parseISO(inv.due_date) : null;
        const daysOverdue = dueDate && isAfter(today, dueDate) 
          ? differenceInDays(today, dueDate) 
          : 0;
        
        const clientName = inv.client 
          ? `${inv.client.first_name} ${inv.client.last_name || ""}`.trim()
          : "Unknown Client";

        return {
          id: inv.id,
          clientName,
          company: inv.client?.company,
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          paymentDate: undefined,
          baseAmount: inv.amount || 0,
          gstAmount: inv.tax_amount || 0,
          tdsAmount: inv.tds_amount || 0,
          netReceived: 0,
          dueDate: inv.due_date,
          daysOverdue,
          status: inv.status,
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [invoices]);

  const handleExportCSV = () => {
    const headers = ["Month", "Base Amount", "GST Collected", "GST Pending", "TDS Deducted", "Net Received", "Paid Invoices", "Dept. Status"];
    const rows = monthlyData.map((row) => {
      const paymentStatus = getPaymentStatus(row.monthNum, row.year);
      return [
        row.monthLabel,
        row.baseAmount.toFixed(2),
        row.gstCollected.toFixed(2),
        row.gstPending.toFixed(2),
        row.tdsDeducted.toFixed(2),
        row.netReceived.toFixed(2),
        row.paidCount.toString(),
        paymentStatus?.payment_status || "Not Tracked",
      ];
    });
    
    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gst-summary-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const renderPaymentStatusBadge = (monthNum: number, year: number, gstCollected: number) => {
    const status = getPaymentStatus(monthNum, year);
    
    if (!status || status.payment_status === "pending") {
      if (gstCollected === 0) {
        return <Badge variant="secondary" className="text-xs">No GST</Badge>;
      }
      return <Badge variant="destructive" className="text-xs">Unpaid to Dept</Badge>;
    }
    
    if (status.payment_status === "paid") {
      return <Badge className="text-xs bg-green-600">Paid to Dept</Badge>;
    }
    
    if (status.payment_status === "partial") {
      return <Badge variant="secondary" className="text-xs bg-yellow-500 text-white">Partial</Badge>;
    }
    
    return null;
  };

  if (isLoading) {
    return <LoadingState message="Loading GST data..." />;
  }

  return (
    <div className="space-y-4">
      {/* Export Button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => handleCardClick("collected")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">GST Collected</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-green-600">{formatCurrency(summaryMetrics.collected)}</div>
            <p className="text-xs text-muted-foreground">From clients</p>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => handleCardClick("pending_dept")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">GST Pending to Dept</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-yellow-600">{formatCurrency(summaryMetrics.pendingToDept)}</div>
            <p className="text-xs text-muted-foreground">Collected but not paid</p>
          </CardContent>
        </Card>

        <Card 
          className="border-green-200 bg-green-50/50 dark:bg-green-950/20 cursor-pointer hover:bg-green-100/50 dark:hover:bg-green-900/30 transition-colors"
          onClick={() => handleCardClick("paid_dept")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">Paid to Dept</CardTitle>
            <Building2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-green-700">{formatCurrency(summaryMetrics.paidToDept)}</div>
            <p className="text-xs text-muted-foreground">Remitted to GST Dept</p>
          </CardContent>
        </Card>

        <Card 
          className="border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 cursor-pointer hover:bg-orange-100/50 dark:hover:bg-orange-900/30 transition-colors"
          onClick={() => handleCardClick("due_dept")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium">Due to Dept</CardTitle>
            <IndianRupee className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-orange-700">{formatCurrency(summaryMetrics.pendingToDept)}</div>
            <p className="text-xs text-muted-foreground">Yet to remit</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Breakdown Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly GST Breakdown</CardTitle>
          <p className="text-xs text-muted-foreground">Click on a row to see invoice details, or click status to update department payment</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Base Amount</TableHead>
                  <TableHead className="text-right">GST Collected</TableHead>
                  <TableHead className="text-right">GST Pending</TableHead>
                  <TableHead className="text-right">TDS Deducted</TableHead>
                  <TableHead className="text-right">Net Received</TableHead>
                  <TableHead className="text-center">Dept. Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                      No invoice data found
                    </TableCell>
                  </TableRow>
                ) : (
                  monthlyData.map((row) => (
                    <TableRow 
                      key={row.month} 
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleMonthClick(row.month)}
                    >
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{row.monthLabel}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.baseAmount)}</TableCell>
                      <TableCell className="text-right text-green-600">{formatCurrency(row.gstCollected)}</TableCell>
                      <TableCell className="text-right text-yellow-600">{formatCurrency(row.gstPending)}</TableCell>
                      <TableCell className="text-right text-red-600">{formatCurrency(row.tdsDeducted)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.netReceived)}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1"
                          onClick={(e) => handlePaymentClick(row, e)}
                        >
                          {renderPaymentStatusBadge(row.monthNum, row.year, row.gstCollected)}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Payment Status Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              GST Payment to Department - {selectedMonthForPayment?.monthLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">GST Collected from Clients</span>
                <span className="font-bold text-lg">{formatCurrency(selectedMonthForPayment?.gstCollected || 0)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Status</Label>
              <div className="flex gap-2">
                <Button
                  variant={paymentStatus === "pending" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPaymentStatus("pending")}
                  className="flex-1"
                >
                  <Clock className="h-4 w-4 mr-1" />
                  Pending
                </Button>
                <Button
                  variant={paymentStatus === "partial" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPaymentStatus("partial")}
                  className="flex-1"
                >
                  <IndianRupee className="h-4 w-4 mr-1" />
                  Partial
                </Button>
                <Button
                  variant={paymentStatus === "paid" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPaymentStatus("paid")}
                  className="flex-1"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Paid
                </Button>
              </div>
            </div>

            {(paymentStatus === "paid" || paymentStatus === "partial") && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="amountPaid">Amount Paid (₹)</Label>
                  <Input
                    id="amountPaid"
                    type="number"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                    placeholder="Enter amount paid"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentDate">Payment Date</Label>
                  <Input
                    id="paymentDate"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentReference">Challan/Reference Number</Label>
                  <Input
                    id="paymentReference"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="GST Payment Challan No."
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="paymentNotes">Notes (Optional)</Label>
              <Textarea
                id="paymentNotes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Any additional notes..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePayment} disabled={savePaymentMutation.isPending}>
              {savePaymentMutation.isPending ? "Saving..." : "Save Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card Detail Dialog */}
      <Dialog open={cardDetailDialogOpen} onOpenChange={setCardDetailDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{getCardTitle()}</DialogTitle>
          </DialogHeader>
          {(selectedCardType === "pending_dept" || selectedCardType === "due_dept") ? (
            // Show unpaid months for pending/due to dept
            unpaidMonthsData.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                All months have been paid to the department
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">GST Collected</TableHead>
                      <TableHead className="text-right">Amount Paid</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unpaidMonthsData.map((m) => {
                      const payment = gstPayments?.find(p => p.month === m.monthNum && p.year === m.year);
                      const amountPaidVal = payment?.amount_paid || 0;
                      const pendingAmount = m.gstCollected - amountPaidVal;
                      
                      return (
                        <TableRow key={m.month}>
                          <TableCell className="font-medium">{m.monthLabel}</TableCell>
                          <TableCell className="text-right text-green-600">{formatCurrency(m.gstCollected)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(amountPaidVal)}</TableCell>
                          <TableCell className="text-right text-yellow-600 font-medium">{formatCurrency(pendingAmount)}</TableCell>
                          <TableCell>
                            {payment?.payment_status === "partial" ? (
                              <Badge variant="secondary" className="text-xs bg-yellow-500 text-white">Partial</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">Unpaid</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => handlePaymentClick(m, e)}
                            >
                              Update Payment
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/50 font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatCurrency(unpaidMonthsData.reduce((sum, m) => sum + m.gstCollected, 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(unpaidMonthsData.reduce((sum, m) => {
                          const payment = gstPayments?.find(p => p.month === m.monthNum && p.year === m.year);
                          return sum + (payment?.amount_paid || 0);
                        }, 0))}
                      </TableCell>
                      <TableCell className="text-right text-yellow-600">
                        {formatCurrency(summaryMetrics.pendingToDept)}
                      </TableCell>
                      <TableCell colSpan={2}>{unpaidMonthsData.length} months</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )
          ) : selectedCardType === "paid_dept" ? (
            // Show paid months for paid to dept
            paidMonthsData.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No payments recorded to the department yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">GST Collected</TableHead>
                      <TableHead className="text-right">Amount Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paidMonthsData.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{m.monthLabel}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(m.gstCollected)}</TableCell>
                        <TableCell className="text-right text-green-600 font-medium">{formatCurrency(m.amountPaid)}</TableCell>
                        <TableCell>
                          {m.paymentStatus === "paid" ? (
                            <Badge className="text-xs bg-green-600">Paid</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs bg-yellow-500 text-white">Partial</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.paymentReference || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(paidMonthsData.reduce((sum, m) => sum + m.gstCollected, 0))}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatCurrency(summaryMetrics.paidToDept)}
                      </TableCell>
                      <TableCell colSpan={2}>{paidMonthsData.length} months</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )
          ) : getCardInvoices.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No invoices found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getCardInvoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{inv.clientName}</div>
                        {inv.company && <div className="text-xs text-muted-foreground">{inv.company}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-sm">
                        {inv.paymentDate 
                          ? format(parseISO(inv.paymentDate), "dd MMM yy")
                          : format(parseISO(inv.invoiceDate), "dd MMM yy")}
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(inv.baseAmount)}</TableCell>
                      <TableCell className="text-right text-sm text-green-600">{formatCurrency(inv.gstAmount)}</TableCell>
                      <TableCell className="text-right text-sm text-red-600">{formatCurrency(inv.tdsAmount)}</TableCell>
                      <TableCell>
                        {inv.status === "paid" ? (
                          <Badge className="text-xs bg-green-600">Paid</Badge>
                        ) : inv.daysOverdue > 0 ? (
                          <Badge variant="destructive" className="text-xs">{inv.daysOverdue}d overdue</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Pending</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell colSpan={4} className="text-right">Total GST:</TableCell>
                    <TableCell className="text-right text-green-600">
                      {formatCurrency(getCardInvoices.reduce((sum, inv) => sum + inv.gstAmount, 0))}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatCurrency(getCardInvoices.reduce((sum, inv) => sum + inv.tdsAmount, 0))}
                    </TableCell>
                    <TableCell>{getCardInvoices.length} invoices</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Month Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              GST Details - {monthlyData.find(m => m.month === selectedMonth)?.monthLabel || selectedMonth}
            </DialogTitle>
          </DialogHeader>
          <UrlTabs param="dashboardgstsection_tab" defaultValue="paid" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paid" className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Paid ({getMonthInvoices.paid.length})
              </TabsTrigger>
              <TabsTrigger value="pending" className="gap-2">
                <Clock className="h-4 w-4" />
                Pending ({getMonthInvoices.pending.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="paid" className="mt-4">
              {getMonthInvoices.paid.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No paid invoices for this month</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">GST</TableHead>
                        <TableHead className="text-right">TDS</TableHead>
                        <TableHead className="text-right">Net Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getMonthInvoices.paid.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{inv.clientName}</div>
                            {inv.company && <div className="text-xs text-muted-foreground">{inv.company}</div>}
                          </TableCell>
                          <TableCell className="text-sm">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-sm">
                            {inv.paymentDate ? format(parseISO(inv.paymentDate), "dd MMM yy") : "-"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(inv.baseAmount)}</TableCell>
                          <TableCell className="text-right text-sm text-green-600">{formatCurrency(inv.gstAmount)}</TableCell>
                          <TableCell className="text-right text-sm text-red-600">{formatCurrency(inv.tdsAmount)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{formatCurrency(inv.netReceived)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-medium">
                        <TableCell colSpan={4} className="text-right">Total:</TableCell>
                        <TableCell className="text-right text-green-600">
                          {formatCurrency(getMonthInvoices.paid.reduce((sum, inv) => sum + inv.gstAmount, 0))}
                        </TableCell>
                        <TableCell className="text-right text-red-600">
                          {formatCurrency(getMonthInvoices.paid.reduce((sum, inv) => sum + inv.tdsAmount, 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(getMonthInvoices.paid.reduce((sum, inv) => sum + inv.netReceived, 0))}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
            <TabsContent value="pending" className="mt-4">
              {getMonthInvoices.pending.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No pending invoices for this month</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Invoice Date</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">GST</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getMonthInvoices.pending.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{inv.clientName}</div>
                            {inv.company && <div className="text-xs text-muted-foreground">{inv.company}</div>}
                          </TableCell>
                          <TableCell className="text-sm">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-sm">{format(parseISO(inv.invoiceDate), "dd MMM yy")}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(inv.baseAmount)}</TableCell>
                          <TableCell className="text-right text-sm text-yellow-600">{formatCurrency(inv.gstAmount)}</TableCell>
                          <TableCell className="text-sm">
                            {inv.dueDate ? format(parseISO(inv.dueDate), "dd MMM yy") : "-"}
                          </TableCell>
                          <TableCell>
                            {inv.daysOverdue > 0 ? (
                              <Badge variant="destructive" className="text-xs">{inv.daysOverdue}d overdue</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Pending</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-medium">
                        <TableCell colSpan={4} className="text-right">Total GST Pending:</TableCell>
                        <TableCell className="text-right text-yellow-600">
                          {formatCurrency(getMonthInvoices.pending.reduce((sum, inv) => sum + inv.gstAmount, 0))}
                        </TableCell>
                        <TableCell colSpan={2}></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </UrlTabs>
        </DialogContent>
      </Dialog>

      {/* Quarterly Summary */}
      {quarterlyData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quarterly Summary (Indian FY)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {quarterlyData.slice(0, 4).map((q) => (
                <div key={q.quarter} className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-sm font-medium text-muted-foreground">{q.quarter}</div>
                  <div className="text-lg font-bold mt-1">{formatCurrency(q.gstCollected)}</div>
                  <div className="text-xs text-muted-foreground">{q.invoiceCount} invoices</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending GST Details */}
      {pendingInvoicesList.length > 0 && (
        <Card>
          <Collapsible open={pendingExpanded} onOpenChange={setPendingExpanded}>
            <CardHeader className="pb-3">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer">
                  <CardTitle className="text-base flex items-center gap-2">
                    Pending GST Details
                    <Badge variant="secondary">{pendingInvoicesList.length}</Badge>
                  </CardTitle>
                  {pendingExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">GST</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingInvoicesList.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{inv.clientName}</div>
                            {inv.company && (
                              <div className="text-xs text-muted-foreground">{inv.company}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{inv.invoiceNumber}</TableCell>
                          <TableCell className="text-sm">{format(parseISO(inv.invoiceDate), "dd MMM yy")}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(inv.baseAmount)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(inv.gstAmount)}</TableCell>
                          <TableCell className="text-sm">
                            {inv.dueDate ? format(parseISO(inv.dueDate), "dd MMM yy") : "-"}
                          </TableCell>
                          <TableCell>
                            {inv.daysOverdue > 0 ? (
                              <Badge variant="destructive" className="text-xs">
                                {inv.daysOverdue}d overdue
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Pending</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}
    </div>
  );
}
