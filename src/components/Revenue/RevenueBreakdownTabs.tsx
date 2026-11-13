import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Calendar, Users, FileText } from "lucide-react";
import { format } from "date-fns";
import { UrlTabs } from "@/components/UrlTabs";
import { useUrlState } from "@/hooks/useUrlState";

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  status: string;
  due_date?: string;
  client?: {
    first_name: string;
    last_name?: string;
    company?: string;
  };
}

interface DateBreakdown {
  date: string;
  invoiced: number;
  received: number;
  count: number;
  clients?: string[];
}

interface ClientBreakdown {
  clientId: string;
  clientName: string;
  company?: string;
  totalInvoiced: number;
  totalPaid: number;
  invoiceCount: number;
}

interface RevenueBreakdownTabsProps {
  invoices: Invoice[];
  dateBreakdown: DateBreakdown[];
  clientBreakdown: ClientBreakdown[];
  currency?: string;
}

const formatCurrency = (amount: number, currency: string = "INR") => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getStatusBadge = (status: string) => {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    paid: { variant: "default", label: "Paid" },
    pending: { variant: "secondary", label: "Pending" },
    overdue: { variant: "destructive", label: "Overdue" },
    draft: { variant: "outline", label: "Draft" },
  };
  const config = variants[status] || { variant: "outline", label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

export function RevenueBreakdownTabs({
  invoices,
  dateBreakdown,
  clientBreakdown,
  currency = "INR",
}: RevenueBreakdownTabsProps) {
  const [searchTerm, setSearchTerm] = useUrlState("revq", "");

  const filteredInvoices = invoices.filter((inv) => {
    const search = searchTerm.toLowerCase();
    return (
      inv.invoice_number.toLowerCase().includes(search) ||
      inv.client?.first_name?.toLowerCase().includes(search) ||
      inv.client?.company?.toLowerCase().includes(search)
    );
  });

  const filteredClients = clientBreakdown.filter((client) => {
    const search = searchTerm.toLowerCase();
    return (
      client.clientName.toLowerCase().includes(search) ||
      client.company?.toLowerCase().includes(search)
    );
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Revenue Breakdown</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <UrlTabs param="revenuebreakdowntabs_tab" defaultValue="by-date">
          <TabsList className="mb-4">
            <TabsTrigger value="by-date" className="gap-2">
              <Calendar className="h-4 w-4" />
              By Date
            </TabsTrigger>
            <TabsTrigger value="by-client" className="gap-2">
              <Users className="h-4 w-4" />
              By Client
            </TabsTrigger>
            <TabsTrigger value="by-invoice" className="gap-2">
              <FileText className="h-4 w-4" />
              By Invoice
            </TabsTrigger>
          </TabsList>

          <TabsContent value="by-date">
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client / Company</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dateBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    dateBreakdown.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell className="font-medium">
                          {format(new Date(row.date), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          {row.clients && row.clients.length > 0 ? (
                            <span className="truncate block" title={row.clients.join(", ")}>
                              {row.clients.slice(0, 2).join(", ")}
                              {row.clients.length > 2 && (
                                <span className="text-muted-foreground"> +{row.clients.length - 2} more</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.invoiced, currency)}</TableCell>
                        <TableCell className="text-right text-emerald-600">
                          {formatCurrency(row.received, currency)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="by-client">
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Total Invoiced</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No clients found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClients.map((client) => (
                      <TableRow key={client.clientId}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{client.clientName}</p>
                            {client.company && (
                              <p className="text-sm text-muted-foreground">{client.company}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{client.invoiceCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(client.totalInvoiced, currency)}</TableCell>
                        <TableCell className="text-right text-emerald-600">
                          {formatCurrency(client.totalPaid, currency)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="by-invoice">
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No invoices found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                        <TableCell>
                          {invoice.client?.first_name} {invoice.client?.last_name}
                          {invoice.client?.company && (
                            <span className="text-muted-foreground"> • {invoice.client.company}</span>
                          )}
                        </TableCell>
                        <TableCell>{format(new Date(invoice.invoice_date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="text-right">{formatCurrency(invoice.amount, currency)}</TableCell>
                        <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </UrlTabs>
      </CardContent>
    </Card>
  );
}
