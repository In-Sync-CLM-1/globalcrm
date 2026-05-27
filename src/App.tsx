import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/contexts/AuthProvider";
import { OrgContextProvider } from "@/contexts/OrgContextProvider";

// Retry wrapper for lazy imports - handles chunk hash changes after deployment
function lazyRetry(fn: () => Promise<any>) {
  return lazy(() =>
    fn().catch(() => {
      // Chunk likely changed after deploy; reload once to get fresh HTML
      const key = "chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
      return fn(); // fallback: try again
    })
  );
}

// Static imports - public/auth pages only
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import ResetPassword from "./pages/ResetPassword";
import PublicForm from "./pages/PublicForm";
import ProtectedRoute from "./components/Auth/ProtectedRoute";
import LandingPage from "./pages/LandingPage";
import Install from "./pages/Install";

// Page loader component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// Lazy loaded pages - CRM
const Dashboard = lazyRetry(() => import("./pages/Dashboard"));
const Billing = lazyRetry(() => import("./pages/Billing"));
const Contacts = lazyRetry(() => import("./pages/Contacts"));
const ContactDetail = lazyRetry(() => import("./pages/ContactDetail"));
const PipelineBoard = lazyRetry(() => import("./pages/PipelineBoard"));
const PipelineAdvancedSearch = lazyRetry(() => import("./pages/PipelineAdvancedSearch"));
const ClientHub = lazyRetry(() => import("./pages/ClientHub"));
const ClientDetail = lazyRetry(() => import("./pages/ClientDetail"));

// Lazy loaded pages - Reports & Analytics
const Reports = lazyRetry(() => import("./pages/Reports"));
const ReportBuilder = lazyRetry(() => import("./pages/ReportBuilder"));
const SavedReports = lazyRetry(() => import("./pages/SavedReports"));
const CallingDashboard = lazyRetry(() => import("./pages/CallingDashboard"));
const CallLogs = lazyRetry(() => import("./pages/CallLogs"));

// Lazy loaded pages - Templates (campaigns are external: wa.in-sync.co.in / email.in-sync.co.in)
const Templates = lazyRetry(() => import("./pages/Templates"));
const TemplateBuilder = lazyRetry(() => import("./pages/TemplateBuilder"));

// Lazy loaded pages - Admin
const TechAdmin = lazyRetry(() => import("./pages/TechAdmin"));
const Users = lazyRetry(() => import("./pages/Users"));
const Teams = lazyRetry(() => import("./pages/Teams"));
const PipelineStages = lazyRetry(() => import("./pages/PipelineStages"));
const CallDispositions = lazyRetry(() => import("./pages/CallDispositions"));
const ApprovalMatrix = lazyRetry(() => import("./pages/ApprovalMatrix"));
const Designations = lazyRetry(() => import("./pages/Designations"));
const CustomFields = lazyRetry(() => import("./pages/CustomFields"));
const Forms = lazyRetry(() => import("./pages/Forms"));
const Connectors = lazyRetry(() => import("./pages/Connectors"));
const OutboundWebhooks = lazyRetry(() => import("./pages/OutboundWebhooks"));
const CommunicationSettings = lazyRetry(() => import("./pages/CommunicationSettings"));
const WhatsAppSettings = lazyRetry(() => import("./pages/WhatsAppSettings"));
const ExotelSettings = lazyRetry(() => import("./pages/ExotelSettings"));
const ApolloSettings = lazyRetry(() => import("./pages/ApolloSettings"));
const EmailSettings = lazyRetry(() => import("./pages/EmailSettings"));

// Lazy loaded pages - Walkthroughs & Onboarding
const Demo = lazyRetry(() => import("./pages/Demo"));
const LandingDemo = lazyRetry(() => import("./pages/LandingDemo"));
const OnboardingWizard = lazyRetry(() => import("./pages/OnboardingWizard"));

// Lazy loaded pages - Other
const DataExport = lazyRetry(() => import("./pages/admin/DataExport"));
const PlatformAdmin = lazyRetry(() => import("./pages/PlatformAdmin"));
const Calendar = lazyRetry(() => import("./pages/Calendar"));
const Chat = lazyRetry(() => import("./pages/Chat"));
const Attendance = lazyRetry(() => import("./pages/Attendance"));
const LeaveManagement = lazyRetry(() => import("./pages/LeaveManagement"));
const HRApprovals = lazyRetry(() => import("./pages/HRApprovals"));
const SDRAttendanceReport = lazyRetry(() => import("./pages/admin/SDRAttendanceReport"));
const SdrTestLanding = lazyRetry(() => import("./pages/recruit/SdrTestLanding"));
const SdrTestRun = lazyRetry(() => import("./pages/recruit/SdrTestRun"));
const SdrTestDone = lazyRetry(() => import("./pages/recruit/SdrTestDone"));
const SdrTestAdmin = lazyRetry(() => import("./pages/recruit/SdrTestAdmin"));

