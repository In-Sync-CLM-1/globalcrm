import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useNotification } from "@/hooks/useNotification";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";

// Contact fields users can map variables to. Each entry has a sample
// value that gets sent to Meta for template approval.
const CONTACT_FIELDS: { value: string; label: string; group: string; sample: string }[] = [
  { value: "first_name", label: "First Name", group: "Personal", sample: "John" },
  { value: "last_name", label: "Last Name", group: "Personal", sample: "Smith" },
  { value: "full_name", label: "Full Name", group: "Personal", sample: "John Smith" },
  { value: "email", label: "Email", group: "Personal", sample: "john@example.com" },
  { value: "phone", label: "Phone", group: "Personal", sample: "+919876543210" },
  { value: "company", label: "Company", group: "Professional", sample: "Acme Corp" },
  { value: "job_title", label: "Job Title", group: "Professional", sample: "Marketing Director" },
  { value: "city", label: "City", group: "Location", sample: "Mumbai" },
  { value: "state", label: "State", group: "Location", sample: "Maharashtra" },
  { value: "country", label: "Country", group: "Location", sample: "India" },
  { value: "postal_code", label: "Postal Code", group: "Location", sample: "400001" },
  { value: "website", label: "Website", group: "Links", sample: "https://example.com" },
  { value: "source", label: "Source", group: "Other", sample: "Website" },
  { value: "status", label: "Status", group: "Other", sample: "Active" },
  { value: "assigned_to_name", label: "Assigned To (Name)", group: "Other", sample: "Jane Doe" },
];

const fieldByName = (name: string) => CONTACT_FIELDS.find(f => f.value === name);

const groupedFields = CONTACT_FIELDS.reduce<Record<string, typeof CONTACT_FIELDS>>((acc, f) => {
  if (!acc[f.group]) acc[f.group] = [];
  acc[f.group].push(f);
  return acc;
}, {});

// Pull variable positions out of a string like "Hi {{1}}, your {{2}}" → [1, 2]
const extractVariables = (text: string): number[] => {
  const matches = text.match(/\{\{(\d+)\}\}/g) || [];
  const positions = matches
    .map(v => parseInt(v.replace(/[{}]/g, ''), 10))
    .filter(n => !isNaN(n));
  return [...new Set(positions)].sort((a, b) => a - b);
};

interface Button {
  type: string;
  text: string;
  url?: string;
  phone_code?: string;
  phone_number?: string;
}

