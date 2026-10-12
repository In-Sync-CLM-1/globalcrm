import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { TrendingUp, DollarSign, AlertTriangle, FileCheck, Clock, CalendarDays, X } from "lucide-react";
import { startOfMonth, subMonths, startOfQuarter, startOfYear, isAfter, format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/useUrlState";

interface RevenueAnalyticsProps {
  invoices: any[];
}

type DurationOption = "3months" | "6months" | "12months" | "thisQuarter" | "thisYear" | "all";
type CategoryType = "invoiced" | "received" | "outstanding" | "overdue" | "quotations" | null;

export function RevenueAnalytics({ invoices }: RevenueAnalyticsProps) {
  const [duration, setDuration] = useUrlState<DurationOption>("rev", "6months");
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>(null);
  
  // Get date range based on selected duration
  const getDateRange = () => {
    const now = new Date();
    switch (duration) {
      case "3months":
        return { start: startOfMonth(subMonths(now, 2)), label: "Last 3 Months" };
      case "6months":
        return { start: startOfMonth(subMonths(now, 5)), label: "Last 6 Months" };
      case "12months":
        return { start: startOfMonth(subMonths(now, 11)), label: "Last 12 Months" };
      case "thisQuarter":
        return { start: startOfQuarter(now), label: "This Quarter" };
      case "thisYear":
        return { start: startOfYear(now), label: "This Year (YTD)" };
      case "all":
        return { start: new Date(0), label: "All Time" };
      default:
        return { start: startOfMonth(subMonths(now, 5)), label: "Last 6 Months" };
    }
  };

  const { start: rangeStart, label: rangeLabel } = getDateRange();

  // Filter invoices by date range
  const filterByDateRange = (inv: any) => {
    const invDate = new Date(inv.invoice_date);
    return isAfter(invDate, rangeStart) || invDate.getTime() === rangeStart.getTime();
  };

  // Calculate totals (only for invoices, not quotations)
  const allInvoicesOnly = invoices?.filter((inv) => inv.document_type !== "quotation") || [];
  const allQuotationsOnly = invoices?.filter((inv) => inv.document_type === "quotation") || [];
  
  const invoicesOnly = allInvoicesOnly.filter(filterByDateRange);
  const quotationsOnly = allQuotationsOnly.filter(filterByDateRange);

  const totalInvoiced = invoicesOnly.reduce((sum, inv) => sum + (inv.amount || 0) + (inv.tax_amount || 0), 0);
  const totalPaid = invoicesOnly
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + (inv.amount || 0) + (inv.tax_amount || 0), 0);
  const totalOutstanding = invoicesOnly
    .filter((inv) => inv.status !== "paid" && inv.status !== "cancelled")
    .reduce((sum, inv) => sum + (inv.amount || 0) + (inv.tax_amount || 0), 0);
  const totalOverdue = invoicesOnly
    .filter((inv) => inv.status === "overdue")
    .reduce((sum, inv) => sum + (inv.amount || 0) + (inv.tax_amount || 0), 0);
  const quotationsValue = quotationsOnly.reduce((sum, inv) => sum + (inv.amount || 0) + (inv.tax_amount || 0), 0);

  // Monthly trend data - respects the selected date range
  const getMonthlyData = () => {
    const monthlyMap = new Map<string, { invoiced: number; paid: number }>();
    
    invoicesOnly.forEach((inv) => {
      const date = new Date(inv.invoice_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { invoiced: 0, paid: 0 });
      }
      
      const entry = monthlyMap.get(monthKey)!;
      const amount = (inv.amount || 0) + (inv.tax_amount || 0);
      entry.invoiced += amount;
      if (inv.status === "paid") {
        entry.paid += amount;
      }
    });

    // Sort chronologically
    return Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: format(new Date(month + "-01"), "MMM yy"),
        invoiced: data.invoiced,
        paid: data.paid,
      }));
  };

  const monthlyData = getMonthlyData();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const chartConfig = {
    invoiced: {
      label: "Invoiced",
      color: "hsl(var(--primary))",
    },
    paid: {
      label: "Paid",
      color: "hsl(var(--chart-2))",
    },
  };

  // Get filtered invoices for detail view
  const getFilteredInvoices = () => {
    switch (selectedCategory) {
      case "invoiced":
        return invoicesOnly;
      case "received":
        return invoicesOnly.filter((inv) => inv.status === "paid");
      case "outstanding":
        return invoicesOnly.filter((inv) => inv.status !== "paid" && inv.status !== "cancelled");
      case "overdue":
        return invoicesOnly.filter((inv) => inv.status === "overdue");
      case "quotations":
        return quotationsOnly;
      default:
        return [];
    }
  };

  const getCategoryTitle = () => {
    switch (selectedCategory) {
      case "invoiced":
        return "All Invoices";
      case "received":
        return "Received Payments";
      case "outstanding":
        return "Outstanding Invoices";
      case "overdue":
        return "Overdue Invoices";
      case "quotations":
        return "Quotations";
      default:
        return "";
    }
  };

  const getEntityName = (inv: any) => {
    if (inv.client?.company) return inv.client.company;
    if (inv.client?.first_name) return `${inv.client.first_name} ${inv.client.last_name || ""}`.trim();
    if (inv.contact?.company) return inv.contact.company;
    if (inv.contact?.first_name) return `${inv.contact.first_name} ${inv.contact.last_name || ""}`.trim();
    if (inv.external_entity?.name) return inv.external_entity.name;
    if (inv.external_entity?.company) return inv.external_entity.company;
    return "Unknown";
  };

  const filteredInvoices = getFilteredInvoices();

  return (
    <div className="space-y-4">
      {/* Duration Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          <span>Showing: {rangeLabel}</span>
        </div>
        <Select value={duration} onValueChange={(val) => setDuration(val as DurationOption)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select duration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3months">Last 3 Months</SelectItem>
            <SelectItem value="6months">Last 6 Months</SelectItem>
            <SelectItem value="12months">Last 12 Months</SelectItem>
            <SelectItem value="thisQuarter">This Quarter</SelectItem>
            <SelectItem value="thisYear">This Year (YTD)</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards - Always full width */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md",
            selectedCategory === "invoiced" 
              ? "border-primary ring-2 ring-primary/20" 
              : "hover:border-primary/50"
          )}
          onClick={() => setSelectedCategory("invoiced")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invoiced</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(totalInvoiced)}</div>
            <p className="text-xs text-muted-foreground">{invoicesOnly.length} invoices</p>
          </CardContent>
        </Card>

        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md",
            selectedCategory === "received" 
              ? "border-green-500 ring-2 ring-green-500/20" 
              : "hover:border-green-500/50"
          )}
          onClick={() => setSelectedCategory("received")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Received</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-green-600">{formatCurrency(totalPaid)}</div>
            <p className="text-xs text-muted-foreground">
              {totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0}% collection rate
            </p>
          </CardContent>
        </Card>

        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md",
            selectedCategory === "outstanding" 
              ? "border-orange-500 ring-2 ring-orange-500/20" 
              : "hover:border-orange-500/50"
          )}
          onClick={() => setSelectedCategory("outstanding")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-orange-500">{formatCurrency(totalOutstanding)}</div>
            <p className="text-xs text-muted-foreground">Pending payment</p>
          </CardContent>
        </Card>

        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md",
            selectedCategory === "overdue" 
              ? "border-destructive ring-2 ring-destructive/20" 
              : "hover:border-destructive/50"
          )}
          onClick={() => setSelectedCategory("overdue")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-destructive">{formatCurrency(totalOverdue)}</div>
            <p className="text-xs text-muted-foreground">Past due date</p>
          </CardContent>
        </Card>

        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-md",
            selectedCategory === "quotations" 
              ? "border-blue-500 ring-2 ring-blue-500/20" 
              : "hover:border-blue-500/50"
          )}
          onClick={() => setSelectedCategory("quotations")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Quotations</CardTitle>
            <FileCheck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-blue-500">{formatCurrency(quotationsValue)}</div>
            <p className="text-xs text-muted-foreground">{quotationsOnly.length} pending</p>
          </CardContent>
        </Card>
      </div>

      {/* Detail Section - Appears below cards when category selected */}
      {selectedCategory && (
        <Card className="animate-in fade-in slide-in-from-top-2 duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg font-semibold">{getCategoryTitle()}</CardTitle>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setSelectedCategory(null)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {filteredInvoices.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 px-6">No records found</p>
            ) : (
              <ScrollArea className="max-h-[350px]">
                <div className="px-6 pb-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>Date</TableHead>
                        {selectedCategory === "overdue" && <TableHead>Days</TableHead>}
                        {selectedCategory === "outstanding" && <TableHead>Due</TableHead>}
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInvoices.map((inv) => {
                        const amount = (inv.amount || 0) + (inv.tax_amount || 0);
                        const daysOverdue = inv.due_date && inv.status === "overdue" 
                          ? differenceInDays(new Date(), new Date(inv.due_date))
                          : 0;
                        
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium text-xs">{inv.invoice_number}</TableCell>
                            <TableCell className="text-xs max-w-[150px] truncate">{getEntityName(inv)}</TableCell>
                            <TableCell className="text-xs">{format(new Date(inv.invoice_date), "dd MMM yy")}</TableCell>
                            {selectedCategory === "overdue" && (
                              <TableCell className="text-destructive font-medium text-xs">
                                {daysOverdue}d
                              </TableCell>
                            )}
                            {selectedCategory === "outstanding" && (
                              <TableCell className="text-xs">
                                {inv.due_date ? format(new Date(inv.due_date), "dd MMM") : "-"}
                              </TableCell>
                            )}
                            <TableCell className="text-right text-xs font-medium">{formatCurrency(amount)}</TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                inv.status === "paid" 
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                  : inv.status === "overdue"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                              }`}>
                                {inv.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {/* Monthly Trend Chart - Always visible */}
      {monthlyData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue Trend ({rangeLabel})</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false}
                  tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
                />
                <ChartTooltip 
                  content={<ChartTooltipContent />}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="paid" fill="var(--color-paid)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
