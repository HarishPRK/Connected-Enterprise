import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workspaceDir = "C:\\Users\\haris\\Projects\\Connected Enterprise";
const workbookPath = `${workspaceDir}\\outputs\\activity_tracker_20260902\\pending_activities_tracker.xlsx`;
const previewDir = `${workspaceDir}\\.tmp-activity-tracker\\previews`;
await fs.mkdir(previewDir, { recursive: true });
const blue = "#1F6FEB";
const lightGray = "#E5E7EB";

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const dashboard = workbook.worksheets.getItem("Dashboard");
const tracker = workbook.worksheets.getItem("Activity Tracker");
const guide = workbook.worksheets.getItem("Lists & Guide");

const tasks = [
  ["CI-001", "Connected Enterprise | Cost Insights", "Cost Insights - Real-time Data Integration", "Connect cost data to live backend updates and refresh KPI cards and charts without manual reload.", "UI + Backend", "High", "High", "Pending", "", new Date("2026-09-07T00:00:00"), new Date("2026-09-11T00:00:00"), 5, null, null, null, null, null, "C-001", "Live cost endpoint or SSE/polling; spend, savings, and utilization updates"],
  ["AI-001", "Connected Enterprise | Ask AI", "Ask AI Enhancement - Contextual Answers & Citations", "Improve prompts, add current-page context, citations, and clearer loading and error states.", "UI + Backend", "High", "High", "Pending", "", new Date("2026-09-07T00:00:00"), new Date("2026-09-14T00:00:00"), 6, null, null, null, null, null, "None", "Context payload, response metadata, and feedback capture"],
  ["UI-001", "Connected Enterprise | Overall UI", "Overall UI Improvements - Consistency & Accessibility", "Standardize spacing, typography, empty states, buttons, responsive layouts, keyboard access, and focus behavior.", "UI", "High", "Medium", "Pending", "", new Date("2026-09-14T00:00:00"), new Date("2026-09-18T00:00:00"), 5, null, null, null, null, null, "None", "Shared components, design tokens, responsive and accessibility checks"],
  ["GWT-001", "Connected Enterprise | Gateway Twin", "GW Twin UI - Digital Twin View", "Build a gateway digital-twin view with topology, component health, metrics, and drill-down panels.", "UI", "High", "High", "Pending", "", new Date("2026-09-14T00:00:00"), new Date("2026-09-22T00:00:00"), 7, null, null, null, null, null, "None", "Gateway component inventory, health metrics, and topology payload"],
  ["DEV-001", "Connected Enterprise | Devices", "Real-time Device Telemetry Experience", "Surface live device health and telemetry with last-seen, connectivity, and refresh indicators.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-09-21T00:00:00"), new Date("2026-09-25T00:00:00"), 5, null, null, null, null, null, "None", "Device telemetry stream, last-seen timestamps, and connection state"],
  ["INC-001", "Connected Enterprise | Incidents", "Live Incident & Alert Feed", "Replace mock incident updates with live events, severity filters, acknowledgement state, and timestamps.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-09-21T00:00:00"), new Date("2026-09-24T00:00:00"), 4, null, null, null, null, null, "None", "Incident event stream, severity, acknowledgement, and audit fields"],
  ["POL-001", "Connected Enterprise | Policy Management", "Policy Management UX Refresh", "Simplify create and edit flows, inline validation, bulk actions, and persisted enable or disable state.", "UI", "Medium", "Medium", "Pending", "", new Date("2026-09-28T00:00:00"), new Date("2026-09-30T00:00:00"), 3, null, null, null, null, null, "None", "Reusable form patterns, validation rules, and bulk-action states"],
  ["TOP-001", "Connected Enterprise | Topology", "Network / Branch Topology Visualization", "Add interactive branch-to-gateway topology with status colors and quick navigation.", "UI + Backend", "Medium", "High", "Pending", "", new Date("2026-09-28T00:00:00"), new Date("2026-10-05T00:00:00"), 6, null, null, null, null, null, "GWT-001", "Branch, gateway, tunnel, and link-status relationships"],
  ["RPT-001", "Connected Enterprise | Reporting", "Reporting & Export Improvements", "Improve CSV and PDF-ready reporting, column selection, date filters, and export feedback.", "UI + Backend", "Medium", "Medium", "Pending", "", new Date("2026-10-06T00:00:00"), new Date("2026-10-08T00:00:00"), 3, null, null, null, null, null, "None", "Filtered report query, export job state, and download response"],
  ["PERF-001", "Connected Enterprise | Overall UI", "Performance & Loading Polish", "Add loading skeletons, debounce expensive filters, and optimize large-table rendering.", "UI", "Medium", "Medium", "Pending", "", new Date("2026-10-09T00:00:00"), new Date("2026-10-13T00:00:00"), 3, null, null, null, null, null, "UI-001", "Loading states, filter performance, and large-list rendering metrics"],
  ["QSR-001", "Project QSR | IT/OT Devices", "Live IT/OT Device Inventory", "Connect the QSR device page to the live inventory snapshot and enforce strict branch fleet separation.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-09-07T00:00:00"), new Date("2026-09-11T00:00:00"), 5, null, null, null, null, null, "None", "GET /api/devices/snapshot and SSE stream; McKinney/Plano source mapping"],
  ["QSR-002", "Project QSR | Device Telemetry", "Device Telemetry History & Trends", "Add per-device historical telemetry charts and clear last-seen and connection indicators.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-09-14T00:00:00"), new Date("2026-09-17T00:00:00"), 4, null, null, null, null, null, "QSR-001", "GET /api/devices/telemetry/history; RSSI and byte-counter series"],
  ["QSR-003", "Project QSR | Device Controls", "Matter / Shelly Device Controls", "Complete safe control flows for Matter and Shelly devices with optimistic state and failure recovery.", "UI + Backend", "Medium", "Medium", "Pending", "", new Date("2026-09-14T00:00:00"), new Date("2026-09-16T00:00:00"), 3, null, null, null, null, null, "QSR-001", "POST control endpoints, action acknowledgement, and revert-on-failure behavior"],
  ["QSR-004", "Project QSR | Dynamic Failover", "Dynamic Failover Controls", "Wire Fiber, 5G, Auto, and per-tunnel path controls to gateway acknowledgement states.", "UI + Backend", "High", "High", "Pending", "", new Date("2026-09-18T00:00:00"), new Date("2026-09-24T00:00:00"), 5, null, null, null, null, null, "None", "POST /api/gateway/path; 200 ack, 202 pending, and 502 rejection states"],
  ["QSR-005", "Project QSR | Application Routing", "Application-Aware Routing Policy CRUD", "Replace policy mocks with create, edit, delete, toggle, and validation flows against the routing API.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-09-21T00:00:00"), new Date("2026-09-25T00:00:00"), 5, null, null, null, null, null, "None", "Policy list, CRUD payloads, enable/disable persistence, and validation"],
  ["QSR-006", "Project QSR | AI Operations", "AI Network Insight / Operator Readout", "Add an operator-friendly AI readout for live device and tunnel conditions with graceful no-data handling.", "UI + Backend", "Medium", "High", "Pending", "", new Date("2026-09-28T00:00:00"), new Date("2026-10-01T00:00:00"), 4, null, null, null, null, null, "QSR-001; QSR-004", "Insight SSE stream, 503/409 messaging, and current snapshot context"],
  ["QSR-007", "Project QSR | Fleet Separation", "McKinney / Plano Fleet Separation", "Make the two QSR site views explicit and prevent mixed gateway or device data across branch pages.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-09-28T00:00:00"), new Date("2026-09-30T00:00:00"), 3, null, null, null, null, null, "QSR-001", "b-mck-03 and b-pln-01 source contracts; strict equality filters"],
  ["QSR-008", "Project QSR | Gateway Reliability", "Gateway Feed Health & Reconnect UX", "Show feed freshness, reconnect attempts, waiting states, and operator guidance when a gateway is offline.", "UI", "Medium", "Medium", "Pending", "", new Date("2026-10-02T00:00:00"), new Date("2026-10-06T00:00:00"), 3, null, null, null, null, null, "QSR-001", "SSE heartbeat state, last snapshot timestamp, and reconnect status"],
  ["QSR-009", "Project QSR | Deployment", "QSR Deployment & Auth Hardening", "Harden reverse-proxy, operator authentication, buffering, and service deployment configuration.", "Backend", "High", "High", "Pending", "", new Date("2026-10-05T00:00:00"), new Date("2026-10-08T00:00:00"), 4, null, null, null, null, null, "QSR-004", "Nginx proxy rules, operator header, service unit, and secret handling"],
  ["QSR-010", "Project QSR | Verification", "Simulator & Integration Test Coverage", "Add repeatable inventory, control, failover, and no-gateway tests for the combined QSR packs.", "UI + Backend", "Medium", "Medium", "Pending", "", new Date("2026-10-09T00:00:00"), new Date("2026-10-14T00:00:00"), 4, null, null, null, null, null, "QSR-001; QSR-004", "Device simulators, route tests, SSE assertions, and integration checklist"],
  ["SF-001", "Smart Factory | Site Onboarding", "Factory Site Onboarding Flow", "Create a guided flow to register a plant, assign an authorized site, and confirm the first gateway operation.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-10-15T00:00:00"), new Date("2026-10-21T00:00:00"), 5, null, null, null, null, null, "None", "Site record, tenant assignment, gateway claim, and operation progress"],
  ["SF-002", "Smart Factory | Gateway Provisioning", "Manufacturing Gateway Provisioning & Certificate Binding", "Complete secure factory serial verification, certificate binding, and operational identity handoff.", "Backend", "High", "High", "Pending", "", new Date("2026-10-15T00:00:00"), new Date("2026-10-22T00:00:00"), 6, null, null, null, null, null, "SF-001", "Unique bootstrap identity, manufacturing record, certificate status, and CAS checks"],
  ["SF-003", "Smart Factory | OT Discovery", "OT Device Discovery & Classification", "Discover factory-floor devices and classify equipment by OT role, line, and criticality.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-10-22T00:00:00"), new Date("2026-10-28T00:00:00"), 5, null, null, null, null, null, "SF-002", "Device inventory, OT tags, asset metadata, and classification overrides"],
  ["SF-004", "Smart Factory | Digital Twin", "Production Line Digital Twin UI", "Build a visual twin of plant lines, gateways, machines, and current operating health.", "UI", "High", "High", "Pending", "", new Date("2026-10-22T00:00:00"), new Date("2026-10-30T00:00:00"), 7, null, null, null, null, null, "SF-003", "Line hierarchy, machine relationships, health state, and drill-down panels"],
  ["SF-005", "Smart Factory | Live Telemetry", "Real-time Machine Telemetry Dashboard", "Surface live temperature, vibration, throughput, run state, and last-seen metrics for production assets.", "UI + Backend", "High", "High", "Pending", "", new Date("2026-11-02T00:00:00"), new Date("2026-11-09T00:00:00"), 6, null, null, null, null, null, "SF-003", "Telemetry stream, metric units, thresholds, time series, and freshness state"],
  ["SF-006", "Smart Factory | Predictive Maintenance", "Predictive Maintenance Signals", "Add maintenance risk indicators, anomaly summaries, and recommended next actions for assets.", "UI + Backend", "Medium", "High", "Pending", "", new Date("2026-11-02T00:00:00"), new Date("2026-11-09T00:00:00"), 6, null, null, null, null, null, "SF-005", "Anomaly scores, maintenance windows, asset history, and action recommendations"],
  ["SF-007", "Smart Factory | Energy", "Energy & Utility Monitoring", "Track plant energy use, peak demand, utility status, and opportunities for idle-load reduction.", "UI + Backend", "Medium", "Medium", "Pending", "", new Date("2026-11-10T00:00:00"), new Date("2026-11-13T00:00:00"), 4, null, null, null, null, null, "SF-005", "Meter readings, utility feeds, cost rates, and baseline comparisons"],
  ["SF-008", "Smart Factory | Alarms", "Incident / Alarm Workflow with Escalation", "Create severity-aware alarm workflows with acknowledgement, escalation timers, and shift handoff.", "UI + Backend", "High", "Medium", "Pending", "", new Date("2026-11-10T00:00:00"), new Date("2026-11-16T00:00:00"), 5, null, null, null, null, null, "SF-005", "Alarm events, severity, acknowledgement, escalation policy, and audit trail"],
  ["SF-009", "Smart Factory | Governance", "Role-based Operations Views & Audit Log", "Add role-aware plant views and a searchable audit trail for controls, configuration, and approvals.", "UI + Backend", "Medium", "Medium", "Pending", "", new Date("2026-11-17T00:00:00"), new Date("2026-11-20T00:00:00"), 4, null, null, null, null, null, "SF-001", "Roles, permissions, operator identity, change events, and retention"],
  ["SF-010", "Smart Factory | Operations", "Factory Deployment Observability & Runbooks", "Prepare health checks, deployment dashboards, rollback guidance, and operator runbooks for plant rollout.", "DevOps", "Medium", "Medium", "Pending", "", new Date("2026-11-17T00:00:00"), new Date("2026-11-20T00:00:00"), 4, null, null, null, null, null, "SF-002; SF-008", "Service health, deployment state, alerts, rollback steps, and support ownership"],
];

