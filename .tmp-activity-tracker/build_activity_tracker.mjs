import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workspaceDir = "C:\\Users\\haris\\Projects\\Connected Enterprise";
const outputDir = `${workspaceDir}\\outputs\\activity_tracker_20260902`;
const previewDir = `${workspaceDir}\\.tmp-activity-tracker\\previews`;
const sourcePath = `${workspaceDir}\\PROJECT_TASK_PLAN.csv`;

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

// Use the artifact tool's CSV importer to preserve quoted commas in the source data.
const sourceCsv = await fs.readFile(sourcePath, "utf8");
const sourceWb = await Workbook.fromCSV(sourceCsv, { sheetName: "Source" });
const sourceSheet = sourceWb.worksheets.getItem("Source");
const sourceValues = sourceSheet.getUsedRange(true).values;
const sourceHeaders = sourceValues[0].map((v) => String(v ?? "").trim());
const sourceRows = sourceValues.slice(1)
  .filter((row) => String(row[0] ?? "").trim() && String(row[11] ?? "").trim().toLowerCase() === "pending")
  .map((row) => ({
    id: String(row[0] ?? "").trim(),
    section: String(row[1] ?? "").trim(),
    task: String(row[2] ?? "").trim(),
    type: String(row[3] ?? "").trim(),
    description: String(row[4] ?? "").trim(),
    backend: String(row[5] ?? "").trim(),
    priority: String(row[6] ?? "").trim(),
    complexity: String(row[7] ?? "").trim(),
    estDays: Number(row[8] ?? 0),
    start: row[9] ? new Date(`${row[9]}T00:00:00`) : null,
    due: row[10] ? new Date(`${row[10]}T00:00:00`) : null,
    status: "Pending",
    dependencies: String(row[12] ?? "").trim(),
  }));

const workbook = Workbook.create();
const dashboard = workbook.worksheets.add("Dashboard");
const tracker = workbook.worksheets.add("Activity Tracker");
const guide = workbook.worksheets.add("Lists & Guide");

const navy = "#12304A";
const blue = "#1F6FEB";
const teal = "#0F766E";
const paleBlue = "#EAF3FF";
const paleTeal = "#E7F7F4";
const paleAmber = "#FFF4D6";
const paleRed = "#FDECEC";
const lightGray = "#E5E7EB";
const grayText = "#475569";

for (const sheet of [dashboard, tracker, guide]) sheet.showGridLines = false;

// Lists & Guide
guide.getRange("A1:E1").merge();
guide.getRange("A1").values = [["Lists & Guide"]];
guide.getRange("A1:E1").format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 16 }, horizontalAlignment: "Left", verticalAlignment: "Center" };
guide.getRange("A3:E3").values = [["Status", "Priority", "Complexity", "Type", "Assumption"]];
guide.getRange("A3:E3").format = { fill: blue, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "Center", borders: { preset: "outside", style: "thin", color: blue } };
guide.getRange("A4:A8").values = [["Pending"], ["In Progress"], ["Blocked"], ["On Hold"], ["Completed"]];
guide.getRange("B4:B7").values = [["High"], ["Medium"], ["Low"], ["P1 - Critical"]];
guide.getRange("C4:C6").values = [["High"], ["Medium"], ["Low"]];
guide.getRange("D4:D7").values = [["UI"], ["Backend"], ["UI + Backend"], ["DevOps"]];
guide.getRange("E4:E5").values = [["Hours per workday"], [8]];
guide.getRange("E5").format.numberFormat = "0.0";
guide.getRange("A10:E10").merge();
guide.getRange("A10").values = [["How to use"]];
guide.getRange("A10:E10").format = { fill: teal, font: { bold: true, color: "#FFFFFF" } };
guide.getRange("A11:E15").merge(true);
guide.getRange("A11:A15").values = [
  ["1. Update Status, Owner, Actual Hours, Due Date, and Notes in Activity Tracker."],
  ["2. Remaining Hours, Days Left, Overdue?, and Dashboard totals update automatically."],
  ["3. Est. Hours is calculated as Est. Days × Hours per workday."],
  ["4. Overdue? compares Due Date with today's date and ignores Completed activities."],
  ["5. Source: PROJECT_TASK_PLAN.csv in this workspace; all 62 Pending activities were imported."],
];
guide.getRange("A11:E15").format = { wrapText: true, font: { color: grayText }, borders: { preset: "outside", style: "thin", color: lightGray } };
guide.getRange("A1:E15").format.verticalAlignment = "Center";
guide.getRange("A1:E15").format.font = { name: "Aptos", size: 10 };
guide.getRange("A1:E1").format.font = { name: "Aptos Display", bold: true, color: "#FFFFFF", size: 16 };
for (const [col, width] of [["A", 18], ["B", 16], ["C", 14], ["D", 18], ["E", 28]]) guide.getRange(`${col}1:${col}15`).format.columnWidth = width;
guide.getRange("A3:E8").format.borders = { insideHorizontal: { style: "thin", color: lightGray }, insideVertical: { style: "thin", color: lightGray }, outside: { style: "thin", color: lightGray } };

