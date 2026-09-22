import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load("tmp/Inventory product template.xlsx"));
console.log(workbook.help("worksheet.tables", { include: "index,examples,notes", maxChars: 5000 }).ndjson);
console.log(workbook.help("table.resize", { include: "index,examples,notes", maxChars: 5000 }).ndjson);