const firstRow = 9;
const lastTaskRow = firstRow + tasks.length - 1;
const compactLastRow = lastTaskRow + 10;

// Preserve the existing formatting language while shrinking the visible table to a focused starter list.
tracker.getRange("A9:S108").clear({ applyTo: "contents" });
tracker.getRange(`A${compactLastRow + 1}:S108`).clear({ applyTo: "all" });
tracker.getRange("B8").values = [["Project / Section"]];
tracker.getRange(`A${firstRow}:S${lastTaskRow}`).values = tasks;

tracker.getRange(`M${firstRow}`).formulas = [[`=IF(C${firstRow}="","",L${firstRow}*'Lists & Guide'!$E$5)`]];
tracker.getRange(`M${firstRow}:M${compactLastRow}`).fillDown();
tracker.getRange(`O${firstRow}`).formulas = [[`=IF(C${firstRow}="","",MAX(0,M${firstRow}-N${firstRow}))`]];
tracker.getRange(`O${firstRow}:O${compactLastRow}`).fillDown();
tracker.getRange(`P${firstRow}`).formulas = [[`=IF(C${firstRow}="","",IF(K${firstRow}="","",K${firstRow}-TODAY()))`]];
tracker.getRange(`P${firstRow}:P${compactLastRow}`).fillDown();
tracker.getRange(`Q${firstRow}`).formulas = [[`=IF(C${firstRow}="","",IF(OR(H${firstRow}="Completed",K${firstRow}=""),"",IF(K${firstRow}<TODAY(),"Yes","No")))`]];
tracker.getRange(`Q${firstRow}:Q${compactLastRow}`).fillDown();
tracker.getRange(`J${firstRow}:K${compactLastRow}`).format.numberFormat = "yyyy-mm-dd";
tracker.getRange(`L${firstRow}:P${compactLastRow}`).format.numberFormat = "0.0";

