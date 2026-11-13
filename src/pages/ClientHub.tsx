import { useState } from "react";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, FileText, Receipt, Building2, Calculator } from "lucide-react";
import { ClientsTab } from "@/components/ClientHub/ClientsTab";
import { DocumentsTab } from "@/components/ClientHub/DocumentsTab";
import { InvoicesTab } from "@/components/ClientHub/InvoicesTab";
import { ExternalEntitiesTab } from "@/components/ClientHub/ExternalEntitiesTab";
import { TaxesTab } from "@/components/ClientHub/TaxesTab";
import { useUrlState } from "@/hooks/useUrlState";

export default function ClientHub() {
  const [activeTab, setActiveTab] = useUrlState("tab", "clients");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Client Hub</h1>
          <p className="text-muted-foreground">
            Manage clients, documents, invoices, and external entities in one place
          </p>
        </div>

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid grid-cols-5 w-full max-w-3xl">
            <TabsTrigger value="clients" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Clients</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="invoices" className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              <span className="hidden sm:inline">Invoices</span>
            </TabsTrigger>
            <TabsTrigger value="taxes" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              <span className="hidden sm:inline">Taxes</span>
            </TabsTrigger>
            <TabsTrigger value="external" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">External</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clients">
            <ClientsTab />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab />
          </TabsContent>

          <TabsContent value="invoices">
            <InvoicesTab />
          </TabsContent>

          <TabsContent value="taxes">
            <TaxesTab />
          </TabsContent>

          <TabsContent value="external">
            <ExternalEntitiesTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
