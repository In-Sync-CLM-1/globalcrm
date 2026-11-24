import { Card } from "@/components/ui/card";
import { fmtHM, type Totals } from "@/components/Gaming/gamingStats";

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** Figures from calls the In-Sync Phone app reported: only calls made with the app running count here. */
export function PhoneCallTiles({ totals }: { totals: Totals }) {
  const n = (v: number) => v.toLocaleString("en-IN");
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Phone calls" value={n(totals.phone_calls)} hint="logged by the phone app" />
        <Tile label="Answered on phone" value={n(totals.connected_calls)} hint="the player answered" />
        <Tile label="Clean calls" value={n(totals.clean_calls)} hint="1 minute or longer" />
        <Tile label="Talk time" value={fmtHM(totals.talk_secs)} />
      </div>
      <p className="text-xs text-muted-foreground">These four figures count only calls the In-Sync Phone app reported. Outcomes picked without the app still count under Calls.</p>
    </div>
  );
}
