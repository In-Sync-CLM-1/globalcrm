import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, MessageSquare, Mail, Settings } from "lucide-react";
import { IEDUP_ORG_ID, useIsIedup } from "@/hooks/useIsIedup";
import { StageActionDialog } from "@/components/Iedup/StageActionDialog";

interface StageRow {
  id: string;
  name: string;
  stage_order: number;
}

interface ActionRow {
  id: string;
  stage_id: string;
  action_type: "call" | "whatsapp" | "email";
  template_name: string | null;
  language_code: string | null;
  whatsapp_template_id: string | null;
  email_template_id: string | null;
  is_active: boolean;
}

const CHANNEL_META: Record<ActionRow["action_type"], { label: string; icon: typeof Phone }> = {
  call: { label: "Call", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: MessageSquare },
  email: { label: "Email", icon: Mail },
};

export default function IedupAutomations() {
  const { isIedup, isLoading: orgLoading } = useIsIedup();
  const qc = useQueryClient();
  const [dialogStage, setDialogStage] = useState<StageRow | null>(null);

  const { data: stages = [] } = useQuery({
    queryKey: ["iedup-automation-stages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, stage_order")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("is_active", true)
        .order("stage_order");
      if (error) throw error;
      return (data || []) as StageRow[];
    },
    enabled: isIedup,
  });

  const { data: actions = [], refetch: refetchActions } = useQuery({
    queryKey: ["iedup-stage-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stage_actions")
        .select("id, stage_id, action_type, template_name, language_code, whatsapp_template_id, email_template_id, is_active")
        .eq("org_id", IEDUP_ORG_ID);
      if (error) throw error;
      return (data || []) as ActionRow[];
    },
    enabled: isIedup,
  });

  // Template names for display, resolved by id (fetched once, filtered client-side).
  const { data: waNames = new Map<string, string>() } = useQuery({
    queryKey: ["iedup-wa-template-names"],
    queryFn: async () => {
      const { data } = await supabase
        .from("communication_templates")
        .select("id, template_name")
        .eq("org_id", IEDUP_ORG_ID)
        .eq("template_type", "whatsapp");
      return new Map((data || []).map((t: any) => [t.id as string, t.template_name as string]));
    },
    enabled: isIedup,
  });
  const { data: emailNames = new Map<string, string>() } = useQuery({
    queryKey: ["iedup-email-template-names"],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("id, name")
        .eq("org_id", IEDUP_ORG_ID);
      return new Map((data || []).map((t: any) => [t.id as string, t.name as string]));
    },
    enabled: isIedup,
  });

  if (!orgLoading && !isIedup) {
    return <Navigate to="/dashboard" replace />;
  }

  const actionByStage = new Map(actions.map((a) => [a.stage_id, a]));

  function templateLabel(action: ActionRow | undefined): string {
    if (!action) return "Not configured";
    if (action.action_type === "call") return "Default calling agent";
    if (action.action_type === "whatsapp") {
      return (action.whatsapp_template_id && waNames.get(action.whatsapp_template_id)) || action.template_name || "Template missing";
    }
    if (action.action_type === "email") {
      return (action.email_template_id && emailNames.get(action.email_template_id)) || "Template missing";
    }
    return "Not configured";
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Each Action a beneficiary/contact can be set to on the Pipeline screen sends on one channel, using one
            approved template. Configure that here.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stages.length === 0 && (
              <p className="text-sm text-muted-foreground">No active stages found.</p>
            )}
            {stages.map((stage) => {
              const action = actionByStage.get(stage.id);
              const meta = action ? CHANNEL_META[action.action_type] : null;
              const Icon = meta?.icon;
              return (
                <div
                  key={stage.id}
                  className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{stage.name}</div>
                    <div className="text-sm text-muted-foreground truncate">{templateLabel(action)}</div>
                  </div>
                  {meta && Icon && (
                    <Badge variant="outline" className="whitespace-nowrap">
                      <Icon className="mr-1 h-3 w-3" />
                      {meta.label}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialogStage({ id: stage.id, name: stage.name, stage_order: stage.stage_order })}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Configure
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {dialogStage && (
        <StageActionDialog
          open={!!dialogStage}
          onOpenChange={(open) => !open && setDialogStage(null)}
          stage={dialogStage}
          existing={actionByStage.get(dialogStage.id) ?? null}
          onSaved={() => {
            refetchActions();
            qc.invalidateQueries({ queryKey: ["iedup-stage-actions"] });
          }}
        />
      )}
    </DashboardLayout>
  );
}
