import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path = "C:\\Users\\haris\\Projects\\Connected Enterprise\\outputs\\activity_tracker_20260902\\pending_activities_tracker.xlsx";
const input = await FileBlob.load(path);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({ kind: "workbook,sheet,table,drawing", maxChars: 12000, tableMaxRows: 8, tableMaxCols: 10, tableMaxCellChars: 120 });
console.log("SUMMARY\n" + summary.ndjson);
const style = await workbook.inspect({ kind: "computedStyle", sheetId: "Activity Tracker", range: "A1:S12", maxChars: 10000 });
console.log("STYLE\n" + style.ndjson);
for (const sheetName of ["Dashboard", "Activity Tracker", "Lists & Guide"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`C:\\Users\\haris\\Projects\\Connected Enterprise\\.tmp-activity-tracker\\previews\\existing_${sheetName.replaceAll(" ", "_").replaceAll("&", "and")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
