import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useNotification } from "@/hooks/useNotification";
import { useContactCategories } from "@/hooks/useContactCategories";
import { useOrgContext } from "@/hooks/useOrgContext";
import { InlineEmailInput, EmailEntry, InlineEmailInputHandle } from "./InlineEmailInput";
import { InlinePhoneInput, PhoneEntry, InlinePhoneInputHandle } from "./InlinePhoneInput";

interface PipelineStage {
  id: string;
  name: string;
  color: string;
}

interface User {
  id: string;
  first_name: string;
  last_name: string;
}

interface CreateContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContactCreated?: () => void;
}

export function CreateContactDialog({
  open,
  onOpenChange,
  onContactCreated,
}: CreateContactDialogProps) {
  const notify = useNotification();
  const { effectiveOrgId } = useOrgContext();
  const categories = useContactCategories(effectiveOrgId);
  const [loading, setLoading] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const emailInputRef = useRef<InlineEmailInputHandle>(null);
  const phoneInputRef = useRef<InlinePhoneInputHandle>(null);
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
    pipeline_stage_id: "",
    category: "",
    assigned_to: "",
    notes: "",
  });

  useEffect(() => {
    if (open) {
      fetchPipelineStages();
      fetchUsers();
      // Auto-assign to creator
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          setFormData(prev => ({ ...prev, assigned_to: user.id }));
        }
      });
    } else {
      // Reset form when dialog closes
      resetForm();
    }
  }, [open, effectiveOrgId]);

  const fetchPipelineStages = async () => {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("id, name, color")
      .eq("is_active", true)
      .order("stage_order");

    if (!error && data) {
      setPipelineStages(data);
      // Default to "New" stage if available
      const newStage = data.find(s => s.name.toLowerCase() === 'new');
      if (newStage) {
        setFormData(prev => ({ ...prev, pipeline_stage_id: newStage.id }));
      }
    }
  };

  const fetchUsers = async () => {
    if (!effectiveOrgId) return;
    
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("org_id", effectiveOrgId)
      .order("first_name");

    if (!error && data) {
      setUsers(data);
    }
  };

  const resetForm = () => {
    setFormData({
      first_name: "",
      last_name: "",
      company: "",
      job_title: "",
      city: "",
      industry_type: "",
      nature_of_business: "",
      source: "",
      linkedin_url: "",
      pipeline_stage_id: "",
      category: "",
      assigned_to: "",
      notes: "",
    });
    setEmails([]);
    setPhones([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!profile?.org_id) throw new Error("Organization not found");

      // Include any typed-but-uncommitted entry from the inline widgets so a user
      // who skips the "+" button before hitting Create doesn't lose the value.
      const finalEmails = emailInputRef.current?.getFinalEmails() ?? emails;
      const finalPhones = phoneInputRef.current?.getFinalPhones() ?? phones;

      // Get primary email and phone for the main contact record
      const primaryEmail = finalEmails.find(e => e.is_primary)?.email || finalEmails[0]?.email || null;
      const primaryPhone = finalPhones.find(p => p.is_primary)?.phone || finalPhones[0]?.phone || null;

      const contactData = {
        first_name: formData.first_name,
        last_name: formData.last_name || null,
        email: primaryEmail,
        phone: primaryPhone,
        company: formData.company || null,
        job_title: formData.job_title || null,
        city: formData.city || null,
        industry_type: formData.industry_type || null,
        nature_of_business: formData.nature_of_business || null,
        status: "new",
        source: formData.source || null,
        linkedin_url: formData.linkedin_url || null,
        pipeline_stage_id: formData.pipeline_stage_id || null,
        assigned_to: formData.assigned_to || null,
        ...(categories.length > 0 ? { category: formData.category || null } : {}),
        notes: formData.notes || null,
        org_id: profile.org_id,
        created_by: user.id,
      };

      const { data: newContact, error } = await supabase
        .from("contacts")
        .insert([contactData])
        .select()
        .single();

      if (error) throw error;

      // Save additional emails to contact_emails table
      if (finalEmails.length > 0 && newContact) {
        const emailInserts = finalEmails.map(e => ({
          contact_id: newContact.id,
          org_id: profile.org_id,
          email: e.email,
          email_type: e.email_type,
          is_primary: e.is_primary,
        }));

        const { error: emailErr } = await supabase.from("contact_emails").insert(emailInserts);
        if (emailErr) throw emailErr;
      }

      // Save additional phones to contact_phones table
      if (finalPhones.length > 0 && newContact) {
        const phoneInserts = finalPhones.map(p => ({
          contact_id: newContact.id,
          org_id: profile.org_id,
          phone: p.phone,
          phone_type: p.phone_type,
          is_primary: p.is_primary,
        }));

        const { error: phoneErr } = await supabase.from("contact_phones").insert(phoneInserts);
        if (phoneErr) throw phoneErr;
      }

      notify.success("Contact created", "New contact has been added successfully");
      onOpenChange(false);
      onContactCreated?.();
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
          <DialogTitle>Add New Contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Row 1: First Name | Last Name */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="first_name" className="text-xs">First Name *</Label>
              <Input
                id="first_name"
                className="h-9"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="last_name" className="text-xs">Last Name</Label>
              <Input
                id="last_name"
                className="h-9"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              />
            </div>
          </div>

          {/* Row 2: Email Addresses | Phone Numbers (side-by-side) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Email Addresses</Label>
              <InlineEmailInput ref={emailInputRef} emails={emails} onChange={setEmails} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone Numbers</Label>
              <InlinePhoneInput ref={phoneInputRef} phones={phones} onChange={setPhones} />
            </div>
          </div>

          <Separator className="my-2" />

          {/* Row 3: Company | Job Title */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="company" className="text-xs">Company</Label>
              <Input
                id="company"
                className="h-9"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="job_title" className="text-xs">Job Title</Label>
              <Input
                id="job_title"
                className="h-9"
                value={formData.job_title}
                onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
              />
            </div>
          </div>

          {/* Row 4: City | Industry Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="city" className="text-xs">City</Label>
              <Input
                id="city"
                className="h-9"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Enter city"
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

          {/* Row 5: Nature of Business | Pipeline Stage | Source (3-column) */}
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
              <Select value={formData.pipeline_stage_id} onValueChange={(value) => setFormData({ ...formData, pipeline_stage_id: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {pipelineStages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
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
                className="h-9"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder="e.g., Website"
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

          {/* Row 6: Assign To | LinkedIn Profile (2-column) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="assigned_to" className="text-xs">Assign To</Label>
              <Select value={formData.assigned_to} onValueChange={(value) => setFormData({ ...formData, assigned_to: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.first_name} {user.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="linkedin_url" className="text-xs">LinkedIn Profile</Label>
              <Input
                id="linkedin_url"
                className="h-9"
                type="url"
                value={formData.linkedin_url}
                onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/in/..."
              />
            </div>
          </div>

          {/* Row 7: Notes (compact single row) */}
          <div className="space-y-1">
            <Label htmlFor="notes" className="text-xs">Notes</Label>
            <Textarea
              id="notes"
              className="min-h-[36px]"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={1}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Creating..." : "Create Contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
