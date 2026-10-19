import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import ReportCanvas from "./ReportCanvas";
import { toast } from "sonner";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useGamingAccess } from "@/hooks/useGamingAccess";

interface ReportViewerProps {
  reportId: string | null;
  open: boolean;
  onClose: () => void;
}

export const ReportViewer = ({ reportId, open, onClose }: ReportViewerProps) => {
  const { effectiveOrgId } = useOrgContext();
  const { data: report, isLoading } = useQuery({
    queryKey: ['report', reportId],
    queryFn: async () => {
      if (!reportId) return null;
      const { data, error } = await supabase
        .from('saved_reports')
        .select('*')
        .eq('id', reportId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!reportId && open,
  });

  const gaming = useGamingAccess();
  const handleExport = () => {
    toast.info("Export functionality coming soon");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{report?.name || 'Loading...'}</DialogTitle>
            <div className="flex gap-2">
              {gaming.canExport && (
                <Button size="sm" variant="outline" onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : report ? (
          <div className="p-4">
            {report.description && (
              <p className="text-sm text-muted-foreground mb-4">{report.description}</p>
            )}
            <ReportCanvas
              components={(report.configuration as any)?.components || []}
              parameters={(report.configuration as any)?.parameters || {}}
              dataSource={report.data_source}
              onChange={() => {}}
              orgId={effectiveOrgId || ''}
            />
          </div>
        ) : (
          <p className="text-center text-muted-foreground p-8">Report not found</p>
        )}
      </DialogContent>
    </Dialog>
  );
};
