import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { Button } from "@/components/ui/button";
import { Target, RefreshCw } from "lucide-react";
import { DateRangeFilter, DateRangePreset, getDateRangeFromPreset } from "@/components/common/DateRangeFilter";
import { RevenueHeroCards } from "@/components/Revenue/RevenueHeroCards";
import { RevenueGoalProgress } from "@/components/Revenue/RevenueGoalProgress";
import { RevenueTrendChart } from "@/components/Revenue/RevenueTrendChart";
import { RevenuePieChart } from "@/components/Revenue/RevenuePieChart";
import { RevenueBreakdownTabs } from "@/components/Revenue/RevenueBreakdownTabs";
import { SetGoalDialog } from "@/components/Revenue/SetGoalDialog";
import { LoadingState } from "@/components/common/LoadingState";
import { format, parseISO, isAfter, startOfMonth, endOfMonth } from "date-fns";
import { useUrlDateRange } from "@/hooks/useUrlDateRange";

export default function RevenueDashboard() {
  const { effectiveOrgId } = useOrgContext();
  const [preset, setPreset, dateRange, setDateRange] = useUrlDateRange("this_year");
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);

  // Fetch invoices
  const { data: invoices, isLoading: invoicesLoading, refetch: refetchInvoices } = useQuery({
    queryKey: ["revenue-invoices", effectiveOrgId, dateRange],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from("client_invoices")
        .select(`
          *,
          client:clients(first_name, last_name, company)
        `)
        .eq("org_id", effectiveOrgId)
        .gte("invoice_date", format(dateRange.from, "yyyy-MM-dd"))
        .lte("invoice_date", format(dateRange.to, "yyyy-MM-dd"))
        .order("invoice_date", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveOrgId,
  });

  // Fetch current goal
  const { data: currentGoal, refetch: refetchGoal } = useQuery({
    queryKey: ["revenue-goal", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return null;
      const now = new Date();
      const { data, error } = await supabase
        .from("revenue_goals")
        .select("*")
        .eq("org_id", effectiveOrgId)
        .lte("period_start", format(now, "yyyy-MM-dd"))
        .gte("period_end", format(now, "yyyy-MM-dd"))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  // Calculate metrics (including GST - tax_amount)
  const metrics = useMemo(() => {
    if (!invoices) return { total: 0, paid: 0, outstanding: 0, overdue: 0 };
    
    const today = new Date();
    let total = 0, paid = 0, outstanding = 0, overdue = 0;

    invoices.forEach((inv) => {
      const amount = inv.amount || 0;
      const taxAmount = inv.tax_amount || 0;
      const totalAmount = amount + taxAmount;
      total += totalAmount;
      
      if (inv.status === "paid") {
        paid += totalAmount;
      } else {
        const dueDate = inv.due_date ? parseISO(inv.due_date) : null;
        if (dueDate && isAfter(today, dueDate)) {
          overdue += totalAmount;
        } else {
          outstanding += totalAmount;
        }
      }
    });

    return { total, paid, outstanding, overdue };
  }, [invoices]);

  // Calculate trend data (monthly) - including GST
  const trendData = useMemo(() => {
    if (!invoices) return [];
    
    const monthlyMap = new Map<string, { invoiced: number; received: number }>();
    
    invoices.forEach((inv) => {
      const monthKey = format(parseISO(inv.invoice_date), "MMM yyyy");
      const current = monthlyMap.get(monthKey) || { invoiced: 0, received: 0 };
      const totalAmount = (inv.amount || 0) + (inv.tax_amount || 0);
      current.invoiced += totalAmount;
      if (inv.status === "paid") {
        current.received += totalAmount;
      }
      monthlyMap.set(monthKey, current);
    });

    return Array.from(monthlyMap.entries())
      .map(([period, data]) => ({ period, ...data }))
      .reverse();
  }, [invoices]);

  // Calculate date breakdown - including GST
  const dateBreakdown = useMemo(() => {
    if (!invoices) return [];
    
    const dateMap = new Map<string, { invoiced: number; received: number; count: number }>();
    
    invoices.forEach((inv) => {
      const dateKey = inv.invoice_date;
      const current = dateMap.get(dateKey) || { invoiced: 0, received: 0, count: 0 };
      const totalAmount = (inv.amount || 0) + (inv.tax_amount || 0);
      current.invoiced += totalAmount;
      current.count += 1;
      if (inv.status === "paid") {
        current.received += totalAmount;
      }
      dateMap.set(dateKey, current);
    });

    return Array.from(dateMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [invoices]);

  // Calculate client breakdown - including GST
  const clientBreakdown = useMemo(() => {
    if (!invoices) return [];
    
    const clientMap = new Map<string, {
      clientName: string;
      company?: string;
      totalInvoiced: number;
      totalPaid: number;
      invoiceCount: number;
    }>();
    
    invoices.forEach((inv) => {
      const clientId = inv.client_id || "unknown";
      const clientName = inv.client 
        ? `${inv.client.first_name} ${inv.client.last_name || ""}`.trim()
        : "Unknown Client";
      
      const current = clientMap.get(clientId) || {
        clientName,
        company: inv.client?.company,
        totalInvoiced: 0,
        totalPaid: 0,
        invoiceCount: 0,
      };
      
      const totalAmount = (inv.amount || 0) + (inv.tax_amount || 0);
      current.totalInvoiced += totalAmount;
      current.invoiceCount += 1;
      if (inv.status === "paid") {
        current.totalPaid += totalAmount;
      }
      clientMap.set(clientId, current);
    });

    return Array.from(clientMap.entries())
      .map(([clientId, data]) => ({ clientId, ...data }))
      .sort((a, b) => b.totalInvoiced - a.totalInvoiced);
  }, [invoices]);

  // Current month revenue for goal tracking - including GST
  const currentMonthRevenue = useMemo(() => {
    if (!invoices) return 0;
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());
    
    return invoices
      .filter((inv) => {
        const invDate = parseISO(inv.invoice_date);
        return invDate >= monthStart && invDate <= monthEnd;
      })
      .reduce((sum, inv) => sum + (inv.amount || 0) + (inv.tax_amount || 0), 0);
  }, [invoices]);

  const handleRefresh = () => {
    refetchInvoices();
    refetchGoal();
  };

  const handleGoalSaved = () => {
    refetchGoal();
  };

  if (invoicesLoading) {
    return <LoadingState message="Loading revenue data..." />;
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Revenue Dashboard</h1>
          <p className="text-muted-foreground">Track your financial performance</p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter
            value={dateRange}
            onChange={setDateRange}
            preset={preset}
            onPresetChange={setPreset}
          />
          <Button variant="outline" size="icon" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setGoalDialogOpen(true)} className="gap-2">
            <Target className="h-4 w-4" />
            Set Goal
          </Button>
        </div>
      </div>

      {/* Hero Cards */}
      <RevenueHeroCards
        totalRevenue={metrics.total}
        paidAmount={metrics.paid}
        outstandingAmount={metrics.outstanding}
        overdueAmount={metrics.overdue}
      />

      {/* Goal Progress */}
      <RevenueGoalProgress
        goal={currentGoal}
        actualRevenue={currentMonthRevenue}
        onSetGoal={() => setGoalDialogOpen(true)}
      />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueTrendChart data={trendData} />
        <RevenuePieChart
          paidAmount={metrics.paid}
          outstandingAmount={metrics.outstanding}
          overdueAmount={metrics.overdue}
        />
      </div>

      {/* Breakdown Tabs */}
      <RevenueBreakdownTabs
        invoices={invoices || []}
        dateBreakdown={dateBreakdown}
        clientBreakdown={clientBreakdown}
      />

      {/* Set Goal Dialog */}
      <SetGoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        existingGoal={currentGoal}
        onSaved={handleGoalSaved}
      />
    </div>
  );
}
