import fs from "node:fs";
import fsp from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [templatePath, masterPath, barcodePath, outputPath, stockPath, stockReportPath] = process.argv.slice(2);
if (!templatePath || !masterPath || !barcodePath || !outputPath) {
  throw new Error("Usage: node build_product_import.mjs <template.xlsx> <Product_Master_List.tsv> <Product_Barcodes.tsv> <output.xlsx>");
}

function readTsv(path, requiredHeaders) {
  const lines = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split("\t").map((value) => value.trim());
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new Error(`${path} is missing ${header}`);
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    if (cells.length !== headers.length) {
      throw new Error(`${path} row ${index + 2} has ${cells.length} fields, expected ${headers.length}`);
    }
    const row = {};
    headers.forEach((header, column) => { row[header] = cells[column].trim(); });
    return row;
  });
}

const masters = readTsv(masterPath, [
  "Product_Id", "Product_Name", "Product_Description", "Category_Id", "Active_Product", "Deleted",
]);
const barcodeRows = readTsv(barcodePath, ["Barcode", "Product_Id"]);
const stockRows = stockPath ? readTsv(stockPath, ["product_id", "Quantity_On_Hand", "last_purchase_price", "average_unit_cost"]) : [];
const stockReport = stockReportPath ? JSON.parse(fs.readFileSync(stockReportPath, "utf8")) : [];
const activeProducts = masters.filter((product) =>
  /^\d+$/.test(product.Product_Id)
  && BigInt(product.Product_Id) > 0n
  && product.Active_Product === "1"
  && product.Deleted === "0"
);

const barcodesByProduct = new Map();
const productByBarcode = new Map();
for (const row of barcodeRows) {
  const barcode = row.Barcode;
  if (!barcode || row.Product_Id === "0") continue;
  if (!barcodesByProduct.has(row.Product_Id)) barcodesByProduct.set(row.Product_Id, new Set());
  barcodesByProduct.get(row.Product_Id).add(barcode);
  productByBarcode.set(barcode, row.Product_Id);
}

const normalizedProducts = new Map();
function numericKey(value) {
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : null;
}
for (const [barcode, productId] of productByBarcode) {
  const key = numericKey(barcode);
  if (!key) continue;
  if (!normalizedProducts.has(key)) normalizedProducts.set(key, new Set());
  normalizedProducts.get(key).add(productId);
}
const reportByProduct = new Map();
let unmatchedReportRows = 0;
let conflictingReportRows = 0;
for (const report of stockReport) {
  const matches = new Set();
  for (const barcode of report.barcodes) {
    const direct = productByBarcode.get(barcode);
    if (direct) {
      matches.add(direct);
    } else {
      const key = numericKey(barcode);
      const candidates = key ? normalizedProducts.get(key) : null;
      if (candidates?.size === 1) matches.add([...candidates][0]);
    }
  }
  if (matches.size === 0) { unmatchedReportRows++; continue; }
  if (matches.size !== 1) { conflictingReportRows++; continue; }
  const productId = [...matches][0];
  if (!reportByProduct.has(productId)) reportByProduct.set(productId, []);
  reportByProduct.get(productId).push(report);
}
const stockByProduct = new Map();
for (const row of stockRows) {
  if (!stockByProduct.has(row.product_id)) stockByProduct.set(row.product_id, []);
  stockByProduct.get(row.product_id).push(row);
}

const outputRows = [];
let productsWithMultipleBarcodes = 0;
let productsWithoutBarcode = 0;
let productsWithReportMatch = 0;
let productsWithStockMatch = 0;
let productsWithAmbiguousReport = 0;
for (const product of activeProducts) {
  const barcodes = [...(barcodesByProduct.get(product.Product_Id) ?? [])];
  const reportMatches = reportByProduct.get(product.Product_Id) ?? [];
  const report = reportMatches.length === 1 ? reportMatches[0] : null;
  if (reportMatches.length > 1) productsWithAmbiguousReport++;
  if (report) productsWithReportMatch++;
  const stockMatches = stockByProduct.get(product.Product_Id) ?? [];
  const stock = stockMatches.length === 1 ? stockMatches[0] : null;
  if (stock) productsWithStockMatch++;
  if (barcodes.length > 1) productsWithMultipleBarcodes++;
  if (barcodes.length === 0) productsWithoutBarcode++;
  for (const [barcodeIndex, barcode] of (barcodes.length ? barcodes : [null]).entries()) {
    const cells = Array(36).fill(null);
    cells[0] = product.Product_Id;
    cells[1] = product.Product_Name || null;
    cells[2] = product.Product_Description || null;
    cells[3] = product.Category_Id || null;
    if (report) {
      cells[4] = Number.isFinite(report.ticket_value) ? report.ticket_value : null;
      cells[8] = Number.isFinite(report.sale_price) ? report.sale_price : null;
      cells[19] = report.unit_name || null;
    }
    if (stock) {
      cells[5] = stock.average_unit_cost === "" ? null : Number(stock.average_unit_cost);
      cells[34] = stock.last_purchase_price === "" ? null : Number(stock.last_purchase_price);
      if (barcodeIndex === 0) {
        cells[33] = stock.Quantity_On_Hand === "" ? 1 : Number(stock.Quantity_On_Hand);
      }
    }
    cells[10] = barcode;
    outputRows.push(cells);
  }
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(templatePath));
const sheet = workbook.worksheets.getItem("Products");
const headers = sheet.getRange("A1:AJ1").values[0];
if (headers[0] !== "Code" || headers[10] !== "Bar Code" || headers.length !== 36) {
  throw new Error("Unexpected product template layout");
}

const lastRow = outputRows.length + 1;
const currentLastRow = Number(sheet.getUsedRange().address.match(/\d+$/)?.[0]);
if (!Number.isInteger(currentLastRow)) throw new Error("Could not determine current template row count");
if (lastRow > currentLastRow) {
  sheet.getRange(`A${currentLastRow + 1}:AJ${lastRow}`)
    .copyFrom(sheet.getRange(`A${currentLastRow}:AJ${currentLastRow}`), "all");
}
sheet.getRange(`A2:A${lastRow}`).setNumberFormat("@");
sheet.getRange(`K2:K${lastRow}`).setNumberFormat("@");
sheet.getRange(`A2:AJ${lastRow}`).values = outputRows;
sheet.getRange("A1").format.columnWidth = 24;
sheet.getRange("K1").format.columnWidth = 24;

await fsp.mkdir((await import("node:path")).dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log((await workbook.inspect({
  kind: "table", range: "Products!A1:K10", include: "values,formulas",
  tableMaxRows: 10, tableMaxCols: 11, maxChars: 9000,
})).ndjson);
console.log((await workbook.inspect({
  kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 }, summary: "formula error scan",
})).ndjson);
const preview = await workbook.render({ sheetName: "Products", range: "A1:K20", scale: 1.2, format: "png" });
await fsp.writeFile(`${outputPath}.preview.png`, new Uint8Array(await preview.arrayBuffer()));

console.log(JSON.stringify({
  outputPath,
  activeProducts: activeProducts.length,
  outputRows: outputRows.length,
  productsWithMultipleBarcodes,
  productsWithoutBarcode,
  extraBarcodeRows: outputRows.length - activeProducts.length,
  productsWithReportMatch,
  productsWithAmbiguousReport,
  unmatchedReportRows,
  conflictingReportRows,
  productsWithStockMatch,
}));
