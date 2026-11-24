import { formatDistanceToNow } from "date-fns";
import { Download, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PhoneAppStatus } from "@/hooks/usePhoneApp";

/** Pipeline strip for organisations using the In-Sync Phone app: phone status + next-call mode. */
export function PhoneAppBar({ status, nextCall, onNextCallChange }: {
  status: PhoneAppStatus;
  nextCall: boolean;
  onNextCallChange: (v: boolean) => void;
}) {
  const connected = !!status.connected;
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Smartphone className={`h-4 w-4 ${connected ? "text-emerald-600" : "text-muted-foreground"}`} />
        {connected ? (
          <span><b>Your phone is connected.</b> Call buttons dial on your phone.</span>
        ) : status.installed ? (
          <span><b>Your phone is not connected.</b> Open the In-Sync Phone app on your phone to call from here.</span>
        ) : (
          <span><b>Calls from your phone are not logged yet.</b> Install the In-Sync Phone app on your Android phone.</span>
        )}
        {status.last_sync_at && (
          <span className="text-xs text-muted-foreground">Last calls sent {formatDistanceToNow(new Date(status.last_sync_at), { addSuffix: true })}.</span>
        )}
      </div>
      <Link to="/phone-app" className="inline-flex items-center gap-1 text-sm text-primary underline">
        <Download className="h-3.5 w-3.5" /> Phone app
      </Link>
      <div className="ml-auto flex items-center gap-2">
        <Switch id="next-call-mode" checked={nextCall} onCheckedChange={onNextCallChange} disabled={!connected} />
        <Label htmlFor="next-call-mode" className="text-sm">Next-call mode</Label>
      </div>
    </Card>
  );
}
