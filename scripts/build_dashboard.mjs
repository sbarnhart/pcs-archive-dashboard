import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const exportsDir = path.join(root, "exports");
const outputDir = path.join(root, "dashboard-output");
const outputPath = path.join(outputDir, "PCS Archive Dashboard.xlsx");
const archiveVersion = "1.0";

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function loadRuns() {
  const entries = await fs.readdir(exportsDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "reporting" || entry.name === "order-probe") continue;
    const manifestFile = path.join(exportsDir, entry.name, "manifest.json");
    if (!(await exists(manifestFile))) continue;
    const manifest = await readJson(manifestFile);
    if (!manifest.completedAt || !manifest.dateRange?.start || !manifest.dateRange?.end) continue;
    candidates.push({ name: entry.name, manifest });
  }

  // Validation samples often overlap a later year-to-date/full-year run. Keep the
  // broadest completed range so orders are never counted twice.
  const selected = candidates.filter((candidate) => !candidates.some((other) =>
    other.name !== candidate.name &&
    other.manifest.dateRange.start <= candidate.manifest.dateRange.start &&
    other.manifest.dateRange.end >= candidate.manifest.dateRange.end &&
    (other.manifest.dateRange.start < candidate.manifest.dateRange.start ||
      other.manifest.dateRange.end > candidate.manifest.dateRange.end)
  ));
  const runs = [];
  for (const { name, manifest } of selected) {
    const dir = path.join(exportsDir, name);
    const facility = Object.values(manifest.facilities ?? {})[0] ?? {};
    const orderRoot = path.join(dir, "facility-1", "orders");
    const orderEntries = await fs.readdir(orderRoot, { withFileTypes: true });
    const orderDirs = orderEntries.filter((entry) => entry.isDirectory()).map((entry) => path.join(orderRoot, entry.name));
    const orders = (await mapLimited(orderDirs, 64, async (orderDir) => {
      const detailFile = path.join(orderDir, "detail.json");
      if (!(await exists(detailFile))) return null;
      try { return await readJson(detailFile); } catch { return null; }
    })).filter(Boolean);

    const issueFile = path.join(exportsDir, "reporting", name, "issues.jsonl");
    const issues = (await exists(issueFile))
      ? (await fs.readFile(issueFile, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      : [];
    runs.push({ name, manifest, facility, orders, issues });
  }
  return runs;
}

const runs = await loadRuns();
const monthly = new Map();
for (const run of runs) {
  for (const order of run.orders) {
    const rawDate = order.orderDate ?? order.eventStartDateTime ?? order.createdUtc;
    if (!rawDate) continue;
    const month = String(rawDate).slice(0, 7);
    const row = monthly.get(month) ?? { month, orders: 0, orderValue: 0, payments: 0, balance: 0, cancelled: 0, closed: 0 };
    row.orders += 1;
    row.orderValue += Number(order.orderTotal ?? 0);
    row.payments += Number(order.totalPayments ?? 0);
    row.balance += Number(order.balanceDue ?? 0);
    if (order.cancelDate) row.cancelled += 1;
    if (order.dateClosed) row.closed += 1;
    monthly.set(month, row);
  }
}
const monthlyRows = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));
const allIssues = runs.flatMap((run) => run.issues.map((issue) => ({ ...issue, sourceRunId: issue.sourceRunId ?? run.name })));
const totalOrders = runs.reduce((sum, run) => sum + Number(run.facility.orders ?? 0), 0);
const subresourceFailures = runs.reduce((sum, run) => sum + Number(run.facility.orderSubresourceFailures ?? 0), 0);
const highIssues = allIssues.filter((issue) => String(issue.priority).toLowerCase() === "high").length;
const uniqueCustomers = Math.max(...runs.map((run) => Number(run.facility.customers ?? 0)));
const uniqueProducts = Math.max(...runs.map((run) => Number(run.facility.products ?? 0)));

const workbook = Workbook.create();
const dashboard = workbook.worksheets.add("Dashboard");
const coverage = workbook.worksheets.add("Coverage");
const monthlySheet = workbook.worksheets.add("Monthly Orders");
const issuesSheet = workbook.worksheets.add("Issues");
const sources = workbook.worksheets.add("Definitions");