const oldTable = tracker.tables.items.find((t) => t.name === "ActivitiesTable");
if (oldTable) oldTable.delete();
const table = tracker.tables.add(`A8:S${compactLastRow}`, true, "ActivitiesTable");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
table.showBandedColumns = false;

dashboard.getRange("A2").values = [["30-task cross-project starter list: Connected Enterprise, Project QSR, and Smart Factory. Update the Activity Tracker fields as work progresses."]];
dashboard.getRange("A13").values = [["Estimates and dates are indicative planning values. Update Owner, Status, Actual Hours, and Due Date to keep the tracker current."]];
guide.getRange("A15").values = [["5. Starter set includes 10 tasks each for Connected Enterprise, Project QSR, and Smart Factory, based on the workspace references and requested themes."]];

dashboard.getRange("M3:N3").values = [["Project", "Count"]];
dashboard.getRange("M4:M6").values = [["Connected Enterprise"], ["Project QSR"], ["Smart Factory"]];
dashboard.getRange("N4").formulas = [[`=COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"CI-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"AI-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"UI-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"GWT-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"DEV-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"INC-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"POL-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"TOP-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"RPT-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"PERF-001")`]];
dashboard.getRange("N5").formulas = [[`=COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-002")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-003")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-004")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-005")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-006")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-007")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-008")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-009")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"QSR-010")`]];
dashboard.getRange("N6").formulas = [[`=COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-001")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-002")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-003")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-004")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-005")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-006")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-007")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-008")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-009")+COUNTIF('Activity Tracker'!$A$${firstRow}:$A$108,"SF-010")`]];
dashboard.getRange("M3:N3").format = { fill: blue, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "Center" };
dashboard.getRange("M4:N6").format = { borders: { preset: "all", style: "thin", color: lightGray } };
dashboard.getRange("N4:N6").format.numberFormat = "0";
dashboard.getRange("M1:M8").format.columnWidth = 24;
dashboard.getRange("N1:N8").format.columnWidth = 10;

