import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "C:/Users/steve/.codex/attachments/7533d102-1ce7-48d1-9da8-7d9e821a4537/pasted-text.txt";
const outputDir = "outputs/01a0a2dc-57ea-7041-8d8b-0d58d12eeb14";
const outputPath = path.join(outputDir, "Product Catalog.xlsx");
const previewPath = path.join(outputDir, "Product Catalog Preview.png");

const text = await fs.readFile(sourcePath, "utf8");
const rawLines = text.replace(/\r/g, "").split("\n");
const categoryPattern = /^\s*(.*?)\s+Edit Category Name\s+Sort Products\s*$/;
const pricePattern = /^\$\(?[\d,]+\.\d{2}\)?$/;
const skipped = new Set([
  "Product Type", "Price", "Available Online", "Schedulable",
  "Taxable", "Discountable", "Description"
]);

const categoryStarts = [];
for (let i = 0; i < rawLines.length; i++) {
  const match = rawLines[i].match(categoryPattern);
  if (match) categoryStarts.push({ index: i, name: match[1].trim() });
}

const rows = [];
for (let c = 0; c < categoryStarts.length; c++) {
  const start = categoryStarts[c];
  const end = c + 1 < categoryStarts.length ? categoryStarts[c + 1].index : rawLines.length;
  const tokens = rawLines
    .slice(start.index + 1, end)
    .map((s) => s.trim())
    .filter((s) => s && !skipped.has(s));

  const priceIndexes = [];
  for (let i = 0; i < tokens.length; i++) if (pricePattern.test(tokens[i])) priceIndexes.push(i);

  for (let p = 0; p < priceIndexes.length; p++) {
    const priceIndex = priceIndexes[p];
    if (priceIndex < 2) continue;
    const productName = tokens[priceIndex - 2];
    const productType = tokens[priceIndex - 1];
    const nextNameIndex = p + 1 < priceIndexes.length ? priceIndexes[p + 1] - 2 : tokens.length;
    const description = tokens.slice(priceIndex + 1, nextNameIndex).join(" ");
    const priceText = tokens[priceIndex];
    const negative = /^\$\(/.test(priceText);
    const price = Number(priceText.replace(/[$(),]/g, "")) * (negative ? -1 : 1);
    rows.push([
      start.name,
      productName,
      productType,
      price,
      null,
      null,
      null,
      null,
      description || null,
    ]);
  }
}

if (!rows.length) throw new Error("No product rows were parsed from the pasted text.");

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Products");
const headers = [[
  "Category", "Product Name", "Product Type", "Price",
  "Available Online", "Schedulable", "Taxable", "Discountable", "Description"
]];
sheet.getRange("A1:I1").values = headers;
sheet.getRangeByIndexes(1, 0, rows.length, headers[0].length).values = rows;

const lastRow = rows.length + 1;
const table = sheet.tables.add(`A1:I${lastRow}`, true, "ProductCatalog");
table.style = "TableStyleMedium2";
table.showFilterButton = true;
sheet.freezePanes.freezeRows(1);
sheet.showGridLines = false;

const all = sheet.getRange(`A1:I${lastRow}`);
all.format.font = { name: "Arial", size: 10, color: "#1F2937" };
all.format.verticalAlignment = "top";
sheet.getRange("A1:I1").format = {
  fill: "#17365D",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  rowHeight: 30,
};
sheet.getRange(`D2:D${lastRow}`).format.numberFormat = "$#,##0.00;[Red]($#,##0.00)";
sheet.getRange(`D2:D${lastRow}`).format.horizontalAlignment = "right";
sheet.getRange(`E2:H${lastRow}`).format.horizontalAlignment = "center";
sheet.getRange(`B2:B${lastRow}`).format.wrapText = true;
sheet.getRange(`I2:I${lastRow}`).format.wrapText = true;

sheet.getRange(`A1:A${lastRow}`).format.columnWidth = 22;
sheet.getRange(`B1:B${lastRow}`).format.columnWidth = 42;
sheet.getRange(`C1:C${lastRow}`).format.columnWidth = 18;
sheet.getRange(`D1:D${lastRow}`).format.columnWidth = 13;
sheet.getRange(`E1:H${lastRow}`).format.columnWidth = 15;
sheet.getRange(`I1:I${lastRow}`).format.columnWidth = 65;
sheet.getRange(`A2:I${lastRow}`).format.rowHeight = 32;

const notes = workbook.worksheets.add("Notes");
notes.getRange("A1:B4").values = [
  ["Product catalog import", null],
  ["Source", "pasted-text.txt"],
  ["Imported rows", rows.length],
  ["Status columns", "Available Online, Schedulable, Taxable, and Discountable were blank in the pasted source and remain blank."],
];
notes.getRange("A1:B1").format.font = { name: "Arial", size: 14, bold: true, color: "#17365D" };
notes.getRange("A2:A4").format.font = { name: "Arial", size: 10, bold: true, color: "#374151" };
notes.getRange("A1:B4").format.verticalAlignment = "top";
notes.getRange("A1:A4").format.columnWidth = 22;
notes.getRange("B1:B4").format.columnWidth = 80;
notes.getRange("B4").format.wrapText = true;
notes.getRange("A1:B4").format.rowHeight = 24;
notes.showGridLines = false;

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "Products", range: "A1:I30", scale: 1, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const check = await workbook.inspect({
  kind: "table",
  range: "Products!A1:I12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 9,
  maxChars: 8000,
});
console.log(check.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, previewPath, categories: categoryStarts.length, rows: rows.length }));
