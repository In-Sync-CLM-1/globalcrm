import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { RmplProjectPicker } from "./RmplProjectPicker";
import { Label } from "@/components/ui/label";

// Org that gets billed through RMPL OPM -- mirrors the DB-level check in
// 20260926100000_clients_rmpl_project_id.sql. Only these clients need an
// RMPL project reference to convert.
const RMPL_ORG_ID = "9b3528ad-8946-4f31-a1ca-1c8d3d782fb9";

interface Contact {
  id: string;
  org_id: string;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  job_title?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  notes?: string | null;
}

interface PotentialDuplicate {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  matchReason: string;
}

interface ConvertToClientButtonProps {
  contact: Contact;
  isWonStage: boolean;
  onConverted?: () => void;
}

export function ConvertToClientButton({ contact, isWonStage, onConverted }: ConvertToClientButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<PotentialDuplicate[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [rmplProjectId, setRmplProjectId] = useState<string | null>(null);
  const isRmplOrg = contact.org_id === RMPL_ORG_ID;
  const queryClient = useQueryClient();
  const notify = useNotification();
  const navigate = useNavigate();

  // Check for potential duplicates when dialog opens
  const { refetch: checkDuplicates, isLoading: isCheckingDuplicates } = useQuery({
    queryKey: ["check-client-duplicates", contact.id],
    queryFn: async () => {
      const potentialDuplicates: PotentialDuplicate[] = [];

      // Check by email
      if (contact.email) {
        const { data: emailMatches } = await supabase
          .from("clients")
          .select("id, first_name, last_name, email, phone, company")
          .eq("org_id", contact.org_id)
          .ilike("email", contact.email);

        emailMatches?.forEach(client => {
          if (!potentialDuplicates.find(d => d.id === client.id)) {
            potentialDuplicates.push({ ...client, matchReason: "Same email address" });
          }
        });
      }

      // Check by phone
      if (contact.phone) {
        const cleanPhone = contact.phone.replace(/\D/g, '');
        const { data: phoneMatches } = await supabase
          .from("clients")
          .select("id, first_name, last_name, email, phone, company")
          .eq("org_id", contact.org_id);

        phoneMatches?.forEach(client => {
          if (client.phone) {
            const clientCleanPhone = client.phone.replace(/\D/g, '');
            if (clientCleanPhone === cleanPhone && !potentialDuplicates.find(d => d.id === client.id)) {
              potentialDuplicates.push({ ...client, matchReason: "Same phone number" });
            }
          }
        });
      }

      // Check by name + company
      if (contact.first_name && contact.company) {
        const { data: nameMatches } = await supabase
          .from("clients")
          .select("id, first_name, last_name, email, phone, company")
          .eq("org_id", contact.org_id)
          .ilike("first_name", contact.first_name)
          .ilike("company", contact.company);

        nameMatches?.forEach(client => {
          if (!potentialDuplicates.find(d => d.id === client.id)) {
            potentialDuplicates.push({ ...client, matchReason: "Same name and company" });
          }
        });
      }

      return potentialDuplicates;
    },
    enabled: false,
  });

  const handleOpenDialog = async () => {
    setIsDialogOpen(true);
    const result = await checkDuplicates();
    if (result.data && result.data.length > 0) {
      setDuplicates(result.data);
      setShowDuplicateWarning(true);
    } else {
      setDuplicates([]);
      setShowDuplicateWarning(false);
    }
  };

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (isRmplOrg && !rmplProjectId) {
        throw new Error("Select the RMPL project this client will be billed under before converting");
      }

      const { data: user } = await supabase.auth.getUser();

      // Check if this specific contact was already converted
      const { data: existingClient } = await supabase
        .from("clients")
        .select("id")
        .eq("contact_id", contact.id)
        .single();

      if (existingClient) {
        throw new Error("This contact has already been converted to a client");
      }

      const { error } = await supabase
        .from("clients")
        .insert({
          org_id: contact.org_id,
          contact_id: contact.id,
          converted_by: user.user?.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          phone: contact.phone,
          company: contact.company,
          job_title: contact.job_title,
          address: contact.address,
          city: contact.city,
          state: contact.state,
          country: contact.country,
          postal_code: contact.postal_code,
          notes: contact.notes,
          status: 'active',
          ...(isRmplOrg ? { rmpl_project_id: rmplProjectId } : {}),
        });

      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Client created", `${contact.first_name} ${contact.last_name || ""} has been converted to a client`);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client-contact-ids"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-contacts"] });
      setIsDialogOpen(false);
      setShowDuplicateWarning(false);
      setRmplProjectId(null);
      onConverted?.();
    },
    onError: (error: Error) => {
      notify.error("Error", error.message || "Failed to convert to client");
    },
  });

  const handleLinkToExisting = (clientId: string) => {
    setIsDialogOpen(false);
    navigate(`/client/${clientId}`);
  };

  if (!isWonStage) {
    return null;
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={handleOpenDialog}
              className="h-8 w-8 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 text-emerald-600"
            >
              <UserCheck className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Convert to Client</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {showDuplicateWarning ? (
                <span className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                  Potential Duplicate Found
                </span>
              ) : (
                "Convert to Client"
              )}
            </DialogTitle>
            <DialogDescription>
              {showDuplicateWarning ? (
                "We found existing clients with similar information. Would you like to link to an existing client or create a new one anyway?"
              ) : (
                <>
                  This will create a client record for <strong>{contact.first_name} {contact.last_name}</strong> 
                  in the Client Hub. All contact details will be copied to the new client record.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {isCheckingDuplicates ? (
            <div className="py-6 text-center text-muted-foreground">
              Checking for duplicates...
            </div>
          ) : showDuplicateWarning && duplicates.length > 0 ? (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {duplicates.map((duplicate) => (
                <Card key={duplicate.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">
                          {duplicate.first_name} {duplicate.last_name}
                        </p>
                        <div className="text-sm text-muted-foreground">
                          {duplicate.email && <span>{duplicate.email}</span>}
                          {duplicate.phone && <span> • {duplicate.phone}</span>}
                        </div>
                        {duplicate.company && (
                          <p className="text-sm text-muted-foreground">{duplicate.company}</p>
                        )}
                        <Badge variant="outline" className="mt-2 text-xs">
                          {duplicate.matchReason}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleLinkToExisting(duplicate.id)}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {!isCheckingDuplicates && isRmplOrg && (
            <div className="space-y-2">
              <Label>
                RMPL Project ID <span className="text-destructive">*</span>
              </Label>
              <RmplProjectPicker value={rmplProjectId} onChange={setRmplProjectId} />
              <p className="text-xs text-muted-foreground">
                The RMPL OPM project where this client's billing will happen. Required to mark this client Won.
              </p>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending || isCheckingDuplicates || (isRmplOrg && !rmplProjectId)}
              variant={showDuplicateWarning ? "secondary" : "default"}
            >
              {convertMutation.isPending
                ? "Converting..."
                : showDuplicateWarning
                  ? "Create Anyway"
                  : "Convert to Client"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
