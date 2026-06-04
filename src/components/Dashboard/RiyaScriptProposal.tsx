import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, RefreshCw, FileText, Sparkles, Check, X, Bot } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { cn } from "@/lib/utils";
import { metaFor, agentNameFor } from "@/lib/aiAgents";

interface Script {
  id: string;
  product_name: string | null;
  opening: string | null;
  objective: string | null;
  key_points: string[] | null;
  closing: string | null;
  objection_handling: Record<string, string> | null;
  behavioral_guidelines: string | null;
}

interface Proposal {
  id: string;
  script_id: string;
  based_on_date: string;
  proposed_opening: string | null;
  proposed_objective: string | null;
  proposed_key_points: string[] | null;
  proposed_closing: string | null;
  proposed_objection_handling: Record<string, string> | null;
  proposed_behavioral_guidelines: string | null;
  rationale: string | null;
  status: "pending" | "approved" | "rejected" | "superseded";
  generated_at: string;
}

interface Decisions {
  opening: boolean;
  objective: boolean;
  closing: boolean;
  key_points: boolean[];
  objection_handling: Record<string, boolean>;
  behavioral_guidelines: boolean[];
}

const splitLines = (s: string | null | undefined) =>
  (s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function RiyaScriptProposal({ orgId }: { orgId: string | undefined }) {
  const qc = useQueryClient();
  const notify = useNotification();

  // All active scripts for the org — one per AI agent. The card lets you pick
  // which agent's pitch to review, so every agent (Riya, Anushree, …) gets the
  // same approve-and-deploy surface, not just the most-recently-created script.
  const { data: scripts } = useQuery({
    queryKey: ["ai-scripts-active", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data } = await supabase
        .from("ai_call_scripts")
        .select("id, product_name, opening, objective, key_points, closing, objection_handling, behavioral_guidelines")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("product_name", { ascending: true });
      return (data || []) as Script[];
    },
    enabled: !!orgId,
  });

  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  // Default to Riya (WorkSync) when present so the existing view is unchanged;
  // otherwise the first agent. Keeps the current selection if still valid.
  useEffect(() => {
    if (!scripts || scripts.length === 0) {
      setSelectedScriptId(null);
      return;
    }
    setSelectedScriptId((prev) => {
      if (prev && scripts.some((s) => s.id === prev)) return prev;
      const riya = scripts.find((s) => metaFor(s.product_name || "").agent === "Riya");
      return (riya ?? scripts[0]).id;
    });
  }, [scripts]);

  const script = scripts?.find((s) => s.id === selectedScriptId) || null;
  const agentName = agentNameFor(script?.product_name);

  const { data: proposal } = useQuery<Proposal | null>({
    queryKey: ["riya-proposal-pending", script?.id],
    queryFn: async () => {
      if (!script?.id) return null;
      const { data } = await supabase
        .from("ai_script_proposals")
        .select("*")
        .eq("script_id", script.id)
        .eq("status", "pending")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as Proposal | null;
    },
    enabled: !!script?.id,
    refetchInterval: 60_000,
  });

  // Decisions: default all proposed items to APPROVED on load
  const [decisions, setDecisions] = useState<Decisions | null>(null);

  useEffect(() => {
    if (!proposal) {
      setDecisions(null);
      return;
    }
    const kp = Array.isArray(proposal.proposed_key_points) ? proposal.proposed_key_points : [];
    const obj = proposal.proposed_objection_handling && typeof proposal.proposed_objection_handling === "object"
      ? proposal.proposed_objection_handling
      : {};
    const bg = splitLines(proposal.proposed_behavioral_guidelines);
    setDecisions({
      opening: !!proposal.proposed_opening,
      objective: !!proposal.proposed_objective,
      closing: !!proposal.proposed_closing,
      key_points: kp.map(() => true),
      objection_handling: Object.fromEntries(Object.keys(obj).map((k) => [k, true])),
      behavioral_guidelines: bg.map(() => true),
    });
  }, [proposal?.id]);

  const approvedCount = useMemo(() => {
    if (!decisions) return 0;
    let n = 0;
    if (decisions.opening) n++;
    if (decisions.objective) n++;
    if (decisions.closing) n++;
    n += decisions.key_points.filter(Boolean).length;
    n += Object.values(decisions.objection_handling).filter(Boolean).length;
    n += decisions.behavioral_guidelines.filter(Boolean).length;
    return n;
  }, [decisions]);

  const totalCount = useMemo(() => {
    if (!decisions) return 0;
    return (
      3 +
      decisions.key_points.length +
      Object.keys(decisions.objection_handling).length +
      decisions.behavioral_guidelines.length -
      [proposal?.proposed_opening, proposal?.proposed_objective, proposal?.proposed_closing].filter((x) => !x).length
    );
  }, [decisions, proposal]);

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!script?.id) throw new Error("No script selected");
      const { data, error } = await supabase.functions.invoke("ai-script-propose", { body: { script_id: script.id } });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || "Could not generate proposal");
      return data;
    },
    onSuccess: () => {
      notify.success("New proposal ready", "Latest call analysis applied.");
      qc.invalidateQueries({ queryKey: ["riya-proposal-pending", script?.id] });
    },
    onError: (e: unknown) => notify.error("Generation failed", e instanceof Error ? e.message : "Could not generate"),
  });

  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const regenField = useMutation({
    mutationFn: async (args: { field: string; index?: number; key?: string; busyKey: string }) => {
      if (!proposal) throw new Error("No proposal");
      setRegenBusy(args.busyKey);
      const { data, error } = await supabase.functions.invoke("ai-script-regenerate-field", {
        body: {
          proposal_id: proposal.id,
          field: args.field,
          index: args.index,
          key: args.key,
        },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || "Could not regenerate");
      return data;
    },
    onSettled: () => setRegenBusy(null),
    onSuccess: () => {
      notify.success("New option generated", "Item refreshed with a different option.");
      qc.invalidateQueries({ queryKey: ["riya-proposal-pending", script?.id] });
    },
    onError: (e: unknown) => notify.error("Regenerate failed", e instanceof Error ? e.message : "Could not regenerate"),
  });

  const applyApproved = useMutation({
    mutationFn: async () => {
      if (!proposal || !script || !decisions) throw new Error("No proposal");

      // Build merged update from current + approved proposed items
      const updates: any = { updated_at: new Date().toISOString() };

      // Single-string fields: replace only if approved
      if (decisions.opening && proposal.proposed_opening) updates.opening = proposal.proposed_opening;
      if (decisions.objective && proposal.proposed_objective) updates.objective = proposal.proposed_objective;
      if (decisions.closing && proposal.proposed_closing) updates.closing = proposal.proposed_closing;

      // Key points: add approved proposed items to current list (dedup by exact text)
      const proposedKP = Array.isArray(proposal.proposed_key_points) ? proposal.proposed_key_points : [];
      const approvedKP = proposedKP.filter((_, i) => decisions.key_points[i]);
      if (approvedKP.length > 0) {
        const currentKP = Array.isArray(script.key_points) ? script.key_points : [];
        const mergedKP = [...currentKP];
        for (const p of approvedKP) if (!mergedKP.includes(p)) mergedKP.push(p);
        updates.key_points = mergedKP;
      }

      // Objection handling: add/overwrite approved entries; keep existing keys untouched
      const proposedOH = proposal.proposed_objection_handling || {};
      const mergedOH: Record<string, string> = { ...(script.objection_handling || {}) };
      let oHChanged = false;
      for (const [k, v] of Object.entries(proposedOH)) {
        if (decisions.objection_handling[k]) {
          mergedOH[k] = v;
          oHChanged = true;
        }
      }
      if (oHChanged) updates.objection_handling = mergedOH;

      // Behavioral guidelines: add approved lines to current; dedup
      const proposedBGLines = splitLines(proposal.proposed_behavioral_guidelines);
      const approvedBG = proposedBGLines.filter((_, i) => decisions.behavioral_guidelines[i]);
      if (approvedBG.length > 0) {
        const currentBG = splitLines(script.behavioral_guidelines);
        const mergedBG = [...currentBG];
        for (const p of approvedBG) if (!mergedBG.includes(p)) mergedBG.push(p);
        updates.behavioral_guidelines = mergedBG.join("\n");
      }

      if (Object.keys(updates).length <= 1) {
        throw new Error("No items approved");
      }

      const { error: upErr } = await supabase
        .from("ai_call_scripts")
        .update(updates)
        .eq("id", script.id);
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      const { error: propErr } = await supabase
        .from("ai_script_proposals")
        .update({
          status: "approved",
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id,
        })
        .eq("id", proposal.id);
      if (propErr) throw propErr;

      const { data, error: fnErr } = await supabase.functions.invoke("ai-script-update", {
        body: { script_id: script.id },
      });
      if (fnErr) throw fnErr;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || "Bolna update failed");
      return data;
    },
    onSuccess: () => {
      notify.success("Applied & deployed", `${approvedCount} change(s) live on ${agentName}'s next call.`);
      qc.invalidateQueries({ queryKey: ["riya-proposal-pending", script?.id] });
      qc.invalidateQueries({ queryKey: ["ai-scripts-active", orgId] });
      qc.invalidateQueries({ queryKey: ["cd-ai-script", orgId] });
    },
    onError: (e: unknown) => notify.error("Apply failed", e instanceof Error ? e.message : "Could not apply"),
  });

  const rejectAll = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("No proposal");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("ai_script_proposals")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id,
        })
        .eq("id", proposal.id);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Proposal rejected", "Current script kept as-is.");
      qc.invalidateQueries({ queryKey: ["riya-proposal-pending", script?.id] });
    },
    onError: (e: unknown) => notify.error("Reject failed", e instanceof Error ? e.message : "Could not reject"),
  });

  if (!script) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No active script yet.
        </CardContent>
      </Card>
    );
  }

  const proposedKP = Array.isArray(proposal?.proposed_key_points) ? proposal!.proposed_key_points! : [];
  const proposedOH = proposal?.proposed_objection_handling || {};
  const proposedBGLines = splitLines(proposal?.proposed_behavioral_guidelines);

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Active Script
          <span className="ml-auto flex gap-2 items-center">
            {proposal && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30">
                <Sparkles className="h-3 w-3 mr-1" /> Proposal pending
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
              {regenerate.isPending ? "Generating…" : proposal ? "Regenerate" : "Generate proposal"}
            </Button>
          </span>
        </CardTitle>
        {scripts && scripts.length > 1 && (
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedScriptId ?? undefined} onValueChange={setSelectedScriptId}>
              <SelectTrigger className="w-[280px] h-8"><SelectValue placeholder="Pick an agent" /></SelectTrigger>
              <SelectContent>
                {scripts.map((s) => {
                  const m = metaFor(s.product_name || "");
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {m.agent !== "—" ? `${m.agent} — ${m.label}` : m.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Two columns */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Current */}
          <div className="space-y-3 md:border-r md:pr-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current (live on Bolna)</div>
            <CurrentView script={script} />
          </div>

          {/* Proposed with per-item approval */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {proposal ? `Proposed (from ${proposal.based_on_date} learnings)` : "Proposed"}
            </div>
            {!proposal ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
                No pending proposal. Click "Generate proposal" to draft one from today's learnings.
              </div>
            ) : (
              <ProposalApproval
                proposal={proposal}
                decisions={decisions}
                setDecisions={setDecisions}
                proposedKP={proposedKP}
                proposedOH={proposedOH}
                proposedBGLines={proposedBGLines}
                onRegenerate={(field, opts) =>
                  regenField.mutate({
                    field,
                    index: opts?.index,
                    key: opts?.key,
                    busyKey: `${field}:${opts?.index ?? opts?.key ?? ""}`,
                  })
                }
                regenBusy={regenBusy}
              />
            )}
          </div>
        </div>

        {/* Rationale */}
        {proposal?.rationale && (
          <div className="rounded-md p-3 bg-amber-500/[0.05] border border-amber-500/20">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">
              Why these changes
            </div>
            <p className="text-sm leading-relaxed">{proposal.rationale}</p>
          </div>
        )}

        {/* Action bar */}
        {proposal && (
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {approvedCount} of {totalCount} suggestions approved
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => rejectAll.mutate()}
                disabled={rejectAll.isPending || applyApproved.isPending}
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                {rejectAll.isPending ? "Rejecting…" : "Reject all"}
              </Button>
              <Button
                onClick={() => applyApproved.mutate()}
                disabled={rejectAll.isPending || applyApproved.isPending || approvedCount === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                {applyApproved.isPending ? "Deploying to Bolna…" : `Apply approved (${approvedCount})`}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CurrentView({ script }: { script: Script }) {
  const objEntries = script.objection_handling && typeof script.objection_handling === "object"
    ? Object.entries(script.objection_handling as Record<string, string>)
    : [];
  const bgLines = splitLines(script.behavioral_guidelines);
  return (
    <div className="space-y-2">
      <CurrentBlock label="Opening line" value={script.opening || ""} />
      <CurrentBlock label="Objective" value={script.objective || ""} />
      <CurrentBlock
        label="Key points"
        value={
          Array.isArray(script.key_points) && script.key_points.length > 0
            ? script.key_points.map((p) => `• ${p}`).join("\n")
            : ""
        }
        multiline
      />
      <CurrentBlock label="Closing" value={script.closing || ""} multiline />
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Objection handling</div>
        <div className="rounded-md p-2 border text-sm bg-muted/30">
          {objEntries.length === 0 ? (
            <span className="text-muted-foreground italic">(none)</span>
          ) : (
            <ul className="space-y-1">
              {objEntries.map(([k, v]) => (
                <li key={k}>
                  <span className="text-xs font-semibold text-muted-foreground">if "{k}"</span>
                  <div>{v}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Behavioral guidelines</div>
        <div className="rounded-md p-2 border text-sm bg-muted/30 whitespace-pre-wrap">
          {bgLines.length === 0 ? (
            <span className="text-muted-foreground italic">(none)</span>
          ) : (
            <ul className="space-y-0.5">
              {bgLines.map((l, i) => (
                <li key={i}>• {l}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CurrentBlock({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className={`rounded-md p-2 border text-sm bg-muted/30 ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value || <span className="text-muted-foreground italic">(empty)</span>}
      </div>
    </div>
  );
}

function ProposalApproval({
  proposal,
  decisions,
  setDecisions,
  proposedKP,
  proposedOH,
  proposedBGLines,
  onRegenerate,
  regenBusy,
}: {
  proposal: Proposal;
  decisions: Decisions | null;
  setDecisions: (d: Decisions) => void;
  proposedKP: string[];
  proposedOH: Record<string, string>;
  proposedBGLines: string[];
  onRegenerate: (field: string, opts?: { index?: number; key?: string }) => void;
  regenBusy: string | null;
}) {
  if (!decisions) return null;

  const flip = (path: (d: Decisions) => Decisions) => setDecisions(path({ ...decisions }));
  const isBusy = (busyKey: string) => regenBusy === busyKey;

  return (
    <div className="space-y-2">
      {proposal.proposed_opening && (
        <ProposedField
          label="Opening line"
          value={proposal.proposed_opening}
          approved={decisions.opening}
          onToggle={() => flip((d) => ({ ...d, opening: !d.opening }))}
          onRegenerate={() => onRegenerate("opening", {})}
          regenLoading={isBusy("opening:")}
        />
      )}
      {proposal.proposed_objective && (
        <ProposedField
          label="Objective"
          value={proposal.proposed_objective}
          approved={decisions.objective}
          onToggle={() => flip((d) => ({ ...d, objective: !d.objective }))}
          onRegenerate={() => onRegenerate("objective", {})}
          regenLoading={isBusy("objective:")}
        />
      )}
      {proposedKP.length > 0 && (
        <ProposedList
          label="Key points"
          items={proposedKP}
          approvals={decisions.key_points}
          onToggle={(i) =>
            flip((d) => {
              const arr = [...d.key_points];
              arr[i] = !arr[i];
              return { ...d, key_points: arr };
            })
          }
          onRegenerate={(i) => onRegenerate("key_points", { index: i })}
          regenLoadingIndex={(i) => isBusy(`key_points:${i}`)}
        />
      )}
      {proposal.proposed_closing && (
        <ProposedField
          label="Closing"
          value={proposal.proposed_closing}
          approved={decisions.closing}
          multiline
          onToggle={() => flip((d) => ({ ...d, closing: !d.closing }))}
          onRegenerate={() => onRegenerate("closing", {})}
          regenLoading={isBusy("closing:")}
        />
      )}
      {Object.keys(proposedOH).length > 0 && (
        <ProposedDict
          label="Objection handling"
          entries={Object.entries(proposedOH)}
          approvals={decisions.objection_handling}
          onToggle={(key) =>
            flip((d) => ({
              ...d,
              objection_handling: { ...d.objection_handling, [key]: !d.objection_handling[key] },
            }))
          }
          onRegenerate={(key) => onRegenerate("objection_handling", { key })}
          regenLoadingKey={(key) => isBusy(`objection_handling:${key}`)}
        />
      )}
      {proposedBGLines.length > 0 && (
        <ProposedList
          label="Behavioral guidelines"
          items={proposedBGLines}
          approvals={decisions.behavioral_guidelines}
          onToggle={(i) =>
            flip((d) => {
              const arr = [...d.behavioral_guidelines];
              arr[i] = !arr[i];
              return { ...d, behavioral_guidelines: arr };
            })
          }
          onRegenerate={(i) => onRegenerate("behavioral_guidelines", { index: i })}
          regenLoadingIndex={(i) => isBusy(`behavioral_guidelines:${i}`)}
        />
      )}
    </div>
  );
}

function ApprovalToggle({ approved, onToggle }: { approved: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full border transition",
        approved
          ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600"
          : "bg-background text-muted-foreground border-muted-foreground/40 hover:border-foreground/50"
      )}
      title={approved ? "Approved · click to skip" : "Skipped · click to approve"}
    >
      {approved ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
    </button>
  );
}

function ProposedField({
  label,
  value,
  approved,
  onToggle,
  onRegenerate,
  regenLoading,
  multiline,
}: {
  label: string;
  value: string;
  approved: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  regenLoading: boolean;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div
        className={cn(
          "rounded-md p-2 border text-sm flex items-start gap-2",
          approved ? "bg-emerald-500/[0.06] border-emerald-500/30" : "bg-muted/20 border-muted-foreground/20 opacity-60",
          multiline && "whitespace-pre-wrap"
        )}
      >
        <ApprovalToggle approved={approved} onToggle={onToggle} />
        <div className="flex-1 min-w-0">{value}</div>
        <RegenButton onClick={onRegenerate} loading={regenLoading} />
      </div>
    </div>
  );
}

function ProposedList({
  label,
  items,
  approvals,
  onToggle,
  onRegenerate,
  regenLoadingIndex,
}: {
  label: string;
  items: string[];
  approvals: boolean[];
  onToggle: (i: number) => void;
  onRegenerate: (i: number) => void;
  regenLoadingIndex: (i: number) => boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="rounded-md border p-2 bg-emerald-500/[0.03] border-emerald-500/20 space-y-1">
        {items.map((item, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2 rounded p-1.5 text-sm",
              approvals[i] ? "" : "opacity-50"
            )}
          >
            <ApprovalToggle approved={approvals[i]} onToggle={() => onToggle(i)} />
            <div className="flex-1 min-w-0">{item}</div>
            <RegenButton onClick={() => onRegenerate(i)} loading={regenLoadingIndex(i)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProposedDict({
  label,
  entries,
  approvals,
  onToggle,
  onRegenerate,
  regenLoadingKey,
}: {
  label: string;
  entries: [string, string][];
  approvals: Record<string, boolean>;
  onToggle: (key: string) => void;
  onRegenerate: (key: string) => void;
  regenLoadingKey: (key: string) => boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="rounded-md border p-2 bg-emerald-500/[0.03] border-emerald-500/20 space-y-1.5">
        {entries.map(([k, v]) => (
          <div
            key={k}
            className={cn(
              "flex items-start gap-2 rounded p-1.5 text-sm",
              approvals[k] ? "" : "opacity-50"
            )}
          >
            <ApprovalToggle approved={!!approvals[k]} onToggle={() => onToggle(k)} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-muted-foreground">if "{k}"</div>
              <div>{v}</div>
            </div>
            <RegenButton onClick={() => onRegenerate(k)} loading={regenLoadingKey(k)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RegenButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title="Get another option"
      className={cn(
        "shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full border bg-background text-muted-foreground border-muted-foreground/40 hover:border-foreground/50 hover:text-foreground transition",
        loading && "opacity-50 cursor-wait"
      )}
    >
      <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
    </button>
  );
}