// Retain dropdowns for the focused list and make the compact table the main editable area.
tracker.getRange(`F${firstRow}:F${compactLastRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists & Guide'!$B$4:$B$7" } };
tracker.getRange(`G${firstRow}:G${compactLastRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists & Guide'!$C$4:$C$6" } };
tracker.getRange(`H${firstRow}:H${compactLastRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists & Guide'!$A$4:$A$8" } };
tracker.getRange(`N${firstRow}:N${compactLastRow}`).dataValidation = { rule: { type: "decimal", operator: "greaterThanOrEqual", formula1: 0 } };

const previews = ["Dashboard", "Activity Tracker", "Lists & Guide"];
for (const sheetName of previews) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}\\updated_${sheetName.replaceAll(" ", "_").replaceAll("&", "and")}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const check = await workbook.inspect({ kind: "table", sheetId: "Dashboard", range: "A1:K15", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 11, maxChars: 10000 });
console.log("DASHBOARD_CHECK\n" + check.ndjson);
const trackerCheck = await workbook.inspect({ kind: "table", sheetId: "Activity Tracker", range: `A8:S${lastTaskRow}`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 19, maxChars: 16000 });
console.log("TRACKER_CHECK\n" + trackerCheck.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
console.log("ERROR_SCAN\n" + errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
console.log(`OUTPUT_PATH=${workbookPath}`);
console.log(`TASK_COUNT=${tasks.length}`);
