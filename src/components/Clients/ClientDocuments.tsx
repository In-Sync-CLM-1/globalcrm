import { useState } from "react";
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
import { Plus, FileText, Trash2, Download, ExternalLink } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { EmptyState } from "@/components/common/EmptyState";
import { format } from "date-fns";

interface ClientDocumentsProps {
  clientId: string;
  orgId: string;
}

const documentTypes = [
  { value: "contract", label: "Contract" },
  { value: "proposal", label: "Proposal" },
  { value: "agreement", label: "Agreement" },
  { value: "specification", label: "Specification" },
  { value: "report", label: "Report" },
  { value: "other", label: "Other" },
];

export function ClientDocuments({ clientId, orgId }: ClientDocumentsProps) {
  const queryClient = useQueryClient();
  const notify = useNotification();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const viewingLink = useSignedFileUrl(viewingFile);
  const [documentName, setDocumentName] = useState("");
  const [documentType, setDocumentType] = useState("other");
  const [description, setDescription] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["client-documents", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_documents")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const addDocumentMutation = useMutation({
    mutationFn: async () => {
      setIsUploading(true);
      let fileUrl = null;

      if (file) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${orgId}/${clientId}/${Date.now()}.${fileExt}`;
        
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
        .from("client_documents")
        .insert({
          client_id: clientId,
          org_id: orgId,
          document_name: documentName,
          document_type: documentType,
          description,
          file_url: fileUrl,
          external_link: externalLink || null,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Document added", "The document has been added successfully");
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
      resetForm();
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      console.error("Failed to add document:", error);
      notify.error("Error", error.message || "Failed to add document");
    },
    onSettled: () => {
      setIsUploading(false);
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from("client_documents")
        .delete()
        .eq("id", documentId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Document deleted", "The document has been removed");
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
    },
    onError: () => {
      notify.error("Error", "Failed to delete document");
    },
  });

  const resetForm = () => {
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
    if (!file && !externalLink) {
      notify.error("Error", "Please upload a file or provide an external link");
      return;
    }
    addDocumentMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Document</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
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
      </CardHeader>
      <CardContent>
        {!documents?.length ? (
          <EmptyState
            icon={<FileText className="h-12 w-12" />}
            title="No documents"
            message="Add documents to keep track of important files for this client"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Added On</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => {
                const hasViewable = doc.file_url || doc.external_link;
                const handleRowClick = () => {
                  if (doc.file_url) {
                    setViewingFile(doc.file_url);
                  } else if (doc.external_link) {
                    window.open(doc.external_link, "_blank");
                  }
                };
                return (
                  <TableRow 
                    key={doc.id}
                    className={hasViewable ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={hasViewable ? handleRowClick : undefined}
                  >
                    <TableCell className="font-medium">{doc.document_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {documentTypes.find((t) => t.value === doc.document_type)?.label || doc.document_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {doc.description || "-"}
                    </TableCell>
                    <TableCell>{format(new Date(doc.created_at), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      {doc.file_url && (
                        <Button variant="ghost" size="icon" asChild title="Download">
                          <a href="#" onClick={(e) => { e.preventDefault(); openStoredFile(doc.file_url, true); }}>
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
        )}
      </CardContent>

      {/* Document Viewer Dialog */}
      <Dialog open={!!viewingFile} onOpenChange={(open) => !open && setViewingFile(null)}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Document Viewer</DialogTitle>
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
