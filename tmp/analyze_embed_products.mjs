import fs from "node:fs";

const masterPath = "C:/Users/steve/.codex/attachments/5ef8e5d6-223d-4111-bb12-abcef6b2c15c/Pasted text.txt";
const barcodePath = "C:/Users/steve/.codex/attachments/f77a0c99-0a99-4c59-8e70-f301643d425b/Pasted text.txt";

function parseTsv(path) {
  const lines = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split("\t").map((x) => x.trim());
  return lines.slice(1).map((line, index) => {
    const values = line.split("\t");
    const row = { _row: index + 2 };
    headers.forEach((header, i) => row[header] = (values[i] ?? "").trim());
    return row;
  });
}

const masters = parseTsv(masterPath);
const barcodes = parseTsv(barcodePath);
const masterIds = new Set(masters.map((row) => row.Product_Id));
const byProduct = new Map();
for (const row of barcodes) {
  if (!byProduct.has(row.Product_Id)) byProduct.set(row.Product_Id, []);
  byProduct.get(row.Product_Id).push(row);
}

const positive = masters.filter((row) => /^\d+$/.test(row.Product_Id) && BigInt(row.Product_Id) > 0n);
const active = positive.filter((row) => row.Active_Product === "1" && row.Deleted === "0");
const multipleBarcodes = [...byProduct].filter(([id, rows]) => id !== "0" && rows.length > 1);
const orphanBarcodes = barcodes.filter((row) => !masterIds.has(row.Product_Id));
const zeroBarcodes = barcodes.filter((row) => row.Product_Id === "0");
const activeWithBarcode = active.filter((row) => byProduct.has(row.Product_Id));
const activeWithoutBarcode = active.filter((row) => !byProduct.has(row.Product_Id));

console.log(JSON.stringify({
  masterRows: masters.length,
  positiveMasterRows: positive.length,
  activeNonDeletedRows: active.length,
  barcodeRows: barcodes.length,
  activeWithBarcode: activeWithBarcode.length,
  activeWithoutBarcode: activeWithoutBarcode.length,
  productIdsWithMultipleBarcodes: multipleBarcodes.length,
  extraBarcodeRowsForThoseProducts: multipleBarcodes.reduce((sum, [, rows]) => sum + rows.length - 1, 0),
  orphanBarcodes: orphanBarcodes.length,
  zeroProductBarcodes: zeroBarcodes.length,
  multipleBarcodeExamples: multipleBarcodes.slice(0, 10).map(([id, rows]) => ({ id, barcodes: rows.map((r) => r.Barcode) })),
  activeWithoutBarcodeExamples: activeWithoutBarcode.slice(0, 10).map((r) => ({ id: r.Product_Id, name: r.Product_Name })),
  activeCategoryCounts: Object.entries(active.reduce((acc, row) => { const key = row.Category_Id.trim() || "(blank)"; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a,b) => b[1]-a[1]),
  activeProductTypeCounts: Object.entries(active.reduce((acc, row) => { const key = row.Product_Type.trim() || "(blank)"; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a,b) => b[1]-a[1]),
}, null, 2));
