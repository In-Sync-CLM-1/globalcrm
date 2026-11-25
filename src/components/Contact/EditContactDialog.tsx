import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContactCategories } from "@/hooks/useContactCategories";
import { useNotification } from "@/hooks/useNotification";
import { ContactEmails } from "./ContactEmails";
import { ContactPhones } from "./ContactPhones";
import { Separator } from "@/components/ui/separator";

interface PipelineStage {
  id: string;
  name: string;
  color: string;
}

interface Contact {
  id: string;
  org_id: string;
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
  linkedin_url: string | null;
  notes: string | null;
  pipeline_stage_id: string | null;
  category?: string | null;
}

interface EditContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  onContactUpdated?: () => void;
}

export function EditContactDialog({
  open,
  onOpenChange,
  contact,
  onContactUpdated,
}: EditContactDialogProps) {
  const notify = useNotification();
  const categories = useContactCategories(contact?.org_id);
  const [loading, setLoading] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    company: "",
    job_title: "",
    city: "",
    industry_type: "",
    nature_of_business: "",
    source: "",
    linkedin_url: "",
    notes: "",
    pipeline_stage_id: "",
    category: "",
  });

  useEffect(() => {
    const fetchPipelineStages = async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color")
        .eq("is_active", true)
        .order("stage_order");

      if (!error && data) {
        setPipelineStages(data);
      }
    };

    if (open) {
      fetchPipelineStages();
    }
  }, [open]);

  useEffect(() => {
    if (open && contact) {
      setFormData({
        first_name: contact.first_name,
        last_name: contact.last_name || "",
        company: contact.company || "",
        job_title: contact.job_title || "",
        city: contact.city || "",
        industry_type: contact.industry_type || "",
        nature_of_business: contact.nature_of_business || "",
        source: contact.source || "",
        linkedin_url: contact.linkedin_url || "",
        notes: contact.notes || "",
        pipeline_stage_id: contact.pipeline_stage_id || "",
        category: contact.category || "",
      });
    }
  }, [open, contact]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase
        .from("contacts")
        .update({
          first_name: formData.first_name,
          last_name: formData.last_name || null,
          company: formData.company || null,
          job_title: formData.job_title || null,
          city: formData.city || null,
          industry_type: formData.industry_type || null,
          nature_of_business: formData.nature_of_business || null,
          source: formData.source || null,
          linkedin_url: formData.linkedin_url || null,
          notes: formData.notes || null,
          pipeline_stage_id: formData.pipeline_stage_id || null,
          ...(categories.length > 0 ? { category: formData.category || null } : {}),
        })
        .eq("id", contact.id);

      if (error) throw error;

      notify.success("Contact updated", "Contact has been updated successfully");

      onOpenChange(false);
      if (onContactUpdated) onContactUpdated();
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="first_name" className="text-xs">First Name *</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                required
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="last_name" className="text-xs">Last Name</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                className="h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Email Addresses</Label>
              <ContactEmails contactId={contact.id} orgId={contact.org_id} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone Numbers</Label>
              <ContactPhones contactId={contact.id} orgId={contact.org_id} />
            </div>
          </div>

          <Separator className="my-2" />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="company" className="text-xs">Company</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="job_title" className="text-xs">Job Title</Label>
              <Input
                id="job_title"
                value={formData.job_title}
                onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                className="h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="city" className="text-xs">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Enter city"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="industry_type" className="text-xs">Industry Type</Label>
              <Select value={formData.industry_type} onValueChange={(value) => setFormData({ ...formData, industry_type: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manufacturing">Manufacturing</SelectItem>
                  <SelectItem value="it_software">IT/Software</SelectItem>
                  <SelectItem value="healthcare">Healthcare</SelectItem>
                  <SelectItem value="finance_banking">Finance/Banking</SelectItem>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="education">Education</SelectItem>
                  <SelectItem value="real_estate">Real Estate</SelectItem>
                  <SelectItem value="hospitality">Hospitality</SelectItem>
                  <SelectItem value="logistics">Logistics</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="nature_of_business" className="text-xs">Nature of Business</Label>
              <Select value={formData.nature_of_business} onValueChange={(value) => setFormData({ ...formData, nature_of_business: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select nature" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="b2b">B2B</SelectItem>
                  <SelectItem value="b2c">B2C</SelectItem>
                  <SelectItem value="b2b2c">B2B2C</SelectItem>
                  <SelectItem value="d2c">D2C</SelectItem>
                  <SelectItem value="government">Government</SelectItem>
                  <SelectItem value="non_profit">Non-Profit</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pipeline_stage" className="text-xs">Pipeline Stage</Label>
              <Select 
                value={formData.pipeline_stage_id} 
                onValueChange={(value) => setFormData({ ...formData, pipeline_stage_id: value })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {pipelineStages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="source" className="text-xs">Source</Label>
              <Input
                id="source"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder="e.g., Website"
                className="h-9"
              />
            </div>
          </div>

          {categories.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="category" className="text-xs">Category</Label>
              <Select value={formData.category || "none"} onValueChange={(value) => setFormData({ ...formData, category: value === "none" ? "" : value })}>
                <SelectTrigger id="category" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="linkedin_url" className="text-xs">LinkedIn Profile</Label>
              <Input
                id="linkedin_url"
                type="url"
                value={formData.linkedin_url}
                onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/in/..."
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes" className="text-xs">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={1}
                className="min-h-[36px] resize-none"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Updating..." : "Update Contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
