import fs from "node:fs/promises";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = "C:/Users/steve/OneDrive/Documents/ChatGPT/PCS Archive and dashboard";
const payload = JSON.parse(await fs.readFile(root + "/output_work/temu_orders.json", "utf8"));
const outDir = root + "/outputs/temu_orders";
await fs.mkdir(outDir, { recursive: true });

const wb = Workbook.create();
console.log("checkpoint: workbook");
const orders = wb.worksheets.add("Orders");
const summary = wb.worksheets.add("Summary");

const headers = [
  "Image", "Order Date", "Order ID", "Item Name", "Variant", "Qty",
  "Items in Order", "Listed Unit Price", "Paid Unit Price", "Shipping for Order",
  "Shipping Added / Unit", "Unit Cost incl. Shipping", "Line Cost incl. Shipping",
  "Sales Tax (Order)", "Order Total", "Image URL", "Receipt URL"
];
orders.getRange("A1:Q1").values = [headers];
const values = payload.rows.map(r => [
  null,
  new Date(r.orderDate),
  r.orderId,
  r.itemName,
  r.variant,
  r.qty,
  r.itemsInOrder,
  r.listedUnitPrice,
  r.paidUnitPrice,
  r.shippingOrder,
  null,
  null,
  null,
  r.salesTax,
  r.orderTotal,
  r.imageUrl,
  r.receiptUrl
]);
const endRow = values.length + 1;
orders.getRange(`A2:Q${endRow}`).values = values;

orders.getRange("K2").formulas = [["=IF(G2=0,0,J2/G2)"]];
orders.getRange(`K2:K${endRow}`).fillDown();
orders.getRange("L2").formulas = [["=I2+K2"]];
orders.getRange(`L2:L${endRow}`).fillDown();
orders.getRange("M2").formulas = [["=L2*F2"]];
orders.getRange(`M2:M${endRow}`).fillDown();

orders.getRange("A1:Q1").format = {
  fill: "#E8EAED",
  font: { bold: true, color: "#202124" },
  borders: { preset: "doubleBottom", style: "thin", color: "#9AA0A6" },
  verticalAlignment: "center",
  wrapText: true
};
orders.getRange(`A2:Q${endRow}`).format.font = { color: "#202124", size: 10 };
orders.getRange(`B2:B${endRow}`).format.numberFormat = "yyyy-mm-dd";
orders.getRange(`F2:G${endRow}`).format.numberFormat = "#,##0";
orders.getRange(`H2:O${endRow}`).format.numberFormat = "$#,##0.00";
orders.getRange(`A2:A${endRow}`).format.rowHeightPx = 64;
orders.getRange("A:A").format.columnWidthPx = 72;
orders.getRange("B:B").format.columnWidthPx = 95;
orders.getRange("C:C").format.columnWidthPx = 190;
orders.getRange("D:D").format.columnWidthPx = 360;
orders.getRange("E:E").format.columnWidthPx = 150;
orders.getRange("F:G").format.columnWidthPx = 90;
orders.getRange("H:O").format.columnWidthPx = 120;
orders.getRange("P:Q").format.columnWidthPx = 260;
orders.getRange(`D2:E${endRow}`).format.wrapText = true;
orders.getRange(`P2:Q${endRow}`).format.wrapText = false;
orders.freezePanes.freezeRows(1);
orders.freezePanes.freezeColumns(3);
orders.showGridLines = true;
const ordersTable = orders.tables.add(`A1:Q${endRow}`, true, "TemuOrdersTable");
ordersTable.style = "TableStyleLight1";
console.log("checkpoint: orders");

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Temu Order Summary"]];
summary.getRange("A1:F1").format = {
  fill: "#E8EAED",
  font: { bold: true, size: 16, color: "#202124" },
  horizontalAlignment: "left",
  verticalAlignment: "center"
};
summary.getRange("A1:F1").format.rowHeightPx = 34;
summary.getRange("A3:B3").values = [["Metric", "Value"]];
summary.getRange("A4:A9").values = [
  ["Orders"], ["Product / variant lines"], ["Units purchased"],
  ["Merchandise paid"], ["Shipping paid"], ["Order totals"]
];
summary.getRange("B4:B9").formulas = [
  [`=COUNTA(UNIQUE('Orders'!C2:C${endRow}))`],
  [`=COUNTA('Orders'!D2:D${endRow})`],
  [`=SUM('Orders'!F2:F${endRow})`],
  [`=SUMPRODUCT('Orders'!I2:I${endRow},'Orders'!F2:F${endRow})`],
  [`=SUMPRODUCT(('Orders'!C2:C${endRow}<> 'Orders'!C1:C${endRow-1})*'Orders'!J2:J${endRow})`],
  [`=SUMPRODUCT(('Orders'!C2:C${endRow}<> 'Orders'!C1:C${endRow-1})*'Orders'!O2:O${endRow})`]
];
summary.getRange("A3:B3").format = {
  fill: "#E8EAED", font: { bold: true, color: "#202124" },
  borders: { preset: "doubleBottom", style: "thin", color: "#9AA0A6" }
};
summary.getRange("A4:A9").format.font = { bold: true, color: "#3C4043" };
summary.getRange("B4:B6").format.numberFormat = "#,##0";
summary.getRange("B7:B9").format.numberFormat = "$#,##0.00";
summary.getRange("A11:F13").merge(true);
summary.getRange("A11").values = [[
  "Method: Shipping Added / Unit = order shipping ÷ total units in that order. " +
  "Unit Cost incl. Shipping = paid unit price + shipping allocation. " +
  "Sales tax is shown separately and is not included in the shipping-adjusted item cost."
]];
summary.getRange("A11:F13").format = {
  fill: "#F8F9FA", font: { italic: true, color: "#5F6368", size: 10 },
  wrapText: true, verticalAlignment: "top",
  borders: { preset: "outside", style: "thin", color: "#DADCE0" }
};
summary.getRange("A:A").format.columnWidthPx = 190;
summary.getRange("B:B").format.columnWidthPx = 125;
summary.getRange("C:F").format.columnWidthPx = 105;
summary.freezePanes.freezeRows(1);
summary.showGridLines = true;
console.log("checkpoint: summary");

const check = await wb.inspect({
  kind: "table",
  range: `Orders!B1:Q8`,
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 17
});
console.log(check.ndjson);
console.log("checkpoint: inspect");
const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan"
});
console.log(errors.ndjson);
console.log("checkpoint: errors");
for (const sheetName of ["Summary", "Orders"]) {
  const preview = await wb.render({
    sheetName,
    range: sheetName === "Summary" ? "A1:F13" : "B1:O10",
    scale: 1,
    format: "png"
  });
  await fs.writeFile(outDir + "/" + sheetName.toLowerCase() + ".png", new Uint8Array(await preview.arrayBuffer()));
  console.log("checkpoint: rendered " + sheetName);
}
// Keep product images as live URL-based formulas so the native Google Sheet
// stays compact while displaying the receipt thumbnail in each row.
orders.getRange("A2").formulas = [["=IMAGE(P2)"]];
orders.getRange(`A2:A${endRow}`).fillDown();
console.log("checkpoint: images");
const xlsx = await SpreadsheetFile.exportXlsx(wb);
console.log("checkpoint: exported");
await xlsx.save(outDir + "/Temu Order History.xlsx");
console.log(JSON.stringify({output: outDir + "/Temu Order History.xlsx", rows: payload.rows.length, endRow}));
