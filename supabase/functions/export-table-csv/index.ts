import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "X-Row-Count, Content-Disposition, Content-Type",
};

const ALLOWED_TABLES = [
  // Users & Profiles
  "profiles", "user_roles", "auth_users",
  // Organizations
  "organizations", "org_invites", "org_feature_access", "org_business_hours",
  // Contacts & Pipeline
  "contacts", "contact_activities", "contact_emails", "contact_phones",
  "contact_custom_fields", "pipeline_stages",
  // Clients
  "clients", "client_invoices", "client_documents", "client_alternate_contacts",
  // Communication
  "communication_templates", "email_templates", "email_conversations",
  "whatsapp_messages", "sms_messages",
  // Campaigns
  "email_bulk_campaigns", "email_campaign_recipients",
  "whatsapp_bulk_campaigns", "whatsapp_campaign_recipients",
  "sms_bulk_campaigns", "sms_campaign_recipients",
  "campaign_analytics", "campaign_insights",
  // Tasks & Calendar
  "tasks", "calendar_shares", "activity_participants",
  // Call Logs
  "call_logs", "call_dispositions", "call_sub_dispositions", "agent_call_sessions",
  // Support
  "support_tickets", "support_ticket_comments", "support_ticket_history",
  // Email Automation
  "email_automation_rules", "email_automation_executions",
  "automation_ab_tests", "automation_approvals", "automation_performance_daily",
  // Forms & Connectors
  "forms", "connector_logs",
  // Webhooks
  "outbound_webhooks", "outbound_webhook_logs",
  // Teams & Designations
  "teams", "team_members", "designations", "reporting_hierarchy",
  // Custom Fields
  "custom_fields",
  // Blog
  "blog_posts",
  // API Keys
  "api_keys", "api_key_usage_logs",
  // Subscriptions & Billing
  "organization_subscriptions", "subscription_invoices", "wallet_transactions",
  "service_usage_logs", "subscription_pricing",
  // Bulk Import
  "bulk_import_history",
  // Notifications
  "notifications",
  // External Entities
  "external_entities",
  // Approvals
  "approval_types", "approval_rules",
  // Fervent Repository
  "fervent_data_repository",
  // Chat
  "chat_conversations", "chat_messages", "chat_participants",
  // Revenue
  "monthly_actuals_snapshot", "revenue_goals", "carry_forward_snapshot",
  // Lead Scoring
  "contact_lead_scores",
  // Suppression
  "email_suppression_list", "email_unsubscribes",
];

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const headerRow = headers.map(escapeCSV).join(",");
  const rows = data.map((row) => headers.map((h) => escapeCSV(row[h])).join(","));
  return headerRow + "\n" + rows.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Platform admin check
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", userData.user.id)
      .single();

    if (!profile?.is_platform_admin) {
      return new Response(JSON.stringify({ error: "Forbidden: platform admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const { table } = await req.json();
    if (!table || !ALLOWED_TABLES.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Invalid table: ${table}. Not in allowlist.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let allData: Record<string, unknown>[] = [];

    if (table === "auth_users") {
      // Special handling for auth.users
      let page = 1;
      const perPage = 1000;
      while (true) {
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        if (!users || users.length === 0) break;
        for (const u of users) {
          allData.push({
            id: u.id,
            email: u.email ?? "",
            phone: u.phone ?? "",
            email_confirmed_at: u.email_confirmed_at ?? "",
            created_at: u.created_at ?? "",
            updated_at: u.updated_at ?? "",
            last_sign_in_at: u.last_sign_in_at ?? "",
            full_name: (u.user_metadata as Record<string, unknown>)?.full_name ?? "",
            first_name: (u.user_metadata as Record<string, unknown>)?.first_name ?? "",
            last_name: (u.user_metadata as Record<string, unknown>)?.last_name ?? "",
          });
        }
        if (users.length < perPage) break;
        page++;
      }
    } else {
      // Standard table pagination
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabaseAdmin
          .from(table)
          .select("*")
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = [...allData, ...data];
        if (data.length < step) break;
        from += step;
      }
    }

    const csv = toCSV(allData);
    const today = new Date().toISOString().split("T")[0];
    const filename = `${table}_${today}.csv`;
    const body = "\uFEFF" + csv; // BOM prefix for Excel

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Row-Count": String(allData.length),
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
