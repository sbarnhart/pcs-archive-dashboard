import fs from "node:fs";
import fsp from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "tmp/Inventory product template.xlsx";
const outputDir = "outputs/embed-product-import-20260922";
const outputPath = `${outputDir}/Inventory product template - Embed populated.xlsx`;
const masterPath = "C:/Users/steve/.codex/attachments/5ef8e5d6-223d-4111-bb12-abcef6b2c15c/Pasted text.txt";
const barcodePath = "C:/Users/steve/.codex/attachments/f77a0c99-0a99-4c59-8e70-f301643d425b/Pasted text.txt";

function parseTsv(path) {
  const lines = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split("\t").map((x) => x.trim());
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    const row = {};
    headers.forEach((header, index) => row[header] = (values[index] ?? "").trim());
    return row;
  });
}

const masters = parseTsv(masterPath);
const barcodes = parseTsv(barcodePath);
const firstBarcodeByProduct = new Map();
for (const row of barcodes) {
  if (row.Product_Id !== "0" && !firstBarcodeByProduct.has(row.Product_Id)) {
    firstBarcodeByProduct.set(row.Product_Id, row.Barcode);
  }
}

const selected = masters.filter((row) =>
  /^\d+$/.test(row.Product_Id)
  && BigInt(row.Product_Id) > 0n
  && row.Active_Product === "1"
  && row.Deleted === "0"
);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("Products");
const outputRows = selected.map((row) => {
  const values = Array(36).fill(null);
  values[0] = row.Product_Id;
  values[1] = row.Product_Name || null;
  values[2] = row.Product_Description || null;
  values[3] = row.Category_Id || null;
  values[10] = firstBarcodeByProduct.get(row.Product_Id) || null;
  return values;
});

const lastRow = selected.length + 1;
sheet.getRange(`A2:AJ${lastRow}`).copyFrom(sheet.getRange("A2:AJ2"), "all");
sheet.getRange(`A2:A${lastRow}`).setNumberFormat("@");
sheet.getRange(`K2:K${lastRow}`).setNumberFormat("@");
sheet.getRange(`A2:AJ${lastRow}`).values = outputRows;

await fsp.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log((await workbook.inspect({
  kind: "table",
  range: `Products!A1:K15`,
  include: "values,formulas",
  tableMaxRows: 15,
  tableMaxCols: 11,
  maxChars: 10000,
})).ndjson);
console.log((await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
})).ndjson);
const preview = await workbook.render({ sheetName: "Products", range: "A1:K25", scale: 1.5, format: "png" });
await fsp.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
console.log(JSON.stringify({ outputPath, selectedRows: selected.length, withoutBarcode: selected.filter((row) => !firstBarcodeByProduct.has(row.Product_Id)).length }));
