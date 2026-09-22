import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path = "tmp/Inventory product template.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
const products = workbook.worksheets.getItem("Products");
for (let col = 0; col < 36; col++) {
  const cell = products.getCell(0, col);
  const style = await workbook.inspect({ kind: "computedStyle", sheetId: "Products", range: cell.address, maxChars: 1000 });
  console.log(`HEADER ${cell.address} ${JSON.stringify(cell.values)} ${style.ndjson}`);
}
console.log((await workbook.inspect({
  kind: "workbook,sheet,table,region,computedStyle",
  maxChars: 18000,
  tableMaxRows: 30,
  tableMaxCols: 30,
  tableMaxCellChars: 150,
})).ndjson);
for (const sheet of workbook.worksheets.items) {
  const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1.5, format: "png" });
  await fs.writeFile(`tmp/template-${sheet.name.replace(/[^a-z0-9]+/gi, "-")}.png`, new Uint8Array(await preview.arrayBuffer()));
  console.log(`RENDER ${sheet.name}`);
}
