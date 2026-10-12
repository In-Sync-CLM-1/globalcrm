import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Download, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { useUrlState } from "@/hooks/useUrlState";

export function UnsubscribeManager() {
  const [searchTerm, setSearchTerm] = useUrlState("uq", "");
  const queryClient = useQueryClient();

  const { data: unsubscribes, isLoading } = useQuery({
    queryKey: ['email-unsubscribes', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('email_unsubscribes')
        .select('*, contacts(first_name, last_name)')
        .order('unsubscribed_at', { ascending: false });

      if (searchTerm) {
        query = query.ilike('email', `%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const resubscribeMutation = useMutation({
    mutationFn: async (unsubscribeId: string) => {
      const { error } = await supabase
        .from('email_unsubscribes')
        .delete()
        .eq('id', unsubscribeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-unsubscribes'] });
      toast.success('Email resubscribed successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to resubscribe email: ' + error.message);
    },
  });

  const handleExport = () => {
    if (!unsubscribes || unsubscribes.length === 0) {
      toast.error('No data to export');
      return;
    }

    const csv = [
      ['Email', 'Contact Name', 'Unsubscribed Date', 'Source'],
      ...unsubscribes.map(u => [
        u.email,
        u.contacts ? `${u.contacts.first_name} ${u.contacts.last_name}` : 'N/A',
        format(new Date(u.unsubscribed_at), 'yyyy-MM-dd HH:mm:ss'),
        u.source
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unsubscribes-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Unsubscribes</CardTitle>
        <CardDescription>
          Manage contacts who have unsubscribed from automation emails
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={handleExport} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Unsubscribed Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !unsubscribes || unsubscribes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No unsubscribes found
                  </TableCell>
                </TableRow>
              ) : (
                unsubscribes.map((unsubscribe) => (
                  <TableRow key={unsubscribe.id}>
                    <TableCell className="font-medium">{unsubscribe.email}</TableCell>
                    <TableCell>
                      {unsubscribe.contacts 
                        ? `${unsubscribe.contacts.first_name} ${unsubscribe.contacts.last_name}`
                        : <span className="text-muted-foreground">Unknown</span>
                      }
                    </TableCell>
                    <TableCell>
                      {format(new Date(unsubscribe.unsubscribed_at), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{unsubscribe.source}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resubscribeMutation.mutate(unsubscribe.id)}
                        disabled={resubscribeMutation.isPending}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Resubscribe
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="text-sm text-muted-foreground">
          Total unsubscribes: {unsubscribes?.length || 0}
        </div>
      </CardContent>
    </Card>
  );
}
