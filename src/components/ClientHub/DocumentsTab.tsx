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
import { Search, Plus, FileText, Download, ExternalLink, Trash2, Filter, Users, Building2, Contact } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { EntitySelector, SelectedEntity } from "./EntitySelector";
import { format } from "date-fns";
import { useUrlState } from "@/hooks/useUrlState";

const documentTypes = [
  { value: "contract", label: "Contract" },
  { value: "proposal", label: "Proposal" },
  { value: "agreement", label: "Agreement" },
  { value: "nda", label: "NDA" },
  { value: "specification", label: "Specification" },
  { value: "report", label: "Report" },
  { value: "other", label: "Other" },
];

export function DocumentsTab() {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [searchTerm, setSearchTerm] = useUrlState("dq", "");
  const [typeFilter, setTypeFilter] = useUrlState<string>("dtype", "all");
  const [entityTypeFilter, setEntityTypeFilter] = useUrlState<string>("dentity", "all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  // Form state
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [documentType, setDocumentType] = useState("other");
  const [description, setDescription] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch all documents with entity info
  const { data: documents, isLoading } = useQuery({
    queryKey: ["all-documents", effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      
      const { data, error } = await supabase
        .from("client_documents")
        .select(`
          *,
          client:clients(id, first_name, last_name, company),
          contact:contacts(id, first_name, last_name, company),
          external_entity:external_entities(id, name, company)
        `)
        .eq("org_id", effectiveOrgId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  // Filter documents
  const filteredDocuments = documents?.filter((doc) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      doc.document_name?.toLowerCase().includes(searchLower) ||
      doc.description?.toLowerCase().includes(searchLower);
    
    const matchesType = typeFilter === "all" || doc.document_type === typeFilter;
    
    let matchesEntityType = true;
    if (entityTypeFilter === "client") matchesEntityType = !!doc.client_id;
    else if (entityTypeFilter === "contact") matchesEntityType = !!doc.contact_id;
    else if (entityTypeFilter === "external") matchesEntityType = !!doc.external_entity_id;
    
    return matchesSearch && matchesType && matchesEntityType;
  });

  const getEntityInfo = (doc: any) => {
    if (doc.client) {
      return {
        type: "Client",
        name: `${doc.client.first_name} ${doc.client.last_name || ""}`.trim(),
        company: doc.client.company,
        icon: <Users className="h-3 w-3" />,
      };
    }
    if (doc.contact) {
      return {
        type: "Contact",
        name: `${doc.contact.first_name} ${doc.contact.last_name || ""}`.trim(),
        company: doc.contact.company,
        icon: <Contact className="h-3 w-3" />,
      };
    }
    if (doc.external_entity) {
      return {
        type: "External",
        name: doc.external_entity.name,
        company: doc.external_entity.company,
        icon: <Building2 className="h-3 w-3" />,
      };
    }
    return { type: "Unknown", name: "-", company: null, icon: null };
  };

  const addDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEntity || !effectiveOrgId) throw new Error("Please select an entity");
      
      setIsUploading(true);
      let fileUrl = null;

      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${selectedEntity.type}/${selectedEntity.id}/${Date.now()}.${fileExt}`;
        
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
        document_name: documentName,
        document_type: documentType,
        description,
        file_url: fileUrl,
        external_link: externalLink || null,
      };

      if (selectedEntity.type === "client") insertData.client_id = selectedEntity.id;
      else if (selectedEntity.type === "contact") insertData.contact_id = selectedEntity.id;
      else if (selectedEntity.type === "external") insertData.external_entity_id = selectedEntity.id;

      const { error } = await supabase.from("client_documents").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Document added", "The document has been added successfully");
      queryClient.invalidateQueries({ queryKey: ["all-documents"] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      notify.error("Error", error.message || "Failed to add document");
    },
    onSettled: () => {
      setIsUploading(false);
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase.from("client_documents").delete().eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Document deleted", "The document has been removed");
      queryClient.invalidateQueries({ queryKey: ["all-documents"] });
    },
    onError: () => {
      notify.error("Error", "Failed to delete document");
    },
  });

  const resetForm = () => {
    setSelectedEntity(null);
    setDocumentName("");
    setDocumentType("other");
    setDescription("");
    setExternalLink("");
    setFile(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentName) {
      notify.error("Error", "Document name is required");
      return;
    }
    if (!selectedEntity) {
      notify.error("Error", "Please select an entity");
      return;
    }
    if (!file && !externalLink) {
      notify.error("Error", "Please upload a file or provide an external link");
      return;
    }
    addDocumentMutation.mutate();
  };

  const stats = {
    total: documents?.length || 0,
    contracts: documents?.filter(d => d.document_type === "contract").length || 0,
    proposals: documents?.filter(d => d.document_type === "proposal").length || 0,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span>Total: <strong>{stats.total}</strong></span>
        <span>Contracts: <strong>{stats.contracts}</strong></span>
        <span>Proposals: <strong>{stats.proposals}</strong></span>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {documentTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
            <SelectTrigger className="w-[150px]">
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

        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Document
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Document</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <EntitySelector
                value={selectedEntity}
                onChange={setSelectedEntity}
                showCreateExternal
              />
              
              <div className="space-y-2">
                <Label>Document Name *</Label>
                <Input
                  value={documentName}
                  onChange={(e) => setDocumentName(e.target.value)}
                  placeholder="Enter document name"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Document Type</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description..."
                />
              </div>
              
              <div className="space-y-2">
                <Label>Upload File</Label>
                <Input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Or External Link</Label>
                <Input
                  value={externalLink}
                  onChange={(e) => setExternalLink(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              
              <Button type="submit" className="w-full" disabled={isUploading}>
                {isUploading ? "Uploading..." : "Add Document"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Documents Table */}
      {isLoading ? (
        <LoadingState message="Loading documents..." />
      ) : !filteredDocuments?.length ? (
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          title="No documents found"
          message="Add documents to keep track of important files"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Linked Entity</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Added Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc) => {
                  const entityInfo = getEntityInfo(doc);
                  const hasViewable = doc.file_url || doc.external_link;
                  
                  return (
                    <TableRow 
                      key={doc.id}
                      className={hasViewable ? "cursor-pointer hover:bg-muted/50" : ""}
                      onClick={() => {
                        if (doc.file_url) setViewingFile(doc.file_url);
                        else if (doc.external_link) window.open(doc.external_link, "_blank");
                      }}
                    >
                      <TableCell className="font-medium">{doc.document_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {documentTypes.find(t => t.value === doc.document_type)?.label || doc.document_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">{entityInfo.name}</div>
                          {entityInfo.company && (
                            <div className="text-xs text-muted-foreground">{entityInfo.company}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                          {entityInfo.icon}
                          {entityInfo.type}
                        </Badge>
                      </TableCell>
                      <TableCell>{format(new Date(doc.created_at), "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                        {doc.file_url && (
                          <Button variant="ghost" size="icon" asChild title="Download">
                            <a href={doc.file_url} download target="_blank" rel="noopener noreferrer">
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        {doc.external_link && (
                          <Button variant="ghost" size="icon" asChild title="Open Link">
                            <a href={doc.external_link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteDocumentMutation.mutate(doc.id)}
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
