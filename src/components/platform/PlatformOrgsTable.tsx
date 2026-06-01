import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ArrowUpDown, Eye, IndianRupee } from "lucide-react";
import { RecordOfflinePaymentDialog } from "./RecordOfflinePaymentDialog";

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_active?: boolean;
  userCount?: number;
  contactCount?: number;
  usersActive1Day?: number;
  usersActive7Days?: number;
  usersActive30Days?: number;
  callVolume?: number;
  emailVolume?: number;
}

interface Props {
  organizations: Organization[];
}

type SortKey = "name" | "userCount" | "contactCount" | "usersActive30Days" | "callVolume" | "emailVolume";

export function PlatformOrgsTable({ organizations }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const [detailOrg, setDetailOrg] = useState<Organization | null>(null);
  const [detailUsers, setDetailUsers] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [payOrg, setPayOrg] = useState<Organization | null>(null);

  const viewOrgDetails = async (org: Organization) => {
    setDetailOrg(org);
    setDetailLoading(true);
    try {
      const { data } = await supabase
        .from("user_roles")
        .select(`id, role, created_at, profiles:user_id (first_name, last_name, phone)`)
        .eq("org_id", org.id);
      setDetailUsers(data || []);
    } catch {
      setDetailUsers([]);
    }
    setDetailLoading(false);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const rows = organizations.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q)
    );

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else cmp = ((a[sortKey] as number) || 0) - ((b[sortKey] as number) || 0);
      return sortAsc ? cmp : -cmp;
    });

    return rows;
  }, [organizations, search, sortKey, sortAsc]);

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-foreground"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </span>
    </TableHead>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Organizations</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search orgs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Organization" field="name" />
                  <TableHead>Slug</TableHead>
                  <SortHeader label="Users" field="userCount" />
                  <SortHeader label="Contacts" field="contactCount" />
                  <SortHeader label="Active 30d" field="usersActive30Days" />
                  <SortHeader label="Calls" field="callVolume" />
                  <SortHeader label="Emails" field="emailVolume" />
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      No organizations found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium">
                        <button
                          className="text-left hover:underline hover:text-primary transition-colors"
                          onClick={() => viewOrgDetails(org)}
                        >
                          {org.name}
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{org.slug}</TableCell>
                      <TableCell>{org.userCount}</TableCell>
                      <TableCell>{org.contactCount}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {org.usersActive30Days}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {org.callVolume}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {org.emailVolume}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={org.is_active !== false ? "bg-green-500/15 text-green-600 border-green-500/20" : "bg-red-500/15 text-red-600 border-red-500/20"} variant="outline">
                          {org.is_active !== false ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(org.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Record offline payment"
                            onClick={() => setPayOrg(org)}
                          >
                            <IndianRupee className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="View details" onClick={() => viewOrgDetails(org)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detailOrg} onOpenChange={(open) => { if (!open) setDetailOrg(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3 pr-6">
              <span>{detailOrg?.name}</span>
              {detailOrg && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPayOrg(detailOrg)}>
                  <IndianRupee className="h-3.5 w-3.5" /> Record payment
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Slug</p>
                <p className="font-mono font-medium">{detailOrg?.slug}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={detailOrg?.is_active !== false ? "default" : "destructive"}>
                  {detailOrg?.is_active !== false ? "Active" : "Disabled"}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Users</p>
                <p className="font-medium">{detailOrg?.userCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Contacts</p>
                <p className="font-medium">{detailOrg?.contactCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Calls</p>
                <p className="font-medium">{detailOrg?.callVolume}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Emails</p>
                <p className="font-medium">{detailOrg?.emailVolume}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Members</p>
              {detailLoading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary" />
                </div>
              ) : detailUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members found</p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailUsers.map((u: any) => (
                        <TableRow key={u.id}>
                          <TableCell className="text-sm">
                            {u.profiles?.first_name} {u.profiles?.last_name}
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">
                              {u.role?.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(u.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RecordOfflinePaymentDialog
        open={!!payOrg}
        onOpenChange={(o) => { if (!o) setPayOrg(null); }}
        org={payOrg ? { id: payOrg.id, name: payOrg.name } : null}
      />
    </>
  );
}
