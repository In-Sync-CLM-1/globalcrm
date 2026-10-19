import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useNotification } from "@/hooks/useNotification";
import { Mail, Plus, X, Star } from "lucide-react";
import { useGamingAccess } from "@/hooks/useGamingAccess";

interface ContactEmail {
  id: string;
  email: string;
  email_type: string;
  is_primary: boolean;
}

interface ContactEmailsProps {
  contactId: string;
  orgId: string;
  readOnly?: boolean;
}

export function ContactEmails({ contactId, orgId, readOnly = false }: ContactEmailsProps) {
  const notify = useNotification();
  const gaming = useGamingAccess();
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [newEmail, setNewEmail] = useState({ email: "", email_type: "work" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchEmails();
  }, [contactId]);

  const fetchEmails = async () => {
    const { data, error } = await supabase
      .from("contact_emails")
      .select("*")
      .eq("contact_id", contactId)
      .order("is_primary", { ascending: false })
      .order("created_at");

    if (!error && data) {
      setEmails(data);
    }
  };

  const addEmail = async () => {
    if (!newEmail.email) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("contact_emails")
        .insert({
          contact_id: contactId,
          org_id: orgId,
          email: newEmail.email,
          email_type: newEmail.email_type,
          is_primary: emails.length === 0,
        });

      if (error) throw error;

      notify.success("Email added successfully");
      setNewEmail({ email: "", email_type: "work" });
      fetchEmails();
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  const deleteEmail = async (id: string) => {
    const { error } = await supabase
      .from("contact_emails")
      .delete()
      .eq("id", id);

    if (!error) {
      notify.success("Email removed");
      fetchEmails();
    }
  };

  const setPrimary = async (id: string) => {
    // First, unset all primary flags
    await supabase
      .from("contact_emails")
      .update({ is_primary: false })
      .eq("contact_id", contactId);

    // Set the selected email as primary
    const { error } = await supabase
      .from("contact_emails")
      .update({ is_primary: true })
      .eq("id", id);

    if (!error) {
      notify.success("Primary email updated");
      fetchEmails();
    }
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      work: "bg-blue-500",
      personal: "bg-green-500",
      other: "bg-gray-500",
    };
    return colors[type] || "bg-gray-500";
  };

  if (readOnly) {
    return (
      <div className="space-y-2">
        {emails.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            {gaming.masked ? (
              <span className="text-sm">{gaming.email(item.email)}</span>
            ) : (
              <a href={`mailto:${item.email}`} className="text-sm hover:underline">
                {item.email}
              </a>
            )}
            <Badge variant="secondary" className={`text-xs ${getTypeColor(item.email_type)}`}>
              {item.email_type}
            </Badge>
            {item.is_primary && (
              <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {emails.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <Input value={item.email} readOnly className="flex-1" />
            <Badge variant="secondary" className="text-xs">
              {item.email_type}
            </Badge>
            {item.is_primary ? (
              <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setPrimary(item.id)}
                title="Set as primary"
              >
                <Star className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => deleteEmail(item.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Email address"
          type="email"
          value={newEmail.email}
          onChange={(e) => setNewEmail({ ...newEmail, email: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addEmail();
            }
          }}
          className="flex-1"
        />
        <Select
          value={newEmail.email_type}
          onValueChange={(value) => setNewEmail({ ...newEmail, email_type: value })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="work">Work</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" onClick={addEmail} disabled={loading || !newEmail.email}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
