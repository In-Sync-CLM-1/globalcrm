import { formatDistanceToNow } from "date-fns";
import { Download, Smartphone } from "lucide-react";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/common/LoadingState";
import { PHONE_APP_DOWNLOAD_URL, usePhoneAppStatus } from "@/hooks/usePhoneApp";

const STEPS = [
  "Open this page on your Android phone and tap Download app.",
  "Open the downloaded file. If the phone asks, allow installing apps from this source, then tap Install.",
  "Open In-Sync Phone, choose your company, and sign in with your CRM email and password.",
  "Allow Phone and Call history when the app asks. Without these, calls cannot be logged or started.",
  "Allow the app to run in the background (battery: Unrestricted). The app shows you where to switch it on.",
  "Keep dialling as usual. Calls to and from your own contacts are sent here; personal calls stay on your phone.",
];

export default function PhoneApp() {
  const { data: status, isLoading } = usePhoneAppStatus();
  if (isLoading) return <DashboardLayout><LoadingState message="Loading..." /></DashboardLayout>;
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Smartphone className="h-6 w-6" /> In-Sync Phone app</h1>
          <p className="mt-1 text-muted-foreground">Log the calls you make from your own Android phone, and start calls on your phone from the CRM.</p>
        </div>
        {!status?.enabled ? (
          <Card className="p-4 text-sm">The phone app is not switched on for your organisation.</Card>
        ) : (
          <>
            <Card className="space-y-3 p-4">
              <p className="text-sm">
                {status.connected ? <b>Your phone is connected.</b>
                  : status.installed ? <><b>Your phone is not connected right now.</b> Open the app on your phone.</>
                  : <b>You have not set up the app yet.</b>}
                {status.device_name && <> Phone: {status.device_name}.</>}
                {status.last_sync_at && <> Last calls sent {formatDistanceToNow(new Date(status.last_sync_at), { addSuffix: true })}.</>}
              </p>
              <Button asChild>
                <a href={PHONE_APP_DOWNLOAD_URL} download><Download className="mr-2 h-4 w-4" /> Download app (Android)</a>
              </Button>
              <p className="text-xs text-muted-foreground">Android only. iPhones do not allow apps to read call history, so on an iPhone keep picking outcomes by hand.</p>
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Set it up once</h2>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
                {STEPS.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </Card>
            <Card className="p-4 text-sm">
              <h2 className="font-semibold">What is sent</h2>
              <p className="mt-1">Only calls with numbers that are among your contacts in the CRM: time, length, and whether the call was answered. Calls from before you installed the app are not sent. There are no recordings.</p>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
