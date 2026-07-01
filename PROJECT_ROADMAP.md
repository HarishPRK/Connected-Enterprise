# Connected Enterprise - Project Roadmap & Status

**Last Updated**: June 30, 2026  
**Total Codebase**: ~25,500 lines (22K frontend + 3.5K backend)  
**Overall Completion**: 85% Core Features | 70% UI Polish | 0% Advanced Features

---

## 📊 CURRENT STATUS

### ✅ COMPLETED & PRODUCTION-READY

#### **Backend Integration (Real Data)**
- [x] Live IPsec metrics via AWS IoT Core (`rdk/ipsec/metrics`, `prpl/ipsec/metrics`)
- [x] Real-time device inventory (Matter devices + Shelly Gen2+ MQTT)
- [x] IT/OT device classification with persistent overrides
- [x] Matter device control (OnOff cluster)
- [x] Shelly relay control (Switch.Set)
- [x] WAN path control (Force Fiber/5G/Auto) with gateway ack
- [x] Bedrock/Anthropic AI agent (8 tools, SSE streaming, human approval)
- [x] Device telemetry history (5-minute rolling window)
- [x] Video analytics proxy (Nvidia/Hailo MJPEG streams)

#### **Complete Pages**
- [x] Overview - KPIs, topology, bandwidth, AI insight
- [x] Fleet - Multi-branch map with health sparklines
- [x] Connectivity - WAN metrics, DNS stats, event log
- [x] IT/OT Devices - Full CRUD, live status, control actions
- [x] Dynamic Path Selection - SLA charts, auto-failover, force modes
- [x] Application-Aware Routing - Traffic policies, DPI rules
- [x] Incidents - AI investigation workflow
- [x] Audit Log - Immutable event stream
- [x] Cost Insights - ROI calculator, savings breakdown
- [x] Security - Threat events, DNS blocks
- [x] Onboarding - Multi-step gateway setup wizard
- [x] Ask AI / Agentic AI - Chat interface with reasoning
- [x] Video Analytics - Stream gallery with inference overlays
- [x] Settings - Theme, preferences

---

## 🎯 PRIORITY 1: CRITICAL (Complete by July 15, 2026)

### **Backend Dependencies**

| Task | Blocker | Owner | Deadline |
|------|---------|-------|----------|
| Deploy `com.rdk.devicediscovery` to all gateways | Full IT device visibility (currently seed-based) | Backend Team | **July 10** |
| Fix AWS IoT credential rotation | Stale keys cause `WEBSOCKET_UPGRADE_FAILURE` | DevOps | **July 8** |
| Add React error boundaries | Crashes show white screen instead of graceful fallback | Frontend | **July 5** |

### **UI Polish - Must Have**

| Task | Impact | Effort | Deadline |
|------|--------|--------|----------|
| Responsive design (mobile/tablet) | Users can't demo on iPad/phone | 2-3 days | **July 12** |
| Loading skeletons for tables | Blank screen during SSE hydration | 1 day | **July 7** |
| Empty states with helpful CTAs | "No devices" is confusing without guidance | 1 day | **July 6** |
| Fix "Edge Gateway" label consistency | Still shows "rdk-bpi4-gateway" in some places | 0.5 day | **July 3** |

---

## 🎯 PRIORITY 2: HIGH (Complete by July 31, 2026)

### **Backend - Nice to Have**

| Task | Value | Deadline |
|------|-------|----------|
| Historical data API (`/api/bandwidth/history?from=&to=`) | Time-range playback for bandwidth charts | **July 25** |
| Device reboot/disable actions | Complete device lifecycle management | **July 28** |
| Firmware update push workflow | Enable OTA updates from UI | **July 30** |

### **UI Only - High Value**

| Task | Value | Effort | Deadline |
|------|-------|--------|----------|
| Split `DynamicPathSelection.tsx` (1140 lines) | Maintainability, code review easier | 1 day | **July 20** |
| Split `VideoAnalytics.tsx` (2115 lines) | Extract `StreamPlayer` component | 1 day | **July 22** |
| Keyboard shortcuts (Cmd+K command palette) | Power users workflow | 2 days | **July 25** |
| Bulk device operations (multi-select for IT/OT) | Classify 10 devices at once instead of one-by-one | 1 day | **July 18** |
| Toast notification persistence | Critical alerts shouldn't auto-dismiss | 0.5 day | **July 17** |
| Table sorting (all columns) | Currently only name/status sortable | 1 day | **July 19** |

---

## 🎯 PRIORITY 3: MEDIUM (Complete by August 31, 2026)

