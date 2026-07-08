import { ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Settings,
  Users,
  LogOut,
  Menu,
  X,
  Contact,
  GitBranch,
  Wallet,
  BarChart3,
  UserCog,
  TrendingUp,
  Lightbulb,
  UsersRound,
  Layers,
  PhoneCall,
  CheckSquare,
  Award,
  FileText,
  List,
  Sliders,
  ShieldCheck,
  Building2,
  Webhook,
  MessageSquare,
  Mail,
  Send,
  Activity,
  Star,
  MessageCircle,
  Phone,
  Sparkles,
  Briefcase,
  CalendarDays,
  ExternalLink,
  Clock,
  CalendarOff,
  ClipboardCheck,
} from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { OnboardingDialog } from "@/components/Onboarding/OnboardingDialog";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import SubscriptionStatusBanner from "@/components/Subscription/SubscriptionStatusBanner";
import { useModuleTracking } from "@/hooks/useModuleTracking";
import { useTopModules } from "@/hooks/useTopModules";
import { NotificationBell } from "./NotificationBell";
import { QuickDial } from "@/components/Contact/QuickDial";
import { CallbackReminderAlert } from "@/components/Contact/CallbackReminderAlert";
import { useAuth } from "@/contexts/AuthProvider";
import { useQuery } from "@tanstack/react-query";
 import { FloatingChatWidget } from "@/components/chat/FloatingChatWidget";
import { useTotalUnreadCount } from "@/hooks/useConversations";
import { IEDUP_ORG_ID } from "@/hooks/useIsIedup";
import { FERVENT_ORG_ID } from "@/hooks/useIsFervent";

interface DashboardLayoutProps {
  children: ReactNode;
}