const headerFormat = {
  fill: "#E5E7EB",
  font: { bold: true, color: "#111827" },
  borders: { preset: "all", style: "thin", color: "#D1D5DB" },
};
const titleFormat = { font: { bold: true, size: 18, color: "#111827" } };
const thinGrid = { borders: { preset: "all", style: "thin", color: "#E5E7EB" } };

dashboard.showGridLines = false;
dashboard.getRange("A1:H1").merge();
dashboard.getRange("A1").values = [[`PCS ARCHIVE — v${archiveVersion}`]];
dashboard.getRange("A1:H1").format = titleFormat;
dashboard.getRange("A2:H3").merge();
dashboard.getRange("A2").values = [["ARCHIVE COVERAGE — includes May–December 2013 and the completed 2026 year-to-date export through August 25. Calendar-year coverage remains partial; totals below are archived-data totals, not complete lifetime business totals."]];
dashboard.getRange("A2:H3").format = { fill: "#FEF3C7", font: { color: "#92400E", bold: true }, wrapText: true, borders: { preset: "outside", style: "thin", color: "#F59E0B" } };

dashboard.getRange("A5:B5").values = [["Archived orders", totalOrders]];
dashboard.getRange("D5:E5").values = [["Open issues", allIssues.length]];
dashboard.getRange("G5:H5").values = [["High priority", highIssues]];
dashboard.getRange("A7:B7").values = [["Customer snapshot", uniqueCustomers]];
dashboard.getRange("D7:E7").values = [["Product snapshot", uniqueProducts]];
dashboard.getRange("G7:H7").values = [["Subresource failures", subresourceFailures]];
for (const r of ["A5:B5", "D5:E5", "G5:H5", "A7:B7", "D7:E7", "G7:H7"]) {
  dashboard.getRange(r).format = { fill: "#F9FAFB", font: { bold: true }, borders: { preset: "outside", style: "thin", color: "#D1D5DB" } };
}
dashboard.getRange("B5:B7").format.numberFormat = "#,##0";
dashboard.getRange("E5:E7").format.numberFormat = "#,##0";
dashboard.getRange("H5:H7").format.numberFormat = "#,##0";

dashboard.getRange("A10:B13").values = [
  ["Priority", "Issue count"],
  ["High", highIssues],
  ["Medium", allIssues.filter((i) => String(i.priority).toLowerCase() === "medium").length],
  ["Low", allIssues.filter((i) => String(i.priority).toLowerCase() === "low").length],
];
dashboard.getRange("A10:B10").format = headerFormat;
dashboard.getRange("A10:B13").format.borders = thinGrid.borders;
dashboard.getRange("D10:H10").merge();
dashboard.getRange("D10").values = [["Report readiness"]];
dashboard.getRange("D10:H10").format = headerFormat;
dashboard.getRange("D11:H15").values = [
  ["Report", "Data basis", "Current state", "Next dependency", "Use now?"],
  ["Sales by Product (Cash)", "Payments + order items", "Model pending", "Payment transaction dates", "No"],
  ["Revenue by Month", "Payment transactions", "Model pending", "Payment transaction export", "No"],
  ["Sales by Hour", "Order/event timestamps", "Preliminary", "Tag configuration", "Partial"],
  ["Sales Analysis", "Orders + users + tags", "Preliminary", "User/tag mappings", "Partial"],
];
dashboard.getRange("D11:H11").format = headerFormat;
dashboard.getRange("D11:H15").format.borders = thinGrid.borders;
dashboard.getRange("D11:H15").format.wrapText = true;

const chartData = monthlyRows.map((r) => [r.month, r.orders]);
dashboard.getRange(`A17:B${17 + chartData.length}`).values = [["Month", "Orders"], ...chartData];
dashboard.getRange("A17:B17").format = headerFormat;
const ordersChart = dashboard.charts.add("line", dashboard.getRange(`A17:B${17 + chartData.length}`));
ordersChart.title = "Archived orders by month";
ordersChart.hasLegend = false;
ordersChart.xAxis = { axisType: "textAxis" };
ordersChart.yAxis = { numberFormatCode: "#,##0" };
ordersChart.setPosition("D17", "H32");
dashboard.getRange("A34:H35").merge();
dashboard.getRange("A34").values = [["Important: Order value and payments shown in this workbook come from order snapshots. They are not yet a reproduction of PCS cash-accounting reports, which require payment/refund transaction dates and allocation logic."]];
dashboard.getRange("A34:H35").format = { fill: "#F3F4F6", wrapText: true, font: { italic: true, color: "#374151" } };
dashboard.freezePanes.freezeRows(3);
dashboard.getRange("A:H").format.columnWidth = 18;
dashboard.getRange("A:A").format.columnWidth = 23;
dashboard.getRange("D:D").format.columnWidth = 26;
dashboard.getRange("F:F").format.columnWidth = 24;

