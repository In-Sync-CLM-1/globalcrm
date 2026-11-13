import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useNotification } from "@/hooks/useNotification";
import { Phone as PhoneIcon, Plus, X, Star } from "lucide-react";
import { useGamingAccess } from "@/hooks/useGamingAccess";

interface ContactPhone {
  id: string;
  phone: string;
  phone_type: string;
  is_primary: boolean;
}

interface ContactPhonesProps {
  contactId: string;
  orgId: string;
  readOnly?: boolean;
}

export function ContactPhones({ contactId, orgId, readOnly = false }: ContactPhonesProps) {
  const notify = useNotification();
  const gaming = useGamingAccess();
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [newPhone, setNewPhone] = useState({ phone: "", phone_type: "mobile" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchPhones();
  }, [contactId]);

  const fetchPhones = async () => {
    const { data, error } = await supabase
      .from("contact_phones")
      .select("*")
      .eq("contact_id", contactId)
      .order("is_primary", { ascending: false })
      .order("created_at");

    if (!error && data) {
      setPhones(data);
    }
  };

  const addPhone = async () => {
    if (!newPhone.phone) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("contact_phones")
        .insert({
          contact_id: contactId,
          org_id: orgId,
          phone: newPhone.phone,
          phone_type: newPhone.phone_type,
          is_primary: phones.length === 0,
        });

      if (error) throw error;

      notify.success("Phone added successfully");
      setNewPhone({ phone: "", phone_type: "mobile" });
      fetchPhones();
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  const deletePhone = async (id: string) => {
    const { error } = await supabase
      .from("contact_phones")
      .delete()
      .eq("id", id);

    if (!error) {
      notify.success("Phone removed");
      fetchPhones();
    }
  };

  const setPrimary = async (id: string) => {
    // First, unset all primary flags
    await supabase
      .from("contact_phones")
      .update({ is_primary: false })
      .eq("contact_id", contactId);

    // Set the selected phone as primary
    const { error } = await supabase
      .from("contact_phones")
      .update({ is_primary: true })
      .eq("id", id);

    if (!error) {
      notify.success("Primary phone updated");
      fetchPhones();
    }
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      mobile: "bg-blue-500",
      work: "bg-green-500",
      home: "bg-purple-500",
      fax: "bg-orange-500",
      other: "bg-gray-500",
    };
    return colors[type] || "bg-gray-500";
  };

  if (readOnly) {
    return (
      <div className="space-y-2">
        {phones.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <PhoneIcon className="h-4 w-4 text-muted-foreground" />
            {gaming.masked ? (
              <span className="text-sm">{gaming.phone(item.phone)}</span>
            ) : (
              <a href={`tel:${item.phone}`} className="text-sm hover:underline">
                {item.phone}
              </a>
            )}
            <Badge variant="secondary" className={`text-xs ${getTypeColor(item.phone_type)}`}>
              {item.phone_type}
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
        {phones.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <Input value={item.phone} readOnly className="flex-1" />
            <Badge variant="secondary" className="text-xs">
              {item.phone_type}
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
              onClick={() => deletePhone(item.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Phone number"
          type="tel"
          value={newPhone.phone}
          onChange={(e) => setNewPhone({ ...newPhone, phone: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPhone();
            }
          }}
          className="flex-1"
        />
        <Select
          value={newPhone.phone_type}
          onValueChange={(value) => setNewPhone({ ...newPhone, phone_type: value })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mobile">Mobile</SelectItem>
            <SelectItem value="work">Work</SelectItem>
            <SelectItem value="home">Home</SelectItem>
            <SelectItem value="fax">Fax</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" onClick={addPhone} disabled={loading || !newPhone.phone}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