function DashboardLayout({ children }: DashboardLayoutProps) {
  const navigate = useNavigate();
  const notify = useNotification();
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { canAccessFeature, loading: featureAccessLoading } = useFeatureAccess();
  
  // Track module usage and get top modules
  useModuleTracking();
  const { data: topModules = [] } = useTopModules(6);
  const totalUnreadMessages = useTotalUnreadCount();

  // Fetch user profile and role data using React Query (cached)
  const { data: userData } = useQuery({
    queryKey: ["dashboard-user-data", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      // Batch all queries together
      const [roleRes, profileRes] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("first_name, last_name, org_id, is_platform_admin, onboarding_completed")
          .eq("id", user.id)
          .single()
      ]);

      let orgData = null;
      if (profileRes.data?.org_id) {
        const { data } = await supabase
          .from("organizations")
          .select("logo_url, name")
          .eq("id", profileRes.data.org_id)
          .single();
        orgData = data;
      }

      return {
        role: roleRes.data?.role || null,
        profile: profileRes.data,
        org: orgData,
      };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Derived state from cached data
  const userRole = userData?.role || null;
  const userName = userData?.profile
    ? `${userData.profile.first_name} ${userData.profile.last_name}`
    : "";
  const isPlatformAdmin = userData?.profile?.is_platform_admin || false;
  const orgLogo = userData?.org?.logo_url || "";
  const orgName = userData?.org?.name || "";
  const onboardingCompleted = userData?.profile?.onboarding_completed || false;
  const isIedup = userData?.profile?.org_id === IEDUP_ORG_ID;
  const isFervent = userData?.profile?.org_id === FERVENT_ORG_ID;

  // Check if user needs onboarding
  useEffect(() => {
    if (userData && !onboardingCompleted && userRole) {
      setShowOnboarding(true);
    }
  }, [userData, onboardingCompleted, userRole]);

  const handleSignOut = async () => {
    await signOut();
    notify.success("Signed out", "You've been successfully signed out");
    navigate("/login");
  };

  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isManager = userRole === "admin" || userRole === "super_admin" || userRole === "sales_manager" || userRole === "support_manager";

  // Check if sections should be visible
  const showDashboardsSection = canAccessFeature("analytics") || canAccessFeature("calling") || 
    canAccessFeature("campaigns_email") || canAccessFeature("campaigns_whatsapp") || canAccessFeature("ai_insights");
  
  const showOperationsSection = canAccessFeature("campaigns_email") || canAccessFeature("contacts") || 
    canAccessFeature("pipeline_stages") || canAccessFeature("calling");
  
  const showAdminCommunicationSection = isAdmin && (
    canAccessFeature("campaigns_whatsapp") || 
    canAccessFeature("email_settings") ||
    canAccessFeature("calling") || 
    canAccessFeature("templates")
  );
  
  const showAdminMainSection = isAdmin && (
    canAccessFeature("organization_settings") || 
    canAccessFeature("pipeline_stages") || 
    canAccessFeature("calling") || 
    canAccessFeature("approval_matrix") ||
    canAccessFeature("designations") || 
    canAccessFeature("custom_fields") || 
    canAccessFeature("forms")
  );
  
  const showManagementSection = isManager && (
    canAccessFeature("users") ||
    canAccessFeature("teams") ||
    canAccessFeature("designations") ||
    canAccessFeature("approval_matrix") ||
    canAccessFeature("hr_approvals")
  );

  return (
    <div className="h-screen overflow-hidden bg-background">
      {/* Mobile header */}
      <div className="lg:hidden bg-card border-b border-border px-3 py-2 flex items-center justify-between">
        {orgLogo ? (
          <img src={orgLogo} alt="Organization Logo" className="h-8 object-contain" />
        ) : (
          <h1 className="text-lg font-semibold text-primary">In-Sync</h1>
        )}
        <div className="flex items-center gap-1">
          {!isPlatformAdmin && <QuickDial />}
          {!isPlatformAdmin && <NotificationBell />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-3rem)] lg:h-screen">
        {/* Sidebar - Dark Gradient Design */}
        <aside
          className={`
            fixed lg:sticky inset-y-0 left-0 z-50 lg:top-0 lg:h-screen
            w-56 bg-sidebar border-r border-sidebar-border
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
          style={{ background: 'var(--gradient-sidebar)' }}
        >
          <div className="h-full lg:h-screen flex flex-col overflow-y-auto scrollbar-hide">
            {/* Logo */}
            <div className="p-4 border-b border-sidebar-border flex flex-col items-center">
              {orgLogo ? (
                <div className="bg-white rounded-lg p-2 mb-2">
                  <img src={orgLogo} alt="Organization Logo" className="h-[100px] object-contain" />
                </div>
              ) : (
                <h1 className="text-xl font-semibold text-sidebar-primary">In-Sync</h1>
              )}
              <p className="text-base font-semibold text-sidebar-foreground truncate max-w-full">{userName}</p>
            </div>

            {/* Navigation - Compact */}
            <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto scrollbar-hide">
              {/* Platform admin: only show Platform link */}
              {isPlatformAdmin && (
                <>
                  <div className="pt-3 pb-1 px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                      Platform
                    </p>
                  </div>
                  <Link
                    to="/platform-admin"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground bg-sidebar-accent text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <ShieldCheck size={16} className="shrink-0" />
                    <span>Command Center</span>
                  </Link>
                </>
              )}

              {/* IEDUP-only minimal navigation: Dashboard + Pipeline + Users */}
              {!isPlatformAdmin && isIedup && (
                <>
                  <Link
                    to="/dashboard"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <LayoutDashboard size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Dashboard</span>
                  </Link>
                  <Link
                    to="/pipeline"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <GitBranch size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Pipeline</span>
                  </Link>
                  <Link
                    to="/users"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <UserCog size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Users</span>
                  </Link>
                  <Link
                    to="/billing"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Wallet size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Billing</span>
                  </Link>
                </>
              )}

              {/* Fervent-only minimal navigation: Dashboard + Fervent Database + Users + Billing */}
              {!isPlatformAdmin && isFervent && (
                <>
                  <Link
                    to="/dashboard"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <LayoutDashboard size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Dashboard</span>
                  </Link>
                  <Link
                    to="/data-repository"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <List size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Fervent Database</span>
                  </Link>
                  <Link
                    to="/users"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <UserCog size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Users</span>
                  </Link>
                  <Link
                    to="/billing"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Wallet size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Billing</span>
                  </Link>
                </>
              )}

              {/* Regular user navigation */}
              {!isPlatformAdmin && !isIedup && !isFervent && (
                <>
              {/* Dashboards & Reports Section */}
              {showDashboardsSection && (
                <div className="pt-3 pb-1 px-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                    Dashboards
                  </p>
                </div>
              )}

              {canAccessFeature("dashboard") && (
                <Link
                  to="/dashboard"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                  onClick={() => setSidebarOpen(false)}
                >
                  <LayoutDashboard size={16} className="shrink-0 text-sidebar-muted" />
                  <span>Dashboard</span>
                </Link>
              )}

              <Link
                to="/calendar"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                onClick={() => setSidebarOpen(false)}
              >
                <CalendarDays size={16} className="shrink-0 text-sidebar-muted" />
                <span>Calendar</span>
              </Link>

              {/* Operations Section */}
              {showOperationsSection && (
                <div className="pt-3 pb-1 px-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                    Operations
                  </p>
                </div>
              )}

              {canAccessFeature("pipeline_stages") && (
                <Link
                  to="/pipeline"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                  onClick={() => setSidebarOpen(false)}
                >
                  <GitBranch size={16} className="shrink-0 text-sidebar-muted" />
                  <span>Pipeline</span>
                </Link>
              )}

              {canAccessFeature("contacts") && (
                <Link
                  to="/contacts"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                  onClick={() => setSidebarOpen(false)}
                >
                  <Contact size={16} className="shrink-0 text-sidebar-muted" />
                  <span>Contacts</span>
                </Link>
              )}

              {(canAccessFeature("campaigns_whatsapp") || canAccessFeature("campaigns_email")) && (
                <>
                  <div className="pt-3 pb-1 px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                      Campaigns
                    </p>
                  </div>
                  {canAccessFeature("campaigns_whatsapp") && (
                    <a
                      href="https://wa.in-sync.co.in"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <MessageSquare size={16} className="shrink-0 text-sidebar-muted" />
                      <span>WhatsApp</span>
                      <ExternalLink size={12} className="ml-auto shrink-0 text-sidebar-muted opacity-50" />
                    </a>
                  )}
                  {canAccessFeature("campaigns_email") && (
                    <a
                      href="https://email.in-sync.co.in"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Mail size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Email</span>
                      <ExternalLink size={12} className="ml-auto shrink-0 text-sidebar-muted opacity-50" />
                    </a>
                  )}
                </>
              )}

               <Link
                 to="/chat"
                 className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                   totalUnreadMessages > 0
                     ? "bg-sidebar-accent text-sidebar-primary font-semibold"
                     : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
                 }`}
                 onClick={() => setSidebarOpen(false)}
               >
                 <MessageCircle
                   size={16}
                   className={`shrink-0 ${totalUnreadMessages > 0 ? "text-sidebar-primary" : "text-sidebar-muted"}`}
                 />
                 <span>Messages</span>
                 {totalUnreadMessages > 0 && (
                   <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                     {totalUnreadMessages > 99 ? "99+" : totalUnreadMessages}
                   </span>
                 )}
               </Link>

              {canAccessFeature("templates") && (
                <Link
                  to="/templates"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                  onClick={() => setSidebarOpen(false)}
                >
                  <FileText size={16} className="shrink-0 text-sidebar-muted" />
                  <span>Templates</span>
                </Link>
              )}

              {/* HR Section */}
              {(canAccessFeature("attendance") || canAccessFeature("leave_management")) && (
                <div className="pt-3 pb-1 px-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                    HR
                  </p>
                </div>
              )}
              {canAccessFeature("attendance") && (
                <Link
                  to="/attendance"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                  onClick={() => setSidebarOpen(false)}
                >
                  <Clock size={16} className="shrink-0 text-sidebar-muted" />
                  <span>Attendance</span>
                </Link>
              )}
              {canAccessFeature("leave_management") && (
                <Link
                  to="/leave"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                  onClick={() => setSidebarOpen(false)}
                >
                  <CalendarOff size={16} className="shrink-0 text-sidebar-muted" />
                  <span>Leave</span>
                </Link>
              )}

              {canAccessFeature("clients") && (
                <>
                  <div className="pt-3 pb-1 px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                      Clients
                    </p>
                  </div>

                  <Link
                    to="/clients"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Briefcase size={16} className="shrink-0 text-sidebar-muted" />
                    <span>Clients</span>
                  </Link>
                </>
              )}

              {showManagementSection && (
                <>
                  <div className="pt-3 pb-1 px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                      Management
                    </p>
                  </div>
                  {canAccessFeature("users") && (
                    <Link
                      to="/users"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <UserCog size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Users</span>
                    </Link>
                  )}
                  {canAccessFeature("teams") && (
                    <Link
                      to="/teams"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <UsersRound size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Teams</span>
                    </Link>
                  )}
                  {canAccessFeature("designations") && (
                    <Link
                      to="/admin/designations"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Award size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Designations</span>
                    </Link>
                  )}
                  {canAccessFeature("hr_approvals") && (
                    <Link
                      to="/hr-approvals"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <ClipboardCheck size={16} className="shrink-0 text-sidebar-muted" />
                      <span>HR Approvals</span>
                    </Link>
                  )}
                  {canAccessFeature("hr_approvals") && (
                    <Link
                      to="/admin/attendance-report"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <BarChart3 size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Attendance Report</span>
                    </Link>
                  )}
                  {canAccessFeature("hr_approvals") && (
                    <Link
                      to="/admin/sdr-test"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Briefcase size={16} className="shrink-0 text-sidebar-muted" />
                      <span>SDR Test</span>
                    </Link>
                  )}
                  {canAccessFeature("approval_matrix") && (
                    <Link
                      to="/admin/approval-matrix"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <CheckSquare size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Approvals</span>
                    </Link>
                  )}
                </>
              )}


              {isAdmin && (
                <>
                  {showAdminMainSection && (
                    <div className="pt-3 pb-1 px-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                        Admin
                      </p>
                    </div>
                  )}

                  {canAccessFeature("pipeline_stages") && (
                    <Link
                      to="/admin/pipeline-stages"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Layers size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Stages</span>
                    </Link>
                  )}

                  {canAccessFeature("calling") && (
                    <Link
                      to="/admin/call-dispositions"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <PhoneCall size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Dispositions</span>
                    </Link>
                  )}

                  {canAccessFeature("custom_fields") && (
                    <Link
                      to="/admin/custom-fields"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Sliders size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Fields</span>
                    </Link>
                  )}

                  {canAccessFeature("forms") && (
                    <Link
                      to="/admin/forms"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <FileText size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Forms</span>
                    </Link>
                  )}

                  {canAccessFeature("organization_settings") && (
                    <Link
                      to="/admin"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Building2 size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Settings</span>
                    </Link>
                  )}

                  {userRole === "admin" && (
                    <Link
                      to="/admin/data-protection"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <ShieldCheck size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Data Protection</span>
                    </Link>
                  )}

                  {showAdminCommunicationSection && (
                    <div className="pt-3 pb-1 px-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                        Comms
                      </p>
                    </div>
                  )}

                  {(canAccessFeature("campaigns_whatsapp") || canAccessFeature("email_settings") || canAccessFeature("calling")) && (
                    <Link
                      to="/admin/communication-settings"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Settings size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Comm Settings</span>
                    </Link>
                  )}

                  {userRole === "admin" && (
                    <Link
                      to="/apollo-settings"
                      className="flex items-center gap-2 px-2 py-1.5 pl-6 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Sparkles size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Apollo</span>
                    </Link>
                  )}

                </>
              )}

              {isAdmin && (
                <>
                  {canAccessFeature("connectors") && (
                    <div className="pt-3 pb-1 px-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                        Integrations
                      </p>
                    </div>
                  )}

                  {canAccessFeature("connectors") && (
                    <Link
                      to="/admin/connectors"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Webhook size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Webhooks</span>
                    </Link>
                  )}

                  {canAccessFeature("connectors") && (
                    <Link
                      to="/admin/outbound-webhooks"
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Send size={16} className="shrink-0 text-sidebar-muted" />
                      <span>Outbound</span>
                    </Link>
                  )}


                </>
              )}
                </>
              )}

            </nav>

            {/* Sign out - Compact */}
            <div className="p-2 border-t border-sidebar-border">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary"
                onClick={handleSignOut}
              >
                <LogOut size={16} className="mr-2 text-sidebar-muted" />
                Sign Out
              </Button>
            </div>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content - Compact */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Desktop header with notifications */}
          {!isPlatformAdmin && (
            <div className="hidden lg:flex items-center justify-end gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
              <NotificationBell />
            </div>
          )}
          {!isPlatformAdmin && <SubscriptionStatusBanner />}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-6">
            {children}
          </div>
        </main>
      </div>
      
      {/* Onboarding Dialog */}
      {!isPlatformAdmin && userData && showOnboarding && userRole && (
        <OnboardingDialog
          open={showOnboarding}
          userRole={userRole}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Callback Reminder Alert */}
      {!isPlatformAdmin && <CallbackReminderAlert />}

       {/* Floating Chat Widget */}
       {!isPlatformAdmin && <FloatingChatWidget />}
    </div>
  );
}

export default DashboardLayout;
export { DashboardLayout };