const coverageRows = [];
for (let year = 2013; year <= 2026; year++) {
  const matching = runs.filter((run) => String(run.manifest.dateRange.start).startsWith(String(year)));
  const orders = matching.reduce((sum, run) => sum + Number(run.facility.orders ?? 0), 0);
  const starts = matching.map((run) => run.manifest.dateRange.start);
  const ends = matching.map((run) => run.manifest.dateRange.end);
  const fullYear = starts.includes(`${year}-01-01`) && ends.includes(`${year}-12-31`);
  const status = fullYear ? "Complete year" : matching.length ? "Partial year / export complete" : "Not collected";
  coverageRows.push([year, status, starts.join(", "), ends.join(", "), orders, matching.map((run) => run.name).join(", "), matching.length ? (fullYear ? "Complete calendar-year export" : "Completed run(s), incomplete calendar year") : "Awaiting export"]);
}
coverage.getRange("A1:G1").values = [["Year", "Coverage status", "Archived start", "Archived end", "Orders", "Source run", "Notes"]];
coverage.getRange(`A2:G${coverageRows.length + 1}`).values = coverageRows;
coverage.getRange("A1:G1").format = headerFormat;
coverage.getRange(`A1:G${coverageRows.length + 1}`).format.borders = thinGrid.borders;
coverage.getRange("A:A").format.columnWidth = 10;
coverage.getRange("B:B").format.columnWidth = 20;
coverage.getRange("C:D").format.columnWidth = 16;
coverage.getRange("E:E").format.numberFormat = "#,##0";
coverage.getRange("F:F").format.columnWidth = 24;
coverage.getRange("G:G").format.columnWidth = 34;
coverage.getRange(`B2:B${coverageRows.length + 1}`).conditionalFormats.add("containsText", { text: "Not collected", format: { fill: "#FEE2E2", font: { color: "#991B1B" } } });
coverage.getRange(`B2:B${coverageRows.length + 1}`).conditionalFormats.add("containsText", { text: "Partial", format: { fill: "#FEF3C7", font: { color: "#92400E" } } });
coverage.freezePanes.freezeRows(1);

monthlySheet.getRange("A1:G1").values = [["Month", "Orders", "Order value*", "Payments on orders*", "Balance due", "Cancelled", "Closed"]];
monthlySheet.getRange(`A2:G${monthlyRows.length + 1}`).values = monthlyRows.map((r) => [r.month, r.orders, r.orderValue, r.payments, r.balance, r.cancelled, r.closed]);
monthlySheet.getRange("A1:G1").format = headerFormat;
monthlySheet.getRange(`A1:G${monthlyRows.length + 1}`).format.borders = thinGrid.borders;
monthlySheet.getRange(`C2:E${monthlyRows.length + 1}`).format.numberFormat = "$#,##0.00";
monthlySheet.getRange(`B2:B${monthlyRows.length + 1}`).format.numberFormat = "#,##0";
monthlySheet.getRange("A:A").format.columnWidth = 14;
monthlySheet.getRange("B:G").format.columnWidth = 19;
monthlySheet.freezePanes.freezeRows(1);

