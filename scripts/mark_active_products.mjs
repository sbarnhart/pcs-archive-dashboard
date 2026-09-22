import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "outputs/01a0a2dc-57ea-7041-8d8b-0d58d12eeb14/Product Catalog.xlsx";
const activeSource = "C:/Users/steve/.codex/attachments/48a02182-1132-4c53-82ab-ecd730ace9da/pasted-text.txt";
const outputDir = "outputs/01a0a2dc-57ea-7041-8d8b-0d58d12eeb14";
const outputPath = path.join(outputDir, "Product Catalog - Active Status.xlsx");
const previewPath = path.join(outputDir, "Product Catalog - Active Status Preview.png");

const categoryPattern = /^\s*(.*?)\s+Edit Category Name\s+Sort Products\s*$/;
const pricePattern = /^\$\(?[\d,]+\.\d{2}\)?$/;
const skipped = new Set(["Product Type", "Price", "Available Online", "Schedulable", "Taxable", "Discountable", "Description"]);
const normalize = (value) => String(value ?? "")
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/[–—]/g, "-")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");
const priceKey = (value) => Number(value).toFixed(2);

function parseProducts(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(categoryPattern);
    if (match) starts.push({ index: i, name: match[1].trim() });
  }
  const products = [];
  for (let c = 0; c < starts.length; c++) {
    const start = starts[c];
    const end = c + 1 < starts.length ? starts[c + 1].index : lines.length;
    const tokens = lines.slice(start.index + 1, end).map((s) => s.trim()).filter((s) => s && !skipped.has(s));
    for (let i = 0; i < tokens.length; i++) {
      if (!pricePattern.test(tokens[i]) || i < 2) continue;
      const negative = /^\$\(/.test(tokens[i]);
      const price = Number(tokens[i].replace(/[$(),]/g, "")) * (negative ? -1 : 1);
      products.push({ category: start.name, name: tokens[i - 2], type: tokens[i - 1], price });
    }
  }
  return products;
}

const activeText = await fs.readFile(activeSource, "utf8");
const activeProducts = parseProducts(activeText);
const exact = new Set(activeProducts.map((p) => [normalize(p.category), normalize(p.name), normalize(p.type), priceKey(p.price)].join("|")));
const relaxed = new Set(activeProducts.map((p) => [normalize(p.category), normalize(p.name)].join("|")));

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("Products");
const used = sheet.getUsedRange(true);
const values = used.values;
const header = values[0];
const categoryCol = header.indexOf("Category");
const nameCol = header.indexOf("Product Name");
const typeCol = header.indexOf("Product Type");
const priceCol = header.indexOf("Price");
if ([categoryCol, nameCol, typeCol, priceCol].some((i) => i < 0)) throw new Error("Expected product columns were not found.");

let activeCount = 0;
let exactCount = 0;
let relaxedCount = 0;
const statuses = [];
for (let r = 1; r < values.length; r++) {
  const exactKey = [normalize(values[r][categoryCol]), normalize(values[r][nameCol]), normalize(values[r][typeCol]), priceKey(values[r][priceCol])].join("|");
  const relaxedKey = [normalize(values[r][categoryCol]), normalize(values[r][nameCol])].join("|");
  const isExact = exact.has(exactKey);
  const isRelaxed = !isExact && relaxed.has(relaxedKey);
  const isActive = isExact || isRelaxed;
  if (isActive) activeCount++;
  if (isExact) exactCount++;
  if (isRelaxed) relaxedCount++;
  statuses.push([isActive ? "Yes" : "No"]);
}

const lastRow = values.length;
sheet.getRange("J1").values = [["Active"]];
sheet.getRange(`J2:J${lastRow}`).values = statuses;
sheet.getRange("J1").format = {
  fill: "#17365D",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange(`J1:J${lastRow}`).format.columnWidth = 11;
sheet.getRange(`J2:J${lastRow}`).format.horizontalAlignment = "center";
sheet.getRange(`J2:J${lastRow}`).conditionalFormats.addCustom('=J2="Yes"', {
  fill: "#C6EFCE", font: { color: "#006100", bold: true }
});
sheet.getRange(`J2:J${lastRow}`).conditionalFormats.addCustom('=J2="No"', {
  fill: "#E7E6E6", font: { color: "#595959" }
});

for (const table of [...sheet.tables.items]) table.delete();
const table = sheet.tables.add(`A1:J${lastRow}`, true, "ProductCatalogActive");
table.style = "TableStyleMedium2";
table.showFilterButton = true;

const notes = workbook.worksheets.getItem("Notes");
notes.getRange("A5:B8").values = [
  ["Active source", "pasted-text.txt (active products list)"],
  ["Active products", activeCount],
  ["Inactive products", statuses.length - activeCount],
  ["Matching", `${exactCount} exact matches; ${relaxedCount} normalized category/name matches`],
];
notes.getRange("A5:A8").format.font = { name: "Arial", size: 10, bold: true, color: "#374151" };
notes.getRange("A5:B8").format.verticalAlignment = "top";
notes.getRange("B8").format.wrapText = true;

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "Products", range: "A1:J30", scale: 1, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

console.log((await workbook.inspect({
  kind: "table", range: "Products!A1:J12", include: "values,formulas",
  tableMaxRows: 12, tableMaxCols: 10, maxChars: 9000,
})).ndjson);
console.log((await workbook.inspect({
  kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 50 }, summary: "final formula error scan",
})).ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, previewPath, sourceActiveRows: activeProducts.length, catalogRows: statuses.length, activeCount, inactiveCount: statuses.length - activeCount, exactCount, relaxedCount }));