// Activity Tracker
tracker.getRange("A1:S1").merge();
tracker.getRange("A1").values = [["Pending Activities Tracker"]];
tracker.getRange("A1:S1").format = { fill: navy, font: { name: "Aptos Display", bold: true, color: "#FFFFFF", size: 16 }, horizontalAlignment: "Left", verticalAlignment: "Center" };
tracker.getRange("A2:S2").merge();
tracker.getRange("A2").values = [["Imported from PROJECT_TASK_PLAN.csv. Edit the tracker fields to keep the plan current."]];
tracker.getRange("A2:S2").format = { fill: paleBlue, font: { italic: true, color: grayText }, wrapText: true };

const headers = ["Task ID", "Section", "Activity", "Description", "Type", "Priority", "Complexity", "Status", "Owner", "Start Date", "Due Date", "Est. Days", "Est. Hours", "Actual Hours", "Remaining Hours", "Days Left", "Overdue?", "Dependencies", "Notes / Backend Data"];
tracker.getRange("A8:S8").values = [headers];
tracker.getRange("A8:S8").format = { fill: blue, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "Center", verticalAlignment: "Center", wrapText: true, borders: { preset: "outside", style: "thin", color: blue } };

const firstDataRow = 9;
const lastDataRow = 108;
const rowData = [];
for (let i = 0; i < lastDataRow - firstDataRow + 1; i++) {
  const r = sourceRows[i];
  rowData.push(r ? [r.id, r.section, r.task, r.description, r.type, r.priority, r.complexity, r.status, "", r.start, r.due, r.estDays, null, null, null, null, null, r.dependencies, r.backend] : ["", "", "", "", "", "", "", "", "", null, null, null, null, null, null, null, null, "", ""]);
}
tracker.getRange(`A${firstDataRow}:S${lastDataRow}`).values = rowData;

tracker.getRange(`M${firstDataRow}`).formulas = [[`=IF(C${firstDataRow}="","",L${firstDataRow}*'Lists & Guide'!$E$5)`]];
tracker.getRange(`M${firstDataRow}:M${lastDataRow}`).fillDown();
tracker.getRange(`O${firstDataRow}`).formulas = [[`=IF(C${firstDataRow}="","",MAX(0,M${firstDataRow}-N${firstDataRow}))`]];
tracker.getRange(`O${firstDataRow}:O${lastDataRow}`).fillDown();
tracker.getRange(`P${firstDataRow}`).formulas = [[`=IF(C${firstDataRow}="","",IF(K${firstDataRow}="","",K${firstDataRow}-TODAY()))`]];
tracker.getRange(`P${firstDataRow}:P${lastDataRow}`).fillDown();
tracker.getRange(`Q${firstDataRow}`).formulas = [[`=IF(C${firstDataRow}="","",IF(OR(H${firstDataRow}="Completed",K${firstDataRow}=""),"",IF(K${firstDataRow}<TODAY(),"Yes","No")))`]];
tracker.getRange(`Q${firstDataRow}:Q${lastDataRow}`).fillDown();