export default function TemplateBuilder() {
  const navigate = useNavigate();
  const notify = useNotification();
  const { effectiveOrgId } = useOrgContext();
  
  const [loading, setLoading] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [category, setCategory] = useState("marketing");
  const [language, setLanguage] = useState("en");
  const [headerType, setHeaderType] = useState<string>("none");
  const [headerContent, setHeaderContent] = useState("");
  const [bodyContent, setBodyContent] = useState("");
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<Button[]>([]);
  const [sampleHeader, setSampleHeader] = useState<string[]>([]);
  const [sampleBody, setSampleBody] = useState<string[]>([]);
  // Position → contact field mapping. e.g. { "1": "first_name", "2": "company" }
  const [bodyFieldMappings, setBodyFieldMappings] = useState<Record<string, string>>({});
  const [headerFieldMappings, setHeaderFieldMappings] = useState<Record<string, string>>({});
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // Derive the variable positions present in the body / header
  const bodyPositions = extractVariables(bodyContent);
  const headerPositions = extractVariables(headerContent);

  // Sample values mirror the mapped field's sample. They're shown to Meta for
  // template approval, so they must look like real values, not blanks.
  useEffect(() => {
    const newSampleBody = bodyPositions.map(pos => {
      const mappedField = bodyFieldMappings[String(pos)];
      return mappedField ? (fieldByName(mappedField)?.sample || mappedField) : '';
    });
    setSampleBody(newSampleBody);
  }, [bodyContent, bodyFieldMappings]);

  useEffect(() => {
    const newSampleHeader = headerPositions.map(pos => {
      const mappedField = headerFieldMappings[String(pos)];
      return mappedField ? (fieldByName(mappedField)?.sample || mappedField) : '';
    });
    setSampleHeader(newSampleHeader);
  }, [headerContent, headerFieldMappings]);

  const insertVariable = (location: 'header' | 'body', fieldName: string) => {
    if (location === 'header') {
      const nextPos = extractVariables(headerContent).length + 1;
      setHeaderContent(headerContent + `{{${nextPos}}}`);
      setHeaderFieldMappings(prev => ({ ...prev, [String(nextPos)]: fieldName }));
    } else {
      const nextPos = extractVariables(bodyContent).length + 1;
      setBodyContent(bodyContent + `{{${nextPos}}}`);
      setBodyFieldMappings(prev => ({ ...prev, [String(nextPos)]: fieldName }));
    }
  };

  const addButton = (type: string) => {
    if (buttons.length >= 3) {
      notify.error("Button Limit Reached", "You can add a maximum of 3 buttons");
      return;
    }

    setButtons([
      ...buttons,
      {
        type,
        text: "",
        ...(type === "URL" && { url: "" }),
        ...(type === "PHONE_NUMBER" && { phone_code: "+1", phone_number: "" }),
      },
    ]);
  };

  const updateButton = (index: number, field: string, value: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], [field]: value };
    setButtons(newButtons);
  };

  const removeButton = (index: number) => {
    setButtons(buttons.filter((_, i) => i !== index));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type based on header type
    const validTypes: Record<string, string[]> = {
      image: ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'],
      video: ['video/mp4', 'video/3gpp'],
      document: ['application/pdf']
    };

    if (headerType !== 'none' && headerType !== 'text') {
      const allowedTypes = validTypes[headerType] || [];
      if (!allowedTypes.includes(file.type)) {
        notify.error("Invalid File Type", `Please upload a valid ${headerType} file`);
        return;
      }
    }

    // Validate file size (max 5MB for images, 16MB for videos, 100MB for documents)
    const maxSizes: Record<string, number> = {
      image: 5 * 1024 * 1024,
      video: 16 * 1024 * 1024,
      document: 100 * 1024 * 1024
    };

    const maxSize = maxSizes[headerType] || 5 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.error("File Too Large", `File size must be less than ${maxSize / (1024 * 1024)}MB`);
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${effectiveOrgId}/${Date.now()}.${fileExt}`;
      const filePath = `template-media/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('whatsapp-templates')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('whatsapp-templates')
        .getPublicUrl(filePath);

      setMediaUrl(publicUrl);

      notify.success("Upload Successful", "File uploaded successfully");
    } catch (error: any) {
      console.error('Error uploading file:', error);
      notify.error("Upload Failed", error);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!templateName || !bodyContent) {
      notify.error("Validation Error", "Template name and body content are required");
      return;
    }

    // Validate buttons have required text
    const invalidButtons = buttons.filter(btn => !btn.text?.trim());
    if (invalidButtons.length > 0) {
      notify.error("Validation Error", "All buttons must have button text");
      return;
    }

    // Every variable position must be mapped to a contact field
    const unmappedBody = bodyPositions.filter(p => !bodyFieldMappings[String(p)]);
    const unmappedHeader = headerPositions.filter(p => !headerFieldMappings[String(p)]);
    if (unmappedBody.length > 0 || unmappedHeader.length > 0) {
      const positions = [...unmappedHeader, ...unmappedBody].map(p => `{{${p}}}`).join(', ');
      notify.error("Validation Error", `Please pick a contact field for ${positions}`);
      return;
    }

    const fieldMappings = {
      ...(Object.keys(headerFieldMappings).length > 0 && { header: headerFieldMappings }),
      ...(Object.keys(bodyFieldMappings).length > 0 && { body: bodyFieldMappings }),
    };

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-exotel-whatsapp-template', {
        body: {
          template_name: templateName,
          category,
          language,
          header_type: headerType === 'none' ? null : headerType,
          header_content: headerType === 'text' ? headerContent : (headerType !== 'none' ? mediaUrl : null),
          body_content: bodyContent,
          footer_text: footerText || null,
          buttons: buttons.length > 0 ? buttons.map(btn => ({
            ...btn,
            ...(btn.type === "PHONE_NUMBER" && {
              phone_number: (btn.phone_code || "+1") + (btn.phone_number || ""),
              phone_code: undefined
            }),
          })) : null,
          sample_values: {
            ...(sampleHeader.length > 0 && { header: sampleHeader }),
            ...(sampleBody.length > 0 && { body: sampleBody }),
          },
          field_mappings: fieldMappings,
        },
      });

      if (error) throw error;

      notify.success("Template Submitted", data.message || "Template submitted successfully for WhatsApp approval");

      navigate('/templates');
    } catch (error: any) {
      console.error('Error submitting template:', error);
      notify.error("Submission Failed", error);
    } finally {
      setLoading(false);
    }
  };

  const renderPreview = () => {
    return (
      <div className="bg-muted p-4 rounded-lg max-w-sm">
        <div className="bg-background rounded-lg p-4 shadow-md">
          {headerType !== 'none' && (
            <div className="mb-3">
              {headerType === 'text' ? (
                <p className="font-semibold text-lg">{headerContent || "Header text here"}</p>
              ) : (
                <div className="bg-muted h-32 rounded flex items-center justify-center text-muted-foreground">
                  {headerType.toUpperCase()} Preview
                </div>
              )}
            </div>
          )}
          
          <div className="mb-3 whitespace-pre-wrap">
            {bodyContent || "Your message body will appear here. Use variables like {{1}} for dynamic content."}
          </div>
          
          {footerText && (
            <div className="text-sm text-muted-foreground mb-3">
              {footerText}
            </div>
          )}
          
          {buttons.length > 0 && (
            <div className="space-y-2">
              {buttons.map((btn, idx) => (
                <div key={idx} className="border border-primary rounded py-2 px-3 text-center text-primary hover:bg-primary/10 cursor-pointer transition-colors">
                  {btn.text || `Button ${idx + 1}`}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Create WhatsApp Template</h1>
            <p className="text-muted-foreground">Design and submit templates for WhatsApp approval</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form Section */}
          <div className="space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Template name, category, and language settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="templateName">Template Name *</Label>
                  <Input
                    id="templateName"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                    placeholder="welcome_message"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Use lowercase letters, numbers, and underscores only</p>
                </div>

                <div>
                  <Label htmlFor="category">Category *</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="utility">Utility</SelectItem>
                      <SelectItem value="authentication">Authentication</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="language">Language *</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger id="language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="en_US">English (US)</SelectItem>
                      <SelectItem value="hi">Hindi</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="pt_BR">Portuguese (BR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Header */}
            <Card>
              <CardHeader>
                <CardTitle>Header (Optional)</CardTitle>
                <CardDescription>Add a header with text or media</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="headerType">Header Type</Label>
                  <Select value={headerType} onValueChange={setHeaderType}>
                    <SelectTrigger id="headerType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="image">Image</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="document">Document</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {headerType === 'text' && (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <Label htmlFor="headerContent">Header Text</Label>
                      <Select onValueChange={(v) => insertVariable('header', v)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="+ Insert field" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(groupedFields).map(([group, fields]) => (
                            <div key={group}>
                              <Label className="px-2 py-1 text-xs text-muted-foreground">{group}</Label>
                              {fields.map(f => (
                                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                              ))}
                            </div>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      id="headerContent"
                      value={headerContent}
                      onChange={(e) => setHeaderContent(e.target.value)}
                      placeholder="Welcome, {{1}}!"
                    />

                    {headerPositions.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <Label>Map each variable to a contact field</Label>
                        {headerPositions.map((pos) => (
                          <div key={pos} className="flex items-center gap-2">
                            <span className="text-sm font-mono w-12">{`{{${pos}}}`}</span>
                            <Select
                              value={headerFieldMappings[String(pos)] || ""}
                              onValueChange={(v) =>
                                setHeaderFieldMappings(prev => ({ ...prev, [String(pos)]: v }))
                              }
                            >
                              <SelectTrigger className="flex-1">
                                <SelectValue placeholder="Pick a field" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(groupedFields).map(([group, fields]) => (
                                  <div key={group}>
                                    <Label className="px-2 py-1 text-xs text-muted-foreground">{group}</Label>
                                    {fields.map(f => (
                                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                    ))}
                                  </div>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {headerType !== 'none' && headerType !== 'text' && (
                  <div className="space-y-3">
                    <Label htmlFor="mediaUpload">Upload {headerType}</Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="mediaUpload"
                        type="file"
                        onChange={handleFileUpload}
                        accept={
                          headerType === 'image' ? 'image/jpeg,image/png,image/jpg,image/webp' :
                          headerType === 'video' ? 'video/mp4,video/3gpp' :
                          headerType === 'document' ? 'application/pdf' : ''
                        }
                        className="hidden"
                        disabled={uploading}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => document.getElementById('mediaUpload')?.click()}
                        disabled={uploading}
                        className="w-full"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {uploading ? 'Uploading...' : mediaUrl ? 'Change File' : 'Upload File'}
                      </Button>
                    </div>
                    {mediaUrl && (
                      <p className="text-xs text-muted-foreground">
                        ✓ File uploaded successfully
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Body */}
            <Card>
              <CardHeader>
                <CardTitle>Body Content *</CardTitle>
                <CardDescription>The main message content</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label htmlFor="bodyContent">Message Text</Label>
                    <Select onValueChange={(v) => insertVariable('body', v)}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="+ Insert field" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(groupedFields).map(([group, fields]) => (
                          <div key={group}>
                            <Label className="px-2 py-1 text-xs text-muted-foreground">{group}</Label>
                            {fields.map(f => (
                              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    id="bodyContent"
                    value={bodyContent}
                    onChange={(e) => setBodyContent(e.target.value)}
                    placeholder="Hello {{1}}, your order {{2}} is confirmed!"
                    rows={6}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Pick a contact field above to add it. Each variable gets auto-filled when you send.
                  </p>
                </div>

                {bodyPositions.length > 0 && (
                  <div className="space-y-2">
                    <Label>Map each variable to a contact field</Label>
                    {bodyPositions.map((pos) => (
                      <div key={pos} className="flex items-center gap-2">
                        <span className="text-sm font-mono w-12">{`{{${pos}}}`}</span>
                        <Select
                          value={bodyFieldMappings[String(pos)] || ""}
                          onValueChange={(v) =>
                            setBodyFieldMappings(prev => ({ ...prev, [String(pos)]: v }))
                          }
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Pick a field" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(groupedFields).map(([group, fields]) => (
                              <div key={group}>
                                <Label className="px-2 py-1 text-xs text-muted-foreground">{group}</Label>
                                {fields.map(f => (
                                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Footer */}
            <Card>
              <CardHeader>
                <CardTitle>Footer (Optional)</CardTitle>
                <CardDescription>Add a footer text</CardDescription>
              </CardHeader>
              <CardContent>
                <div>
                  <Label htmlFor="footerText">Footer Text</Label>
                  <Input
                    id="footerText"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                    placeholder="Thank you for your business"
                    maxLength={60}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Maximum 60 characters</p>
                </div>
              </CardContent>
            </Card>

            {/* Buttons */}
            <Card>
              <CardHeader>
                <CardTitle>Buttons (Optional)</CardTitle>
                <CardDescription>Add call-to-action or quick reply buttons (max 3)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => addButton("URL")} disabled={buttons.length >= 3}>
                    <Plus className="h-4 w-4 mr-2" />
                    URL Button
                  </Button>
                  <Button type="button" variant="outline" onClick={() => addButton("PHONE_NUMBER")} disabled={buttons.length >= 3}>
                    <Plus className="h-4 w-4 mr-2" />
                    Phone Button
                  </Button>
                  <Button type="button" variant="outline" onClick={() => addButton("QUICK_REPLY")} disabled={buttons.length >= 3}>
                    <Plus className="h-4 w-4 mr-2" />
                    Quick Reply
                  </Button>
                </div>

                {buttons.map((btn, idx) => (
                  <Card key={idx}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <Label>Button {idx + 1} - {btn.type.replace('_', ' ')}</Label>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeButton(idx)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input
                        placeholder="Button text *"
                        value={btn.text}
                        onChange={(e) => updateButton(idx, 'text', e.target.value)}
                        maxLength={25}
                        required
                      />
                      {btn.type === "URL" && (
                        <Input
                          placeholder="https://example.com"
                          value={btn.url || ""}
                          onChange={(e) => updateButton(idx, 'url', e.target.value)}
                        />
                      )}
                      {btn.type === "PHONE_NUMBER" && (
                        <div className="flex gap-2">
                          <Select 
                            value={btn.phone_code || "+1"}
                            onValueChange={(code) => {
                              updateButton(idx, 'phone_code', code);
                            }}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="Code" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="+1">🇺🇸 +1</SelectItem>
                              <SelectItem value="+44">🇬🇧 +44</SelectItem>
                              <SelectItem value="+91">🇮🇳 +91</SelectItem>
                              <SelectItem value="+86">🇨🇳 +86</SelectItem>
                              <SelectItem value="+81">🇯🇵 +81</SelectItem>
                              <SelectItem value="+49">🇩🇪 +49</SelectItem>
                              <SelectItem value="+33">🇫🇷 +33</SelectItem>
                              <SelectItem value="+61">🇦🇺 +61</SelectItem>
                              <SelectItem value="+55">🇧🇷 +55</SelectItem>
                              <SelectItem value="+971">🇦🇪 +971</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="1234567890"
                            type="tel"
                            value={btn.phone_number || ""}
                            onChange={(e) => {
                              const cleanedValue = e.target.value.replace(/\D/g, '');
                              updateButton(idx, 'phone_number', cleanedValue);
                            }}
                            className="flex-1"
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <Button onClick={handleSubmit} disabled={loading} className="flex-1">
                {loading ? "Submitting..." : "Submit Template for Approval"}
              </Button>
              <Button variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </div>
          </div>

          {/* Preview Section */}
          <div className="space-y-6">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>How your template will appear on WhatsApp</CardDescription>
              </CardHeader>
              <CardContent>
                {renderPreview()}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
