import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportHistoryDialog } from "./ExportHistoryDialog";

export function ExportHistoryButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className={className} onClick={() => setOpen(true)} aria-label="Export History">
        <History className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">Export History</span>
      </Button>
      <ExportHistoryDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