tracker.getRange(`F${firstDataRow}:F${lastDataRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists & Guide'!$B$4:$B$7" } };
tracker.getRange(`G${firstDataRow}:G${lastDataRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists & Guide'!$C$4:$C$6" } };
tracker.getRange(`H${firstDataRow}:H${lastDataRow}`).dataValidation = { rule: { type: "list", formula1: "'Lists & Guide'!$A$4:$A$8" } };
tracker.getRange(`N${firstDataRow}:N${lastDataRow}`).dataValidation = { rule: { type: "decimal", operator: "greaterThanOrEqual", formula1: 0 } };

tracker.getRange(`J${firstDataRow}:K${lastDataRow}`).format.numberFormat = "yyyy-mm-dd";
tracker.getRange(`L${firstDataRow}:P${lastDataRow}`).format.numberFormat = "0.0";
tracker.getRange(`A${firstDataRow}:S${lastDataRow}`).format.verticalAlignment = "Center";
tracker.getRange(`D${firstDataRow}:D${lastDataRow}`).format.wrapText = true;
tracker.getRange(`S${firstDataRow}:S${lastDataRow}`).format.wrapText = true;
tracker.getRange(`A${firstDataRow}:S${lastDataRow}`).format.borders = { insideHorizontal: { style: "thin", color: "E5E7EB" }, outside: { style: "thin", color: "CBD5E1" } };
tracker.getRange(`H${firstDataRow}:H${lastDataRow}`).conditionalFormats.add("containsText", { text: "Pending", format: { fill: paleAmber, font: { color: "#92400E" } } });
tracker.getRange(`H${firstDataRow}:H${lastDataRow}`).conditionalFormats.add("containsText", { text: "In Progress", format: { fill: paleBlue, font: { color: "#1D4ED8" } } });
tracker.getRange(`H${firstDataRow}:H${lastDataRow}`).conditionalFormats.add("containsText", { text: "Blocked", format: { fill: paleRed, font: { color: "#B91C1C", bold: true } } });
tracker.getRange(`H${firstDataRow}:H${lastDataRow}`).conditionalFormats.add("containsText", { text: "Completed", format: { fill: paleTeal, font: { color: "#047857" } } });
tracker.getRange(`Q${firstDataRow}:Q${lastDataRow}`).conditionalFormats.add("containsText", { text: "Yes", format: { fill: paleRed, font: { color: "#B91C1C", bold: true } } });
tracker.getRange(`F${firstDataRow}:F${lastDataRow}`).conditionalFormats.add("containsText", { text: "P1", format: { fill: paleRed, font: { color: "#B91C1C", bold: true } } });
tracker.getRange(`F${firstDataRow}:F${lastDataRow}`).conditionalFormats.add("containsText", { text: "High", format: { fill: paleAmber, font: { color: "#92400E", bold: true } } });

const table = tracker.tables.add(`A8:S${lastDataRow}`, true, "ActivitiesTable");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
table.showBandedColumns = false;
tracker.freezePanes.freezeRows(8);
tracker.freezePanes.freezeColumns(3);

const widths = { A: 11, B: 20, C: 36, D: 48, E: 16, F: 14, G: 12, H: 15, I: 15, J: 12, K: 12, L: 10, M: 10, N: 12, O: 14, P: 10, Q: 10, R: 18, S: 48 };
for (const [col, width] of Object.entries(widths)) tracker.getRange(`${col}1:${col}${lastDataRow}`).format.columnWidth = width;
tracker.getRange("A1:S2").format.rowHeight = 24;
tracker.getRange("A8:S8").format.rowHeight = 34;

// Dashboard
dashboard.getRange("A1:Q1").merge();
dashboard.getRange("A1").values = [["Connected Enterprise | Pending Activity Overview"]];
dashboard.getRange("A1:Q1").format = { fill: navy, font: { name: "Aptos Display", bold: true, color: "#FFFFFF", size: 16 }, horizontalAlignment: "Left", verticalAlignment: "Center" };
dashboard.getRange("A2:Q2").merge();
dashboard.getRange("A2").values = [["Formula-driven summary of the imported Pending activities. Update the Activity Tracker to keep this page current."]];
dashboard.getRange("A2:Q2").format = { fill: paleBlue, font: { italic: true, color: grayText }, wrapText: true };

const cardLabels = [["Total Activities", "Pending / Open", "In Progress", "Blocked"], ["Estimated Days", "Estimated Hours", "Remaining Hours", "Overdue"]];
dashboard.getRange("A4:H4").values = [[cardLabels[0][0], "", cardLabels[0][1], "", cardLabels[0][2], "", cardLabels[0][3], ""]];
dashboard.getRange("A4:B4").merge(); dashboard.getRange("C4:D4").merge(); dashboard.getRange("E4:F4").merge(); dashboard.getRange("G4:H4").merge();
dashboard.getRange("A4:H4").format = { fill: blue, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "Center", verticalAlignment: "Center" };
dashboard.getRange("A5:H5").values = [[null, null, null, null, null, null, null, null]];
dashboard.getRange("A5:B5").merge(); dashboard.getRange("C5:D5").merge(); dashboard.getRange("E5:F5").merge(); dashboard.getRange("G5:H5").merge();
dashboard.getRange("A5").formulas = [["=SUM(K4:K8)"]];
dashboard.getRange("C5").formulas = [["=SUM(K4:K7)"]];
dashboard.getRange("E5").formulas = [[`=COUNTIF('Activity Tracker'!$H$${firstDataRow}:$H$${lastDataRow},"In Progress")`]];
dashboard.getRange("G5").formulas = [[`=COUNTIF('Activity Tracker'!$H$${firstDataRow}:$H$${lastDataRow},"Blocked")`]];
dashboard.getRange("A5:H5").format = { fill: "#FFFFFF", font: { bold: true, color: navy, size: 18 }, horizontalAlignment: "Center", verticalAlignment: "Center", borders: { preset: "outside", style: "thin", color: lightGray } };

dashboard.getRange("A8:H8").values = [[cardLabels[1][0], "", cardLabels[1][1], "", cardLabels[1][2], "", cardLabels[1][3], ""]];
dashboard.getRange("A8:B8").merge(); dashboard.getRange("C8:D8").merge(); dashboard.getRange("E8:F8").merge(); dashboard.getRange("G8:H8").merge();
dashboard.getRange("A8:H8").format = { fill: teal, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "Center", verticalAlignment: "Center" };
dashboard.getRange("A9:H9").values = [[null, null, null, null, null, null, null, null]];
dashboard.getRange("A9:B9").merge(); dashboard.getRange("C9:D9").merge(); dashboard.getRange("E9:F9").merge(); dashboard.getRange("G9:H9").merge();
dashboard.getRange("A9").formulas = [[`=SUM('Activity Tracker'!$L$${firstDataRow}:$L$${lastDataRow})`]];
dashboard.getRange("C9").formulas = [[`=SUM('Activity Tracker'!$M$${firstDataRow}:$M$${lastDataRow})`]];
dashboard.getRange("E9").formulas = [[`=SUM('Activity Tracker'!$O$${firstDataRow}:$O$${lastDataRow})`]];
dashboard.getRange("G9").formulas = [[`=COUNTIF('Activity Tracker'!$Q$${firstDataRow}:$Q$${lastDataRow},"Yes")`]];
dashboard.getRange("A9:H9").format = { fill: "#FFFFFF", font: { bold: true, color: navy, size: 18 }, horizontalAlignment: "Center", verticalAlignment: "Center", borders: { preset: "outside", style: "thin", color: lightGray } };
dashboard.getRange("A9:F9").format.numberFormat = "0.0";

dashboard.getRange("A12:H12").merge();
dashboard.getRange("A12").values = [["Tracking note"]];
dashboard.getRange("A12:H12").format = { fill: paleAmber, font: { bold: true, color: "#92400E" } };
dashboard.getRange("A13:H15").merge();
dashboard.getRange("A13").values = [["Overdue? is calculated from today's date. The imported source plan contains historical 2025 dates, so update Due Date values if this is an active/current plan."]];
dashboard.getRange("A13:H15").format = { fill: "#FFFBEB", font: { color: grayText }, wrapText: true, verticalAlignment: "Center", borders: { preset: "outside", style: "thin", color: paleAmber } };

dashboard.getRange("J3:K3").values = [["Status", "Count"]];
dashboard.getRange("J4:J8").values = [["Pending"], ["In Progress"], ["Blocked"], ["On Hold"], ["Completed"]];
dashboard.getRange("K4").formulas = [[`=COUNTIF('Activity Tracker'!$H$${firstDataRow}:$H$${lastDataRow},J4)`]];
dashboard.getRange("K4:K8").fillDown();
dashboard.getRange("J3:K3").format = { fill: blue, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "Center" };
dashboard.getRange("J4:K8").format = { borders: { preset: "all", style: "thin", color: lightGray } };
dashboard.getRange("J4:K8").format.numberFormat = "0";
const chart = dashboard.charts.add("bar", dashboard.getRange("J3:K8"));
chart.title = "Activities by Status";
chart.hasLegend = false;
chart.setPosition("J10", "Q26");

dashboard.getRange("A1:Q26").format.font = { name: "Aptos", size: 10 };
dashboard.getRange("A1:Q1").format.font = { name: "Aptos Display", bold: true, color: "#FFFFFF", size: 16 };
for (const [col, width] of [["A", 17], ["B", 17], ["C", 17], ["D", 17], ["E", 17], ["F", 17], ["G", 17], ["H", 17], ["I", 3], ["J", 16], ["K", 11], ["L", 3], ["M", 3], ["N", 3], ["O", 3], ["P", 3], ["Q", 3]]) dashboard.getRange(`${col}1:${col}26`).format.columnWidth = width;
dashboard.getRange("A1:Q2").format.rowHeight = 24;
dashboard.getRange("A5:H5").format.rowHeight = 32;
dashboard.getRange("A9:H9").format.rowHeight = 32;
dashboard.freezePanes.freezeRows(2);

// Compact verification and renders.
const trackerCheck = await workbook.inspect({ kind: "table", sheetId: "Activity Tracker", range: "A8:S15", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 19, maxChars: 10000 });
console.log("TRACKER_CHECK\n" + trackerCheck.ndjson);
const dashboardCheck = await workbook.inspect({ kind: "table", sheetId: "Dashboard", range: "A1:K15", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 11, maxChars: 10000 });
console.log("DASHBOARD_CHECK\n" + dashboardCheck.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
console.log("ERROR_SCAN\n" + errors.ndjson);

for (const sheetName of ["Dashboard", "Activity Tracker", "Lists & Guide"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}\\${sheetName.replaceAll(" ", "_").replaceAll("&", "and")}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = `${outputDir}\\pending_activities_tracker.xlsx`;
await output.save(outputPath);
console.log(`OUTPUT_PATH=${outputPath}`);
console.log(`PENDING_ROWS=${sourceRows.length}`);