### **Backend**

| Task | Value | Deadline |
|------|-------|----------|
| Custom alert rules API | User-defined thresholds instead of hardcoded | **Aug 15** |
| Incident escalation (Slack/PagerDuty webhooks) | Auto-notify on-call when agent detects outage | **Aug 20** |
| Export APIs (CSV/JSON) | Devices, audit log, incidents download | **Aug 10** |

### **UI Only**

| Task | Effort | Deadline |
|------|--------|----------|
| Fuzzy search for devices page | Match typos like "lap-jhon" → "Lap-John" | 1 day | **Aug 8** |
| Device drawer telemetry (longer history) | Show 1-hour instead of 5-min charts | 0.5 day | **Aug 5** |
| Branch map geo-lookup | Support non-Texas branches | 1 day | **Aug 12** |
| Dynamic topology layout | Auto-position nodes based on device count | 2 days | **Aug 18** |
| Unified badge colors | Consistent red/yellow/green shades | 0.5 day | **Aug 3** |

---

## 🎯 PRIORITY 4: LOW / FUTURE (Post-August)

### **Backend - Advanced Features**

| Task | Value | Timeline |
|------|-------|----------|
| Multi-branch incident correlation | Agent analyzes patterns across all sites | Q3 2026 |
| Role-based access control (RBAC) | Per-branch user permissions | Q4 2026 |
| Multi-tenant isolation | Separate customer data | Q4 2026 |
| Prometheus metrics export | Observability, alerting | Q3 2026 |

### **UI Only - Nice to Have**

| Task | Effort | Timeline |
|------|--------|----------|
| Dark theme refinements | Better contrast, accessible colors | 1 day | Q3 2026 |
| Animation polish | Smoother page transitions | 1 day | Q3 2026 |
| Chart library evaluation | Replace Recharts (200KB) with lighter option | 2 days | Q3 2026 |
| Image lazy loading | Faster Fleet page map render | 0.5 day | Q3 2026 |

---

## ⚠️ TECHNICAL DEBT (Address Incrementally)

### **Code Quality**

| Issue | Impact | When to Fix |
|-------|--------|-------------|
| Mock data coupling (13 pages import `mock.ts`) | Hard to replace with real APIs | During each API integration |
| Type safety gaps (`any` in agent streaming) | Runtime errors harder to catch | When touching related code |
| Prop drilling (branchId through 3+ levels) | Refactor friction | During component splits |

### **Performance**

| Issue | Impact | Priority |
|-------|--------|----------|
| Large mock arrays recalculated on every render | Sluggish CostInsights page | Low - only affects mock mode |
| SSE connection pooling (each hook opens separate EventSource) | Extra server load | Medium - optimize when scaling |
| DevicesDashboard reruns sort on every parent state change | Laggy table with 50+ devices | High - fix by July 15 |

### **Testing**

| Task | Value | Timeline |
|------|-------|----------|
| E2E tests for agent flow | Prevent regressions in complex workflow | Q3 2026 |
| E2E tests for device control | Catch Matter/Shelly API breaks | Q3 2026 |
| Unit tests for critical hooks | `useDevices`, `useIpsecMetrics` | Q4 2026 |

### **DevOps**

| Task | Impact | Deadline |
|------|--------|----------|
| CI/CD pipeline (GitHub Actions) | Automated deploys, no manual SSH | **Aug 31** |
| Health check endpoint (`/health`) | PM2 auto-restart on hung process | **Aug 15** |
| Staging environment | Test changes before prod push | **Sep 15** |
| Secrets Manager (AWS) | Remove `.env` plaintext keys | **Aug 20** |

---

## 📅 SPRINT BREAKDOWN

### **Sprint 1: July 1-15 (P1 Critical)**
- [ ] AWS IoT credential rotation fix *(Backend - July 8)*
- [ ] React error boundaries *(Frontend - July 5)*
- [ ] Empty states with CTAs *(Frontend - July 6)*
- [ ] Loading skeletons *(Frontend - July 7)*
- [ ] Deploy device discovery component *(Backend - July 10)*
- [ ] Responsive design (mobile/tablet) *(Frontend - July 12)*
- [ ] DevicesDashboard sort optimization *(Frontend - July 15)*

### **Sprint 2: July 16-31 (P2 High)**
- [ ] Toast notification persistence *(Frontend - July 17)*
- [ ] Bulk device operations *(Frontend - July 18)*
- [ ] Table sorting all columns *(Frontend - July 19)*
- [ ] Split DynamicPathSelection component *(Frontend - July 20)*
- [ ] Split VideoAnalytics component *(Frontend - July 22)*
- [ ] Keyboard shortcuts *(Frontend - July 25)*
- [ ] Historical data API *(Backend - July 25)*
- [ ] Device reboot/disable actions *(Backend - July 28)*
- [ ] Firmware update workflow *(Backend - July 30)*

