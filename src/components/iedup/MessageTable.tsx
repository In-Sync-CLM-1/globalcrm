import { useState } from "react";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import MessageTip from "./MessageTip";
import { useNotification } from "@/hooks/useNotification";

export type MessageRow = { channel: string; template: string; sent: number; delivered: number | null; opened: number | null; failed: number | null; tracked: boolean };
export type MessageBody = { channel: string; template: string; body: string };
const HEAD = ["Template", "Channel", "Sent", "Delivered", "Delivered %", "Opened", "Opened %", "Failed"];
const n = (v: number | null) => (v === null ? "–" : v.toLocaleString("en-IN"));
const pct = (v: number | null, of: number) => (v === null || !of ? "–" : `${Math.round((v / of) * 100)}%`);
// WhatsApp tells us about opens; email opens are not tracked, so an email row with none shows a dash, not 0
const opened = (r: MessageRow) => (r.channel === "Email" && !r.opened ? null : r.opened);
const cells = (r: MessageRow) => [r.template, r.channel, n(r.sent), n(r.delivered), pct(r.delivered, r.sent), n(opened(r)), pct(opened(r), r.sent), n(r.failed)];

export function totalOf(rows: MessageRow[], channel: string): MessageRow {
  const of = rows.filter((r) => r.channel === channel);
  const sum = (k: "sent" | "delivered" | "opened" | "failed") => of.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return { channel, template: `Total ${channel}`, sent: sum("sent"), delivered: sum("delivered"), opened: sum("opened"), failed: sum("failed"), tracked: true };
}

type Calls = { placed: number; connected: number };
export default function MessageTable({ rows, bodies, calls, from, to }: { rows: MessageRow[] | undefined; bodies: MessageBody[] | null | undefined; calls: Calls; from: Date; to: Date }) {
  const notify = useNotification();
  const [channel, setChannel] = useState("");
  const all = rows ?? [];
  const shown = all.filter((r) => !channel || r.channel === channel);
  const totals = ["WhatsApp", "Email"].filter((c) => !channel || c === channel).map((c) => totalOf(all, c));
  const period = `${format(from, "d MMM yyyy")} to ${format(to, "d MMM yyyy")}`;
  const file = `iedup-messages-${format(from, "yyyy-MM-dd")}-to-${format(to, "yyyy-MM-dd")}`;
  const callRow = ["AI calls", "Call", n(calls.placed), n(calls.connected), pct(calls.connected, calls.placed), "–", "–", n(calls.placed - calls.connected)];
  const body = [...shown.map(cells), ...totals.map(cells), ...(channel ? [] : [callRow])];
  const boldFrom = shown.length;
  const bodyOf = (c: string[]) => bodies?.find((b) => b.channel === c[1] && b.template === c[0])?.body ?? (bodies ? "The text of this message is no longer available." : bodies === null ? "The text could not be loaded. Please refresh the page." : "Loading…");

  async function excel() {
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const num = (v: number | null) => (v === null ? null : { value: v, type: Number });
      const line = (r: MessageRow, bold: boolean) => [
        { value: r.template, fontWeight: bold ? ("bold" as const) : undefined }, { value: r.channel },
        num(r.sent), num(r.delivered), { value: pct(r.delivered, r.sent) }, num(opened(r)), { value: pct(opened(r), r.sent) }, num(r.failed),
      ];
      const sheet = [
        [{ value: `IEDUP messages, ${period}`, fontWeight: "bold" as const }],
        HEAD.map((h) => ({ value: h, fontWeight: "bold" as const })),
        ...shown.map((r) => line(r, false)), ...totals.map((r) => line(r, true)),
        ...(channel ? [] : [[{ value: "AI calls", fontWeight: "bold" as const }, { value: "Call" }, num(calls.placed), num(calls.connected), { value: pct(calls.connected, calls.placed) }, null, null, num(calls.placed - calls.connected)]]),
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (writeExcelFile as any)(sheet, { columns: [{ width: 48 }, { width: 12 }, ...HEAD.slice(2).map(() => ({ width: 13 }))] }).toFile(`${file}.xlsx`);
    } catch (e) { console.error(e); notify.error("Could not make the Excel file", "Please try again."); }
  }

  async function pdf() {
    try {
      const { jsPDF } = await import("jspdf");
      const d = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const x = [12, 128, 168, 190, 214, 236, 258, 284]; // left edge for text columns, right edge for numbers
      let y = 16;
      const row = (c: string[], bold: boolean) => {
        if (y > 195) { d.addPage(); y = 16; row(HEAD, true); }
        d.setFont("helvetica", bold ? "bold" : "normal"); d.setFontSize(9);
        const name = d.splitTextToSize(c[0].replace(/[^\x20-\x7E]/g, "").trim(), 112)[0] ?? "";
        d.text(name, x[0], y); d.text(c[1], x[1], y);
        for (let i = 2; i < 8; i++) d.text(c[i].replace("–", "-"), x[i], y, { align: "right" });
        y += 6;
      };
      d.setFont("helvetica", "bold"); d.setFontSize(13); d.text(`IEDUP messages, ${period}`, 12, y); y += 9;
      row(HEAD, true);
      body.forEach((c, i) => row(c, i >= boldFrom));
      d.setFont("helvetica", "normal"); d.setFontSize(8); d.text("For calls, Delivered means connected. Login codes have no delivery reports.", 12, Math.min(y + 3, 203));
      d.save(`${file}.pdf`);
    } catch (e) { console.error(e); notify.error("Could not make the PDF", "Please try again."); }
  }

  return (
    <Card className="flex shrink-0 flex-col p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Messages by template and channel</h3>
          <p className="text-[11px] text-muted-foreground">Every message in this period: automatic, sent from RAMP, or sent from the CRM</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">All channels</option><option value="WhatsApp">WhatsApp</option><option value="Email">Email</option>
          </select>
          <Button variant="outline" size="sm" className="h-9" onClick={excel} disabled={!shown.length}><Download className="mr-2 h-4 w-4" />Excel</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={pdf} disabled={!shown.length}><Download className="mr-2 h-4 w-4" />PDF</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>{HEAD.map((h, i) => <TableHead key={h} className={i > 1 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {!body.length || !shown.length ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{rows ? "No messages in this period." : "Loading…"}</TableCell></TableRow>
            ) : body.map((c, i) => (
              <TableRow key={`${c[1]}-${c[0]}`} className={i >= boldFrom ? "bg-muted/40 font-semibold" : ""}>
                {c.map((v, j) => (
                  <TableCell key={j} className={j > 1 ? "text-right tabular-nums" : j === 0 ? "max-w-[420px] truncate font-medium" : ""}>
                    {j === 0 && i < boldFrom ? <MessageTip name={v} body={bodyOf(c)} /> : v}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Login codes have no delivery reports, and email opens are not tracked, so these show a dash. For calls, Delivered means connected.</p>
    </Card>
  );
}
