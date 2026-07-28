import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { IEDUP_ORG_ID } from "@/hooks/useIsIedup";
import { useNotification } from "@/hooks/useNotification";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Phone, MessageSquare, Mail } from "lucide-react";

type Channel = "call" | "whatsapp" | "email";

interface WhatsAppTemplate {
  id: string;
  template_name: string;
  content: string;
  header_type: string | null;
  header_content: string | null;
  footer_text: string | null;
  buttons: Array<{ type: string; text: string }> | null;
  category: string | null;
}

interface EmailTemplateRow {
  id: string;
  name: string;
  subject: string;
  body_content: string | null;
  html_content: string | null;
}

interface StageActionRow {
  id: string;
  action_type: Channel;
  template_name: string | null;
  language_code: string | null;
  whatsapp_template_id: string | null;
  email_template_id: string | null;
}

interface StageActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: { id: string; name: string };
  existing: StageActionRow | null;
  onSaved: () => void;
}

// Fill {{1}}, {{2}}… with a generic sample so the preview reads naturally —
// this is a template-level preview, not a per-contact send, so there's no
// real contact to pull values from.
function withSampleValues(text: string): string {
  return (text || "").replace(/\{\{\s*\d+\s*\}\}/g, "प्रतिभागी / Name");
}

export function StageActionDialog({ open, onOpenChange, stage, existing, onSaved }: StageActionDialogProps) {
  const notify = useNotification();
  const [channel, setChannel] = useState<Channel>("call");
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplate[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannel(existing?.action_type ?? "call");
    setSelectedTemplateId(
      existing?.action_type === "whatsapp"
        ? existing.whatsapp_template_id ?? ""
        : existing?.action_type === "email"
          ? existing.email_template_id ?? ""
          : "",
    );
    void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage.id]);

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const [waRes, emailRes] = await Promise.all([
        supabase
          .from("communication_templates")
          .select("id, template_name, content, header_type, header_content, footer_text, buttons, category")
          .eq("org_id", IEDUP_ORG_ID)
          .eq("template_type", "whatsapp")
          .eq("status", "approved")
          .order("template_name"),
        supabase
          .from("email_templates")
          .select("id, name, subject, body_content, html_content")
          .eq("org_id", IEDUP_ORG_ID)
          .eq("is_active", true)
          .order("name"),
      ]);
      setWhatsappTemplates((waRes.data || []) as unknown as WhatsAppTemplate[]);
      setEmailTemplates((emailRes.data || []) as unknown as EmailTemplateRow[]);
    } catch (err: any) {
      notify.error("Could not load templates", err.message);
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function handleSave() {
    if (channel !== "call" && !selectedTemplateId) {
      notify.error("Pick a template", `Choose an approved ${channel} template before saving.`);
      return;
    }
    setSaving(true);
    try {
      const waTemplate = channel === "whatsapp" ? whatsappTemplates.find((t) => t.id === selectedTemplateId) : null;
      const row = {
        org_id: IEDUP_ORG_ID,
        stage_id: stage.id,
        action_type: channel,
        is_active: true,
        // Legacy fields the dispatcher still reads today — kept in sync so
        // sending never breaks while the dispatcher migrates to the FK lookup.
        template_name: channel === "whatsapp" ? waTemplate?.template_name ?? null : null,
        language_code: "en",
        whatsapp_template_id: channel === "whatsapp" ? selectedTemplateId : null,
        email_template_id: channel === "email" ? selectedTemplateId : null,
      };
      const { error } = await supabase
        .from("pipeline_stage_actions")
        .upsert(row, { onConflict: "stage_id" });
      if (error) throw error;
      notify.success("Saved", `${stage.name} now uses ${channel === "call" ? "Call" : channel === "whatsapp" ? "WhatsApp" : "Email"}.`);
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      notify.error("Could not save", err.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedWhatsApp = whatsappTemplates.find((t) => t.id === selectedTemplateId);
  const selectedEmail = emailTemplates.find((t) => t.id === selectedTemplateId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Configure: {stage.name}</DialogTitle>
          <DialogDescription>
            Pick the channel this stage sends on, then the approved template. The preview shows exactly what goes out.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 py-2 flex-1 overflow-hidden">
          {/* LEFT — controls */}
          <div className="space-y-4 overflow-y-auto px-1 min-w-0">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v: Channel) => { setChannel(v); setSelectedTemplateId(""); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">
                    <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4" /> Call</span>
                  </SelectItem>
                  <SelectItem value="whatsapp">
                    <span className="inline-flex items-center gap-2"><MessageSquare className="h-4 w-4" /> WhatsApp</span>
                  </SelectItem>
                  <SelectItem value="email">
                    <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" /> Email</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {channel === "call" && (
              <p className="text-sm text-muted-foreground">
                This stage places an AI voice call using the org's default calling agent — no template needed.
              </p>
            )}

            {channel === "whatsapp" && (
              <div className="space-y-2">
                <Label>Approved WhatsApp template</Label>
                {loadingTemplates ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : whatsappTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No approved WhatsApp templates found for IEDUP. Create or sync one on the Templates page first.
                  </p>
                ) : (
                  <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {whatsappTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {channel === "email" && (
              <div className="space-y-2">
                <Label>Active email template</Label>
                {loadingTemplates ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : emailTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active email templates found for IEDUP. Create one on the Templates page first.
                  </p>
                ) : (
                  <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — live preview */}
          <div className="hidden lg:block">
            <Label className="text-xs text-muted-foreground mb-2 block">
              Preview (what the contact will receive)
            </Label>
            {channel === "whatsapp" && (
              <div className="bg-[#ECE5DD] p-4 rounded-md border border-[#d6cfc6] h-full min-h-[300px] flex items-start">
                {selectedWhatsApp ? (
                  <div className="bg-white rounded-lg shadow-sm p-3 w-full max-w-[320px] relative text-sm text-[#111B21]">
                    {selectedWhatsApp.header_type === "text" && selectedWhatsApp.header_content && (
                      <div className="font-semibold mb-1 whitespace-pre-wrap">{withSampleValues(selectedWhatsApp.header_content)}</div>
                    )}
                    <div className="whitespace-pre-wrap leading-snug break-words">
                      {withSampleValues(selectedWhatsApp.content)}
                    </div>
                    {selectedWhatsApp.footer_text && (
                      <div className="text-xs text-[#667781] mt-2">{selectedWhatsApp.footer_text}</div>
                    )}
                    {Array.isArray(selectedWhatsApp.buttons) && selectedWhatsApp.buttons.length > 0 && (
                      <div className="-mx-3 mt-2 border-t border-[#E9EDEF]">
                        {selectedWhatsApp.buttons.map((btn, i) => (
                          <div key={i} className="text-center text-[#00A5F4] py-2 text-sm font-medium border-b last:border-b-0 border-[#E9EDEF]">
                            {btn.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-[#667781] m-auto">Pick a template to see a preview.</div>
                )}
              </div>
            )}
            {channel === "email" && (
              <div className="bg-muted/40 p-4 rounded-md border h-full min-h-[300px]">
                {selectedEmail ? (
                  <div className="bg-white rounded-lg shadow-sm p-4 text-sm">
                    <div className="text-xs text-muted-foreground mb-1">Subject</div>
                    <div className="font-medium mb-3">{withSampleValues(selectedEmail.subject)}</div>
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: withSampleValues(selectedEmail.body_content || selectedEmail.html_content || "") }}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Pick a template to see a preview.</div>
                )}
              </div>
            )}
            {channel === "call" && (
              <div className="bg-muted/40 p-4 rounded-md border h-full min-h-[300px] flex items-center justify-center text-sm text-muted-foreground text-center">
                Calls follow the AI script configured for the org — no per-stage preview.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loadingTemplates}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