### **Sprint 3: August 1-15 (P3 Medium - Part 1)**
- [ ] Unified badge colors *(Frontend - Aug 3)*
- [ ] Device drawer longer history *(Frontend - Aug 5)*
- [ ] Fuzzy search *(Frontend - Aug 8)*
- [ ] Export APIs *(Backend - Aug 10)*
- [ ] Branch map geo-lookup *(Frontend - Aug 12)*
- [ ] Custom alert rules API *(Backend - Aug 15)*
- [ ] Health check endpoint *(DevOps - Aug 15)*

### **Sprint 4: August 16-31 (P3 Medium - Part 2)**
- [ ] Dynamic topology layout *(Frontend - Aug 18)*
- [ ] Incident escalation webhooks *(Backend - Aug 20)*
- [ ] Secrets Manager migration *(DevOps - Aug 20)*
- [ ] CI/CD pipeline *(DevOps - Aug 31)*

---

## 🔍 WHAT NEEDS BACKEND vs UI-ONLY

### **NEEDS BACKEND (Cannot proceed without API/service)**

1. ❌ Full IT device discovery → Deploy `com.rdk.devicediscovery`
2. ❌ Historical bandwidth playback → `/api/bandwidth/history` endpoint
3. ❌ Device reboot/disable → Gateway component actions
4. ❌ Firmware updates → OTA push endpoint
5. ❌ Custom alert rules → Threshold config API
6. ❌ Incident escalation → Slack/PagerDuty webhook service
7. ❌ CSV exports → `/api/export/devices`, `/api/export/audit-log`
8. ❌ Multi-tenant RBAC → Auth service, permission checks

### **UI-ONLY (Can start immediately)**

1. ✅ Responsive design (media queries, flex/grid tweaks)
2. ✅ Loading skeletons (CSS animations)
3. ✅ Empty states (static messages, SVG illustrations)
4. ✅ Component splitting (refactor large files)
5. ✅ Keyboard shortcuts (event handlers, command palette)
6. ✅ Bulk operations UI (checkboxes, batch actions)
7. ✅ Table sorting (client-side sort logic)
8. ✅ Toast persistence (state management)
9. ✅ Fuzzy search (Fuse.js client-side)
10. ✅ Device drawer charts (extend time window)
11. ✅ Topology dynamic layout (SVG coordinate math)
12. ✅ Badge color consistency (CSS variables)
13. ✅ Branch map improvements (D3.js tweaks)

---

## 🚀 NEXT STEPS (This Week)

### **Backend Team**
1. Investigate AWS IoT credential rotation error (check `~/.aws/credentials` on EC2)
2. Schedule device discovery component deploy to Plano gateway (July 10 target)
3. Design historical data API schema (discuss retention policy)

### **Frontend Team**
1. Add error boundaries to all page routes (`src/App.tsx`)
2. Implement empty states for Devices, Incidents, Audit Log pages
3. Add loading skeletons to DevicesDashboard table
4. Start responsive design with Overview page (test on iPad)

### **DevOps**
1. Rotate AWS IoT credentials on EC2 instance
2. Set up staging EC2 instance (clone prod config)
3. Draft CI/CD pipeline design (GitHub Actions → EC2 deploy)

---

## 📞 CONTACTS & OWNERSHIP

| Area | Owner | Slack |
|------|-------|-------|
| Backend APIs | Backend Team | #backend-dev |
| Gateway Components | Embedded Team | #gateway-embedded |
| Frontend Pages | Frontend Team | #frontend-dev |
| DevOps/Infrastructure | DevOps Team | #devops |
| Product/Design | Product Team | #product |

---

## 📝 NOTES

- **Demo-ready**: Yes - all 17 pages functional with real or fallback data
- **Production deployment**: EC2 at `54.xyz.abc.123` with PM2
- **Deployment process**: Manual SSH → `git pull && npm run build && pm2 restart`
- **Monitoring**: None (add health checks Sprint 3)
- **Testing**: Zero test coverage (E2E planned Q3)

**Last EC2 Deploy**: June 29, 2026 (commit `4ac911d`)  
**Live Gateways**: Plano (rdk-bpi4-gateway), McKinney (prpl gateway)  
**Live Devices**: 15 devices (8 IT, 7 OT) on Plano gateway
