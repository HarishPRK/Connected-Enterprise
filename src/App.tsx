import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { alerts, branches } from './data/mock';
import { ToastProvider } from './ui/Toast';
import { LiveDataProvider } from './ui/LiveData';
import { OpsIncidentsProvider } from './ui/OpsIncidents';
import { CommandPalette } from './ui/CommandPalette';
import { NotificationsDrawer } from './ui/NotificationsDrawer';

/* Route pages are code-split so the initial download is just the app shell +
 * router, not all 17 pages (recharts, the SVG topology, and the 6k-line
 * failover page were forcing a single ~1.2 MB bundle). Each page streams as
 * its own chunk on first navigation; the shell paints immediately. Pages use
 * named exports, hence the `.then` remap to a default for React.lazy. */
const Overview                   = lazy(() => import('./pages/Overview').then((m) => ({ default: m.Overview })));
const Connectivity               = lazy(() => import('./pages/Connectivity').then((m) => ({ default: m.Connectivity })));
const DevicesPage                = lazy(() => import('./pages/Devices').then((m) => ({ default: m.DevicesPage })));
const TrafficPolicyPage          = lazy(() => import('./pages/TrafficPolicy').then((m) => ({ default: m.TrafficPolicyPage })));
const OnboardingPage             = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.OnboardingPage })));
const AskAiPage                  = lazy(() => import('./pages/AskAi').then((m) => ({ default: m.AskAiPage })));
const SettingsPage               = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const DynamicPathSelectionPage   = lazy(() => import('./pages/DynamicPathSelection').then((m) => ({ default: m.DynamicPathSelectionPage })));
const ApplicationAwareRoutingPage = lazy(() => import('./pages/ApplicationAwareRouting').then((m) => ({ default: m.ApplicationAwareRoutingPage })));
const FleetPage                  = lazy(() => import('./pages/Fleet').then((m) => ({ default: m.FleetPage })));
const IncidentsPage              = lazy(() => import('./pages/Incidents').then((m) => ({ default: m.IncidentsPage })));
const AuditLogPage               = lazy(() => import('./pages/AuditLog').then((m) => ({ default: m.AuditLogPage })));
const CostInsightsPage           = lazy(() => import('./pages/CostInsights').then((m) => ({ default: m.CostInsightsPage })));
const CommandCenterPage          = lazy(() => import('./pages/CommandCenter').then((m) => ({ default: m.CommandCenterPage })));
const ServiceOfferingsPage       = lazy(() => import('./pages/ServiceOfferings').then((m) => ({ default: m.ServiceOfferingsPage })));
const SecurityPage               = lazy(() => import('./pages/Security').then((m) => ({ default: m.SecurityPage })));
const VideoAnalyticsPage         = lazy(() => import('./pages/VideoAnalytics').then((m) => ({ default: m.VideoAnalyticsPage })));
const AgenticAIPage              = lazy(() => import('./pages/AgenticAI').then((m) => ({ default: m.AgenticAIPage })));
const GatewayTwinPage            = lazy(() => import('./pages/GatewayTwin').then((m) => ({ default: m.GatewayTwinPage })));

// Default branch — McKinney (backed by the prpl/ipsec/metrics live feed).
// Falls back to the first configured branch if the id ever drifts.
const DEFAULT_BRANCH_ID = branches.find((b) => b.id === 'b-mck-03')?.id ?? branches[0].id;

export default function App() {
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH_ID);
  const [cmdOpen, setCmdOpen]   = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const activeAlerts = alerts.filter((a) => a.level !== 'ok').length;
  const location = useLocation();
  const isGatewayTwin = location.pathname === '/gateway-twin';

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
        <main className={`main${isGatewayTwin ? ' gateway-twin-main' : ''}`}>
          <div
            key={location.pathname}
            className={`page-transition${isGatewayTwin ? ' gateway-twin-route' : ''}`}
          >
            <Suspense fallback={<div className="route-loading">Loading…</div>}>
              <Routes location={location}>
                <Route path="/"               element={<Overview branchId={branchId} onSelectBranch={setBranchId} />} />
                <Route path="/fleet"          element={<FleetPage />} />
                <Route path="/connectivity"   element={<Connectivity />} />
                <Route path="/gateway-twin"   element={<GatewayTwinPage key={branchId} branchId={branchId} />} />
                <Route path="/it-devices"     element={<DevicesPage domain="IT" branchId={branchId} />} />
                <Route path="/ot-devices"     element={<DevicesPage domain="OT" branchId={branchId} />} />
                <Route path="/service-offerings" element={<ServiceOfferingsPage />} />
                <Route path="/cost-insights" element={<CostInsightsPage branchId={branchId} />} />
                <Route path="/command-center" element={<CommandCenterPage />} />
                <Route path="/incidents"      element={<IncidentsPage />} />
                <Route path="/security"       element={<SecurityPage />} />
                <Route path="/video-analytics" element={<VideoAnalyticsPage />} />
                <Route path="/audit"          element={<AuditLogPage />} />
                <Route path="/path-selection" element={<DynamicPathSelectionPage branchId={branchId} />} />
                <Route path="/app-routing"    element={<ApplicationAwareRoutingPage branchId={branchId} />} />
                <Route path="/traffic-policy" element={<TrafficPolicyPage />} />
                <Route path="/onboarding"     element={<OnboardingPage branchId={branchId} />} />
                <Route path="/ask-ai"         element={<AskAiPage />} />
                <Route path="/agentic-ai"     element={<AgenticAIPage />} />
                <Route path="/settings"       element={<SettingsPage />} />
              </Routes>
            </Suspense>
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