const issueHeaders = ["Issue ID", "Run", "Order #", "Priority", "Issue type", "Description", "Balance due", "Order total", "Payments", "Cancel date", "Status", "Assigned to", "Resolution notes", "Resolved at", "Verified run"];
issuesSheet.getRange(`A1:O1`).values = [issueHeaders];
const issueRows = allIssues.map((i) => [i.issueId, i.sourceRunId, i.orderNumber, i.priority, i.issueType, i.description, Number(i.balanceDue ?? 0), Number(i.orderTotal ?? 0), Number(i.totalPayments ?? 0), i.cancelDate ?? "", i.status ?? "New", i.assignedTo ?? "", i.resolutionNotes ?? "", i.resolvedAt ?? "", i.verifiedRunId ?? ""]);
issuesSheet.getRange(`A2:O${issueRows.length + 1}`).values = issueRows;
issuesSheet.getRange("A1:O1").format = headerFormat;
issuesSheet.getRange(`A1:O${issueRows.length + 1}`).format.borders = thinGrid.borders;
issuesSheet.getRange(`G2:I${issueRows.length + 1}`).format.numberFormat = "$#,##0.00";
issuesSheet.getRange(`D2:D${issueRows.length + 1}`).dataValidation = { rule: { type: "list", values: ["High", "Medium", "Low"] } };
issuesSheet.getRange(`K2:K${issueRows.length + 1}`).dataValidation = { rule: { type: "list", values: ["New", "Investigating", "Corrected in PCS", "Verified", "Won't fix"] } };
issuesSheet.getRange(`D2:D${issueRows.length + 1}`).conditionalFormats.add("containsText", { text: "High", format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } } });
issuesSheet.getRange(`K2:K${issueRows.length + 1}`).conditionalFormats.add("containsText", { text: "Verified", format: { fill: "#DCFCE7", font: { color: "#166534" } } });
issuesSheet.getRange("A:B").format.columnWidth = 24;
issuesSheet.getRange("C:E").format.columnWidth = 16;
issuesSheet.getRange("F:F").format.columnWidth = 48;
issuesSheet.getRange("G:J").format.columnWidth = 16;
issuesSheet.getRange("K:O").format.columnWidth = 22;
issuesSheet.getRange(`A1:O${issueRows.length + 1}`).format.wrapText = true;
issuesSheet.freezePanes.freezeRows(1);

sources.getRange("A1:D1").values = [["Topic", "Definition / rule", "Current source", "Limitation / next step"]];
sources.getRange("A2:D10").values = [
  ["Read-only", "The exporter uses GET and approved report retrieval only.", "PCS API / authenticated report pages", "No PCS records are changed by collection."],
  ["Coverage", "A year is complete only when Jan 1–Dec 31 has a completed manifest and failures have been reviewed.", "Export manifests", "The 2026 export through August 25 is complete; the calendar year is partial."],
  ["Customers", "Latest full customer snapshot; do not sum snapshots across runs.", "API customers endpoint", "Contains PII; dashboard intentionally shows counts only."],
  ["Products", "Latest full product snapshot; do not sum snapshots across runs.", "API products endpoint", "Product reporting model is not built yet."],
  ["Order value*", "Sum of orderTotal from archived order snapshots.", "API order detail", "Not equivalent to cash-accounting sales."],
  ["Payments on orders*", "Sum of totalPayments recorded on archived order snapshots.", "API order detail", "No payment/refund transaction-date allocation yet."],
  ["Issue queue", "Cancelled orders with non-zero balance are review candidates.", "Validation output", "Fix in PCS, re-export, then mark verified."],
  ["Sales by Product", "PCS cash accounting allocates payment/refund activity with additional order-date rules.", "PCS report definition", "Needs payment transaction dates and allocation model."],
  ["Sales Analysis", "Requires order data plus user and tag mappings.", "PCS report definition", "User/tag mappings still need collection."],
];
sources.getRange("A1:D1").format = headerFormat;
sources.getRange("A1:D10").format.borders = thinGrid.borders;
sources.getRange("A:D").format.columnWidth = 28;
sources.getRange("B:B").format.columnWidth = 52;
sources.getRange("D:D").format.columnWidth = 44;
sources.getRange("A1:D10").format.wrapText = true;
sources.freezePanes.freezeRows(1);

await fs.mkdir(outputDir, { recursive: true });
for (const sheetName of ["Dashboard", "Coverage", "Monthly Orders", "Issues", "Definitions"]) {
  const preview = await workbook.render({
    sheetName,
    range: sheetName === "Issues" ? "A1:O40" : undefined,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(path.join(outputDir, `${sheetName.replaceAll(" ", "-")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const inspection = await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 8000, tableMaxRows: 6, tableMaxCols: 8 });
await fs.writeFile(path.join(outputDir, "inspection.txt"), inspection.ndjson ?? String(inspection), "utf8");
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, maxChars: 5000 });
await fs.writeFile(path.join(outputDir, "formula-errors.txt"), errors.ndjson ?? String(errors), "utf8");

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, runs: runs.length, orders: totalOrders, issues: allIssues.length, monthlyRows: monthlyRows.length }, null, 2));
