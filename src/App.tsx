import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Overview } from './pages/Overview';
import { Connectivity } from './pages/Connectivity';
import { DevicesPage } from './pages/Devices';
import { TrafficPolicyPage } from './pages/TrafficPolicy';
import { OnboardingPage } from './pages/Onboarding';
import { AskAiPage } from './pages/AskAi';
import { SettingsPage } from './pages/Settings';
import { DynamicPathSelectionPage } from './pages/DynamicPathSelection';
import { ApplicationAwareRoutingPage } from './pages/ApplicationAwareRouting';
import { FleetPage } from './pages/Fleet';
import { IncidentsPage } from './pages/Incidents';
import { AuditLogPage } from './pages/AuditLog';
import { CostInsightsPage } from './pages/CostInsights';
import { NaasPage } from './pages/Naas';
import { SecurityPage } from './pages/Security';
import { VideoAnalyticsPage } from './pages/VideoAnalytics';
import { AgenticAIPage } from './pages/AgenticAI';
import { alerts, branches } from './data/mock';
import { ToastProvider } from './ui/Toast';
import { LiveDataProvider } from './ui/LiveData';
import { OpsIncidentsProvider } from './ui/OpsIncidents';
import { CommandPalette } from './ui/CommandPalette';
import { NotificationsDrawer } from './ui/NotificationsDrawer';

// Default branch — McKinney (backed by the prpl/ipsec/metrics live feed).
// Falls back to the first configured branch if the id ever drifts.
const DEFAULT_BRANCH_ID = branches.find((b) => b.id === 'b-mck-03')?.id ?? branches[0].id;

export default function App() {
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH_ID);
  const [cmdOpen, setCmdOpen]   = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const activeAlerts = alerts.filter((a) => a.level !== 'ok').length;
  const location = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close transient overlays whenever the route changes so a drawer opened on
  // one page doesn't hang around obscuring the next page's content.
  useEffect(() => {
    setNotifOpen(false);
    setCmdOpen(false);
  }, [location.pathname]);

  return (
    <ToastProvider>
     <LiveDataProvider>
      <OpsIncidentsProvider>
      <div className="app-shell">
        <TopBar
          branchId={branchId}
          onBranchChange={setBranchId}
          alertCount={activeAlerts}
          onOpenCommand={() => setCmdOpen(true)}
          onOpenNotifications={() => setNotifOpen(true)}
        />
        <Sidebar />
        <main className="main">
          <div key={location.pathname} className="page-transition">
            <Routes location={location}>
              <Route path="/"               element={<Overview branchId={branchId} onSelectBranch={setBranchId} />} />
              <Route path="/fleet"          element={<FleetPage />} />
              <Route path="/connectivity"   element={<Connectivity />} />
              <Route path="/it-devices"     element={<DevicesPage domain="IT" />} />
              <Route path="/ot-devices"     element={<DevicesPage domain="OT" />} />
              <Route path="/naas"           element={<NaasPage />} />
              <Route path="/cost-insights" element={<CostInsightsPage branchId={branchId} />} />
              <Route path="/incidents"      element={<IncidentsPage />} />
              <Route path="/security"       element={<SecurityPage />} />
              <Route path="/video-analytics" element={<VideoAnalyticsPage />} />
              <Route path="/audit"          element={<AuditLogPage />} />
              <Route path="/path-selection" element={<DynamicPathSelectionPage branchId={branchId} />} />
              <Route path="/app-routing"    element={<ApplicationAwareRoutingPage />} />
              <Route path="/traffic-policy" element={<TrafficPolicyPage />} />
              <Route path="/onboarding"     element={<OnboardingPage branchId={branchId} />} />
              <Route path="/ask-ai"         element={<AskAiPage />} />
              <Route path="/agentic-ai"     element={<AgenticAIPage />} />
              <Route path="/settings"       element={<SettingsPage />} />
            </Routes>
          </div>
        </main>
      </div>
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onBranchChange={setBranchId}
      />
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
      </OpsIncidentsProvider>
     </LiveDataProvider>
    </ToastProvider>
  );
}