const App = () => (
  <AuthProvider>
    <OrgContextProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/install" element={<Install />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/landing-demo" element={<LandingDemo />} />
          <Route path="/form/:formId" element={<PublicForm />} />

          {/* Onboarding */}
          <Route path="/onboarding" element={
            <ProtectedRoute>
              <OnboardingWizard />
            </ProtectedRoute>
          } />
          {/* CRM Routes */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          
          <Route path="/contacts" element={
            <ProtectedRoute>
              <Contacts />
            </ProtectedRoute>
          } />
          
          <Route path="/contacts/:id" element={
            <ProtectedRoute>
              <ContactDetail />
            </ProtectedRoute>
          } />
          
          <Route path="/pipeline" element={
            <ProtectedRoute>
              <PipelineBoard />
            </ProtectedRoute>
          } />

          <Route path="/billing" element={
            <ProtectedRoute>
              <Billing />
            </ProtectedRoute>
          } />
          
          <Route path="/pipeline/advanced-search" element={
            <ProtectedRoute>
              <PipelineAdvancedSearch />
            </ProtectedRoute>
          } />
          
          <Route path="/clients" element={
            <ProtectedRoute>
              <ClientHub />
            </ProtectedRoute>
          } />
          
          <Route path="/clients/:id" element={
            <ProtectedRoute>
              <ClientDetail />
            </ProtectedRoute>
          } />
          
          {/* Reports & Analytics Routes */}
          <Route path="/reports" element={
            <ProtectedRoute>
              <Reports />
            </ProtectedRoute>
          } />
          
          <Route path="/reports/builder" element={
            <ProtectedRoute>
              <ReportBuilder />
            </ProtectedRoute>
          } />
          
          <Route path="/reports/saved" element={
            <ProtectedRoute>
              <SavedReports />
            </ProtectedRoute>
          } />
          
          <Route path="/calling-dashboard" element={
            <ProtectedRoute>
              <CallingDashboard />
            </ProtectedRoute>
          } />


          <Route path="/call-logs" element={
            <ProtectedRoute>
              <CallLogs />
            </ProtectedRoute>
          } />
          
          {/* Campaign Routes */}
          <Route path="/templates" element={
            <ProtectedRoute>
              <Templates />
            </ProtectedRoute>
          } />
          
          <Route path="/templates/create" element={
            <ProtectedRoute>
              <TemplateBuilder />
            </ProtectedRoute>
          } />
          
          {/* Campaigns are external: wa.in-sync.co.in / email.in-sync.co.in */}
          
          {/* HR Routes */}
          <Route path="/attendance" element={
            <ProtectedRoute>
              <Attendance />
            </ProtectedRoute>
          } />

          <Route path="/leave" element={
            <ProtectedRoute>
              <LeaveManagement />
            </ProtectedRoute>
          } />

          <Route path="/hr-approvals" element={
            <ProtectedRoute requiredRole="admin">
              <HRApprovals />
            </ProtectedRoute>
          } />

          <Route path="/admin/attendance-report" element={
            <ProtectedRoute requiredRole="admin">
              <SDRAttendanceReport />
            </ProtectedRoute>
          } />

          {/* SDR recruitment test — candidate side is public, admin side gated */}
          <Route path="/recruit/sdr-test" element={<SdrTestLanding />} />
          <Route path="/recruit/sdr-test/run" element={<SdrTestRun />} />
          <Route path="/recruit/sdr-test/done" element={<SdrTestDone />} />
          <Route path="/admin/sdr-test" element={
            <ProtectedRoute requiredRole="admin">
              <SdrTestAdmin />
            </ProtectedRoute>
          } />
          <Route path="/admin/sdr-test/:attemptId" element={
            <ProtectedRoute requiredRole="admin">
              <SdrTestAdmin />
            </ProtectedRoute>
          } />

          {/* Admin Routes */}
          <Route path="/admin" element={
            <ProtectedRoute requiredRole="admin">
              <TechAdmin />
            </ProtectedRoute>
          } />
          
          <Route path="/users" element={
            <ProtectedRoute requiredRole="admin">
              <Users />
            </ProtectedRoute>
          } />
          
          <Route path="/teams" element={
            <ProtectedRoute requiredRole="admin">
              <Teams />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/pipeline-stages" element={
            <ProtectedRoute requiredRole="admin">
              <PipelineStages />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/call-dispositions" element={
            <ProtectedRoute requiredRole="admin">
              <CallDispositions />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/approval-matrix" element={
            <ProtectedRoute requiredRole="admin">
              <ApprovalMatrix />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/designations" element={
            <ProtectedRoute requiredRole="admin">
              <Designations />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/custom-fields" element={
            <ProtectedRoute requiredRole="admin">
              <CustomFields />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/forms" element={
            <ProtectedRoute requiredRole="admin">
              <Forms />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/connectors" element={
            <ProtectedRoute requiredRole="admin">
              <Connectors />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/outbound-webhooks" element={
            <ProtectedRoute requiredRole="admin">
              <OutboundWebhooks />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/communication-settings" element={
            <ProtectedRoute requiredRole="admin">
              <CommunicationSettings />
            </ProtectedRoute>
          } />
          
          <Route path="/whatsapp-settings" element={
            <ProtectedRoute requiredRole="admin">
              <WhatsAppSettings />
            </ProtectedRoute>
          } />
          
          <Route path="/exotel-settings" element={
            <ProtectedRoute requiredRole="admin">
              <ExotelSettings />
            </ProtectedRoute>
          } />
          
          <Route path="/apollo-settings" element={
            <ProtectedRoute requiredRole="admin">
              <ApolloSettings />
            </ProtectedRoute>
          } />
          
          {/* Other Routes */}
          <Route path="/platform-admin" element={
            <ProtectedRoute>
              <PlatformAdmin />
            </ProtectedRoute>
          } />
          
          <Route path="/admin/data-export" element={
            <ProtectedRoute>
              <DataExport />
            </ProtectedRoute>
          } />
          
          <Route path="/calendar" element={
            <ProtectedRoute>
              <Calendar />
            </ProtectedRoute>
          } />
          
           <Route path="/chat" element={
             <ProtectedRoute>
               <Chat />
             </ProtectedRoute>
           } />
           
           <Route path="/chat/:conversationId" element={
             <ProtectedRoute>
               <Chat />
             </ProtectedRoute>
           } />
           
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </OrgContextProvider>
</AuthProvider>
);

export default App;
