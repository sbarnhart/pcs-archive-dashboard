import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const exportsDir = path.join(root, "exports");
const outputDir = path.join(root, "dashboard-output");
const finalOutputDir = path.join(root, "outputs", "pcs-archive-dashboard");
const outputPath = path.join(finalOutputDir, "PCS Archive Dashboard.xlsx");
const archiveVersion = "1.5";
const generatedAt = new Date();
const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(generatedAt);
const currentYear = Number(todayYmd.slice(0, 4));

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
      try {
        const detail = await readJson(detailFile);
        const itemsFile = path.join(orderDir, "items.json");
        const items = (await exists(itemsFile)) ? await readJson(itemsFile) : [];
        return {
          orderNumber: detail.orderNumber,
          orderId: detail.orderId,
          id: detail.id,
          orderDate: detail.orderDate,
          eventStartDateTime: detail.eventStartDateTime,
          startDateTime: detail.startDateTime,
          createdUtc: detail.createdUtc,
          lastUpdated: detail.lastUpdated,
          cancelDate: detail.cancelDate,
          dateClosed: detail.dateClosed,
          statusCode: detail.statusCode,
          status: detail.status,
          subTotal: detail.subTotal,
          tax: detail.tax,
          tip: detail.tip,
          orderTotal: detail.orderTotal,
          totalPayments: detail.totalPayments,
          totalRefunds: detail.totalRefunds,
          balanceDue: detail.balanceDue,
          notesPrintedOnInvoice: detail.notesPrintedOnInvoice,
          notes: detail.notes,
          _archiveItemQuantity: (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
          _archiveOrderDir: orderDir,
          _archiveRun: name,
        };
      } catch { return null; }
    })).filter(Boolean);

    const issueFile = path.join(exportsDir, "reporting", name, "issues.jsonl");
    const issues = (await exists(issueFile))
      ? (await fs.readFile(issueFile, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      : [];
    runs.push({ name, manifest, facility, orders, issues });
  }
  return runs;
}

async function loadArchiveStatuses() {
  const entries = await fs.readdir(exportsDir, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(exportsDir, entry.name, "manifest.json");
    if (!(await exists(manifestFile))) continue;
    try {
      const manifest = await readJson(manifestFile);
      if (manifest.dateRange?.start) manifests.push({ name: entry.name, manifest });
    } catch {}
  }
  const statuses = [];
  for (let year = 2013; year <= 2026; year++) {
    const matching = manifests.filter(({ manifest }) => String(manifest.dateRange.start).startsWith(`${year}-`));
    matching.sort((a, b) => {
      const aFull = a.manifest.dateRange.start === `${year}-01-01` && a.manifest.dateRange.end === `${year}-12-31`;
      const bFull = b.manifest.dateRange.start === `${year}-01-01` && b.manifest.dateRange.end === `${year}-12-31`;
      return Number(bFull) - Number(aFull) || String(b.manifest.dateRange.end).localeCompare(String(a.manifest.dateRange.end));
    });
    const selected = matching[0];
    if (!selected) {
      statuses.push({ year, status: "Not started", start: "", end: "", orders: 0, run: "", updated: "", notes: "Awaiting export" });
      continue;
    }
    const { name, manifest } = selected;
    const orderRoot = path.join(exportsDir, name, "facility-1", "orders");
    let orders = 0;
    if (await exists(orderRoot)) orders = (await fs.readdir(orderRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).length;
    const complete = Boolean(manifest.completedAt);
    const fullYear = year < currentYear && manifest.dateRange.start === `${year}-01-01` && manifest.dateRange.end === `${year}-12-31`;
    const currentThroughToday = year === currentYear && complete && manifest.dateRange.start <= `${year}-01-01` && manifest.dateRange.end >= todayYmd;
    statuses.push({
      year,
      status: complete ? (fullYear ? "Complete year" : currentThroughToday ? "Current through today" : "Partial year complete") : "In progress / resumable",
      start: manifest.dateRange.start,
      end: currentThroughToday ? todayYmd : manifest.dateRange.end,
      orders,
      run: name,
      updated: manifest.completedAt ?? manifest.startedAt ?? "",
      notes: complete ? (fullYear ? "Calendar-year manifest complete" : currentThroughToday ? `Completed sweep includes all records available through ${todayYmd}` : "Completed run; calendar-year range is partial") : "Sweep can be rerun; existing files will be skipped",
    });
  }
  return statuses;
}

const runs = await loadRuns();
const archiveStatuses = await loadArchiveStatuses();
const monthly = new Map();
for (const run of runs) {
  for (const order of run.orders) {
    const rawDate = order.orderDate ?? order.eventStartDateTime ?? order.createdUtc;
    if (!rawDate) continue;
    const month = String(rawDate).slice(0, 7);
    const row = monthly.get(month) ?? { month, orders: 0, calculatedRevenue: 0, orderValue: 0, payments: 0, refunds: 0, paidRevenue: 0, pcsRevenue: null, balance: 0, cancelled: 0, closed: 0 };
    row.orders += 1;
    row.orderValue += Number(order.orderTotal ?? 0);
    row.payments += Number(order.totalPayments ?? 0);
    row.refunds += Number(order.totalRefunds ?? 0);
    row.paidRevenue += Number(order.totalPayments ?? 0) - Number(order.totalRefunds ?? 0);
    row.balance += Number(order.balanceDue ?? 0);
    if (!order.cancelDate) row.calculatedRevenue += Math.max(0, Number(order.orderTotal ?? 0) - Number(order.balanceDue ?? 0));
    if (order.cancelDate) row.cancelled += 1;
    if (order.dateClosed) row.closed += 1;
    monthly.set(month, row);
  }
}
const revenueReportFile = path.join(exportsDir, "reporting", "revenue-by-month.json");
if (await exists(revenueReportFile)) {
  const revenueReport = await readJson(revenueReportFile);
  for (const item of revenueReport.months ?? []) {
    const row = monthly.get(item.month) ?? { month: item.month, orders: null, calculatedRevenue: null, orderValue: null, payments: null, refunds: null, paidRevenue: null, pcsRevenue: null, balance: null, cancelled: null, closed: null };
    row.pcsRevenue = Number(item.revenue ?? 0);
    monthly.set(item.month, row);
  }
}
const monthlyRows = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));
const hourly = new Map();
for (const run of runs) {
  for (const order of run.orders) {
    if (order.cancelDate) continue;
    const rawTimestamp = order.createdUtc ?? order.orderDate ?? order.lastUpdated ?? order.eventStartDateTime;
    const match = String(rawTimestamp ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2})/);
    if (!match) continue;
    const [, day, hourText] = match;
    const hour = Number(hourText);
    const key = `${day}|${hour}`;
    const row = hourly.get(key) ?? { day, hour, orders: 0, itemQuantity: 0, paidValue: 0, orderValue: 0 };
    row.orders += 1;
    row.itemQuantity += Number(order._archiveItemQuantity ?? 0);
    row.paidValue += Math.max(0, Number(order.totalPayments ?? 0) - Number(order.totalRefunds ?? 0));
    row.orderValue += Math.max(0, Number(order.orderTotal ?? 0) - Number(order.balanceDue ?? 0));
    hourly.set(key, row);
  }
}
const hourlyRows = [...hourly.values()].sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour);
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
const invoice = workbook.worksheets.add("Invoice Lookup");
const orderData = workbook.worksheets.add("Order Data");
const hourlyAnalysis = workbook.worksheets.add("Hourly Date Range");
const weekCompare = workbook.worksheets.add("Week Over Year");
const hourlyData = workbook.worksheets.add("Hourly Data");

const headerFormat = {
  fill: "#E5E7EB",
  font: { bold: true, color: "#111827" },
  borders: { preset: "all", style: "thin", color: "#D1D5DB" },
};
const titleFormat = { font: { bold: true, size: 18, color: "#111827" } };
const thinGrid = { borders: { preset: "all", style: "thin", color: "#E5E7EB" } };

dashboard.showGridLines = false;
dashboard.getRange("A1:K1").merge();
dashboard.getRange("A1").values = [[`PCS ARCHIVE — v${archiveVersion}`]];
dashboard.getRange("A1:K1").format = titleFormat;
dashboard.getRange("A2:K3").merge();
dashboard.getRange("A2").values = [[`ARCHIVE STATUS — refreshed ${generatedAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}. The completed 2026 sweep includes all records available through today, ${todayYmd}.`]];
dashboard.getRange("A2:K3").format = { fill: "#FEF3C7", font: { color: "#92400E", bold: true }, wrapText: true, borders: { preset: "outside", style: "thin", color: "#F59E0B" } };

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
  ["Revenue by Month", "PCS payment report", "Authoritative", "Refresh report after new period", "Yes"],
  ["Sales by Hour", "Order/event timestamps", "Preliminary", "Tag configuration", "Partial"],
  ["Sales Analysis", "Orders + users + tags", "Preliminary", "User/tag mappings", "Partial"],
];
dashboard.getRange("D11:H11").format = headerFormat;
dashboard.getRange("D11:H15").format.borders = thinGrid.borders;
dashboard.getRange("D11:H15").format.wrapText = true;

const chartData = monthlyRows.map((r) => [r.month, r.orders, r.calculatedRevenue, r.pcsRevenue]);
dashboard.getRange(`A17:D${17 + chartData.length}`).values = [["Month", "Orders", "Calculated revenue*", "PCS revenue"], ...chartData];
dashboard.getRange("E17:F17").values = [["Difference", "Variance %"]];
dashboard.getRange("A17:F17").format = headerFormat;
dashboard.getRange(`B18:B${17 + chartData.length}`).format.numberFormat = "#,##0";
dashboard.getRange(`C18:E${17 + chartData.length}`).format.numberFormat = "$#,##0.00";
dashboard.getRange(`F18:F${17 + chartData.length}`).format.numberFormat = "0.0%";
dashboard.getRange("E18").formulas = [["=IF(COUNT(C18:D18)<2,\"\",C18-D18)"]];
dashboard.getRange(`E18:E${17 + chartData.length}`).fillDown();
dashboard.getRange("F18").formulas = [["=IF(COUNT(C18:D18)<2,\"\",IFERROR((C18-D18)/D18,\"\"))"]];
dashboard.getRange(`F18:F${17 + chartData.length}`).fillDown();
const ordersChart = dashboard.charts.add("line", dashboard.getRange(`A17:B${17 + chartData.length}`));
ordersChart.title = "Archived orders by month";
ordersChart.hasLegend = false;
ordersChart.xAxis = { axisType: "textAxis" };
ordersChart.yAxis = { numberFormatCode: "#,##0" };
ordersChart.setPosition("G17", "K32");
const revenueChart = dashboard.charts.add("line", { chartType: "line", title: "Calculated revenue vs PCS", hasLegend: true });
const calculatedSeries = revenueChart.series.add("Calculated revenue*");
calculatedSeries.categoryFormula = `'Dashboard'!$A$18:$A$${17 + chartData.length}`;
calculatedSeries.formula = `'Dashboard'!$C$18:$C$${17 + chartData.length}`;
const pcsSeries = revenueChart.series.add("PCS revenue");
pcsSeries.categoryFormula = `'Dashboard'!$A$18:$A$${17 + chartData.length}`;
pcsSeries.formula = `'Dashboard'!$D$18:$D$${17 + chartData.length}`;
revenueChart.title = "Calculated revenue vs PCS";
revenueChart.hasLegend = true;
revenueChart.xAxis = { axisType: "textAxis" };
revenueChart.yAxis = { numberFormatCode: "$#,##0" };
revenueChart.setPosition("G34", "K49");
const dashboardNoteRow = 19 + chartData.length;
dashboard.getRange(`A${dashboardNoteRow}:K${dashboardNoteRow + 1}`).merge();
dashboard.getRange(`A${dashboardNoteRow}`).values = [["Calculated revenue is the non-cancelled archived order total less balance due, clamped at $0 per order. PCS revenue is retained beside it for validation. Before February 2019, calculated revenue is the historical estimate because PCS transaction data is unavailable."]];
dashboard.getRange(`A${dashboardNoteRow}:K${dashboardNoteRow + 1}`).format = { fill: "#F3F4F6", wrapText: true, font: { italic: true, color: "#374151" } };
dashboard.freezePanes.freezeRows(3);
dashboard.getRange("A:K").format.columnWidth = 18;
dashboard.getRange("A:A").format.columnWidth = 23;
dashboard.getRange("D:D").format.columnWidth = 26;
dashboard.getRange("F:F").format.columnWidth = 24;

const coverageRows = archiveStatuses.map((s) => [s.year, s.status, s.start, s.end, s.orders, s.run, s.updated ? new Date(s.updated) : "", s.notes]);
coverage.getRange("A1:H1").values = [["Year", "Coverage status", "Requested start", "Requested end", "Orders on disk", "Source run", "Last manifest update", "Notes"]];
coverage.getRange(`A2:H${coverageRows.length + 1}`).values = coverageRows;
coverage.getRange("A1:H1").format = headerFormat;
coverage.getRange(`A1:H${coverageRows.length + 1}`).format.borders = thinGrid.borders;
coverage.getRange("A:A").format.columnWidth = 10;
coverage.getRange("B:B").format.columnWidth = 20;
coverage.getRange("C:D").format.columnWidth = 16;
coverage.getRange("E:E").format.numberFormat = "#,##0";
coverage.getRange("F:F").format.columnWidth = 24;
coverage.getRange("G:G").format.columnWidth = 24;
coverage.getRange(`G2:G${coverageRows.length + 1}`).format.numberFormat = "yyyy-mm-dd hh:mm";
coverage.getRange("H:H").format.columnWidth = 42;
coverage.getRange(`B2:B${coverageRows.length + 1}`).conditionalFormats.add("containsText", { text: "Not started", format: { fill: "#FEE2E2", font: { color: "#991B1B" } } });
coverage.getRange(`B2:B${coverageRows.length + 1}`).conditionalFormats.add("containsText", { text: "Partial", format: { fill: "#FEF3C7", font: { color: "#92400E" } } });
coverage.getRange(`B2:B${coverageRows.length + 1}`).conditionalFormats.add("containsText", { text: "In progress", format: { fill: "#DBEAFE", font: { color: "#1E40AF", bold: true } } });
coverage.freezePanes.freezeRows(1);

monthlySheet.getRange("A1:M1").values = [["Month", "Orders", "Calculated revenue*", "PCS revenue", "Difference", "Variance %", "Archived net payments*", "Archived payments*", "Archived refunds*", "Order value*", "Balance due", "Cancelled", "Closed"]];
monthlySheet.getRange(`A2:M${monthlyRows.length + 1}`).values = monthlyRows.map((r) => [r.month, r.orders, r.calculatedRevenue, r.pcsRevenue, null, null, r.paidRevenue, r.payments, r.refunds, r.orderValue, r.balance, r.cancelled, r.closed]);
monthlySheet.getRange("E2").formulas = [["=IF(COUNT(C2:D2)<2,\"\",C2-D2)"]];
monthlySheet.getRange(`E2:E${monthlyRows.length + 1}`).fillDown();
monthlySheet.getRange("F2").formulas = [["=IF(COUNT(C2:D2)<2,\"\",IFERROR((C2-D2)/D2,\"\"))"]];
monthlySheet.getRange(`F2:F${monthlyRows.length + 1}`).fillDown();
monthlySheet.getRange("A1:M1").format = headerFormat;
monthlySheet.getRange(`A1:M${monthlyRows.length + 1}`).format.borders = thinGrid.borders;
monthlySheet.getRange(`C2:E${monthlyRows.length + 1}`).format.numberFormat = "$#,##0.00";
monthlySheet.getRange(`F2:F${monthlyRows.length + 1}`).format.numberFormat = "0.0%";
monthlySheet.getRange(`G2:K${monthlyRows.length + 1}`).format.numberFormat = "$#,##0.00";
monthlySheet.getRange(`B2:B${monthlyRows.length + 1}`).format.numberFormat = "#,##0";
monthlySheet.getRange("A:A").format.columnWidth = 14;
monthlySheet.getRange("B:M").format.columnWidth = 19;
monthlySheet.freezePanes.freezeRows(1);

const issueHeaders = ["Issue ID", "Run", "Order #", "Priority", "Issue type", "Description", "Balance due", "Order total", "Payments", "Cancel date", "Status", "Assigned to", "Resolution notes", "Resolved at", "Verified run"];
issuesSheet.getRange(`A1:O1`).values = [issueHeaders];
const issueRows = allIssues.map((i) => [i.issueId, i.sourceRunId, i.orderNumber, i.priority, i.issueType, i.description, Number(i.balanceDue ?? 0), Number(i.orderTotal ?? 0), Number(i.totalPayments ?? 0), i.cancelDate ?? "", i.status ?? "New", i.assignedTo ?? "", i.resolutionNotes ?? "", i.resolvedAt ?? "", i.verifiedRunId ?? ""]);
issuesSheet.getRange("A1:O1").format = headerFormat;
if (issueRows.length) {
  const issueLastRow = issueRows.length + 1;
  issuesSheet.getRange(`A2:O${issueLastRow}`).values = issueRows;
  issuesSheet.getRange(`A1:O${issueLastRow}`).format.borders = thinGrid.borders;
  issuesSheet.getRange(`G2:I${issueLastRow}`).format.numberFormat = "$#,##0.00";
  issuesSheet.getRange(`D2:D${issueLastRow}`).dataValidation = { rule: { type: "list", values: ["High", "Medium", "Low"] } };
  issuesSheet.getRange(`K2:K${issueLastRow}`).dataValidation = { rule: { type: "list", values: ["New", "Investigating", "Corrected in PCS", "Verified", "Won't fix"] } };
  issuesSheet.getRange(`D2:D${issueLastRow}`).conditionalFormats.add("containsText", { text: "High", format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } } });
  issuesSheet.getRange(`K2:K${issueLastRow}`).conditionalFormats.add("containsText", { text: "Verified", format: { fill: "#DCFCE7", font: { color: "#166534" } } });
}
issuesSheet.getRange("A:B").format.columnWidth = 24;
issuesSheet.getRange("C:E").format.columnWidth = 16;
issuesSheet.getRange("F:F").format.columnWidth = 48;
issuesSheet.getRange("G:J").format.columnWidth = 16;
issuesSheet.getRange("K:O").format.columnWidth = 22;
issuesSheet.getRange(`A1:O${issueRows.length + 1}`).format.wrapText = true;
issuesSheet.freezePanes.freezeRows(1);

sources.getRange("A1:D1").values = [["Topic", "Definition / rule", "Current source", "Limitation / next step"]];
sources.getRange("A2:D13").values = [
  ["Read-only", "The exporter uses GET and approved report retrieval only.", "PCS API / authenticated report pages", "No PCS records are changed by collection."],
  ["Coverage", "Past years are complete only when Jan 1–Dec 31 has a completed manifest and failures have been reviewed.", "Export manifests", `The 2026 sweep is current through ${todayYmd}; the calendar year remains in progress.`],
  ["Customers", "Latest full customer snapshot; do not sum snapshots across runs.", "API customers endpoint", "Contains PII; dashboard intentionally shows counts only."],
  ["Products", "Latest full product snapshot; do not sum snapshots across runs.", "API products endpoint", "Product reporting model is not built yet."],
  ["Order value*", "Sum of orderTotal from archived order snapshots.", "API order detail", "Not equivalent to cash-accounting sales."],
  ["Calculated revenue*", "For each non-cancelled order: max(0, orderTotal minus balanceDue), grouped by order month.", "API order detail", "Historical estimate; validated against PCS where PCS data exists."],
  ["PCS revenue", "Total payments taken month over month.", "PCS Revenue By Month report", "Current report runs through August 27, 2026."],
  ["Archived net payments*", "Payments less refunds recorded on archived order snapshots; unpaid orders contribute $0.", "API order detail", "Grouped by order month; diagnostic only, not PCS revenue."],
  ["Payments on orders*", "Sum of totalPayments recorded on archived order snapshots.", "API order detail", "No payment/refund transaction-date allocation yet."],
  ["Issue queue", "Cancelled orders with non-zero balance are review candidates.", "Validation output", "Fix in PCS, re-export, then mark verified."],
  ["Sales by Product", "PCS cash accounting allocates payment/refund activity with additional order-date rules.", "PCS report definition", "Needs payment transaction dates and allocation model."],
  ["Sales Analysis", "Requires order data plus user and tag mappings.", "PCS report definition", "User/tag mappings still need collection."],
];
sources.getRange("A1:D1").format = headerFormat;
sources.getRange("A1:D13").format.borders = thinGrid.borders;
sources.getRange("A:D").format.columnWidth = 28;
sources.getRange("B:B").format.columnWidth = 52;
sources.getRange("D:D").format.columnWidth = 44;
sources.getRange("A1:D13").format.wrapText = true;
sources.freezePanes.freezeRows(1);

const invoiceIndexLimit = 20000;
const invoiceCandidates = runs.flatMap((run) => run.orders)
  .filter((order) => order.orderNumber != null)
  .sort((a, b) => Number(a.orderNumber) - Number(b.orderNumber))
  .slice(-invoiceIndexLimit);
const archivedOrders = await mapLimited(invoiceCandidates, 64, async (order) => {
  const itemsFile = path.join(order._archiveOrderDir, "items.json");
  const customerFile = path.join(order._archiveOrderDir, "customer.json");
  const partyFile = path.join(order._archiveOrderDir, "party.json");
  return {
    ...order,
    _archiveItems: (await exists(itemsFile)) ? await readJson(itemsFile) : [],
    _archiveCustomer: (await exists(customerFile)) ? await readJson(customerFile) : null,
    _archiveParty: (await exists(partyFile)) ? await readJson(partyFile) : null,
  };
});
const orderRows = archivedOrders
  .filter((order) => order.orderNumber != null)
  .sort((a, b) => Number(a.orderNumber) - Number(b.orderNumber))
  .map((order) => {
    const customer = order._archiveCustomer ?? {};
    const party = order._archiveParty ?? {};
    const address = [customer.address1, customer.address2, customer.city, customer.state, customer.zip].filter(Boolean).join(", ");
    const lineSummary = (Array.isArray(order._archiveItems) ? order._archiveItems : []).map((item, index) => {
      const qty = Number(item.quantity ?? 0);
      const unit = Number(item.listPrice ?? item.price ?? 0);
      const discount = Number(item.discount ?? 0);
      const tax = Number(item.tax ?? 0);
      const archivedExtended = Number(item.priceExtended ?? item.listPriceExtended ?? 0);
      const extended = archivedExtended || (qty * unit - discount + tax);
      return `${index + 1}. ${qty} × ${item.productName ?? item.name ?? "Item"} | ${item.category ?? "Uncategorized"} | Unit $${unit.toFixed(2)} | Discount $${discount.toFixed(2)} | Tax $${tax.toFixed(2)} | Extended $${extended.toFixed(2)}`;
    }).join("\n");
    return [
      Number(order.orderNumber), Number(order.orderId ?? order.id ?? 0), order.orderDate ?? "",
      customer.fullName ?? customer.name ?? "", address, customer.email ?? "", customer.phoneNumber ?? "",
      order.eventStartDateTime ?? order.startDateTime ?? party.startDateTime ?? "", String(order.statusCode ?? order.status ?? ""),
      Number(order.subTotal ?? 0), Number(order.tax ?? 0), Number(order.tip ?? 0), Number(order.orderTotal ?? 0),
      Number(order.totalPayments ?? 0), Number(order.totalRefunds ?? 0), Number(order.balanceDue ?? 0),
      order.notesPrintedOnInvoice ? (order.notes ?? "") : "", order._archiveRun ?? "", lineSummary,
    ];
  });

const orderHeaders = ["Order Number", "Order ID", "Order Date", "Customer", "Address", "Email", "Phone", "Event Start", "Status Code", "Subtotal", "Tax", "Tip", "Order Total", "Payments", "Refunds", "Balance Due", "Invoice Notes", "Archive Run", "Archived Line Items"];
orderData.getRange("A1:S1").values = [orderHeaders];
if (orderRows.length) orderData.getRange(`A2:S${orderRows.length + 1}`).values = orderRows;
orderData.getRange("A1:S1").format = headerFormat;
orderData.getRange(`J2:P${Math.max(orderRows.length + 1, 2)}`).format.numberFormat = "$#,##0.00";
orderData.getRange("A:B").format.numberFormat = "0";
orderData.getRange("A:S").format.columnWidth = 16;
orderData.getRange("D:E").format.columnWidth = 28;
orderData.getRange("Q:S").format.columnWidth = 28;
orderData.freezePanes.freezeRows(1);

const orderLastRow = Math.max(orderRows.length + 1, 2);
const defaultOrderNumber = orderRows.at(-1)?.[0] ?? "";
const lookup = (column, fallback = "") => `=IFERROR(INDEX('Order Data'!$${column}$2:$${column}$${orderLastRow},MATCH($B$3,'Order Data'!$A$2:$A$${orderLastRow},0)),"${fallback}")`;
invoice.showGridLines = false;
invoice.getRange("A1:H1").merge();
invoice.getRange("A1").values = [["PCS ARCHIVE — REBUILT INVOICE"]];
invoice.getRange("A1:H1").format = { fill: "#111827", font: { bold: true, color: "#FFFFFF", size: 18 }, horizontalAlignment: "center" };
invoice.getRange("A3").values = [["Enter order number"]];
invoice.getRange("B3").values = [[defaultOrderNumber]];
invoice.getRange("A3:B3").format = { fill: "#DBEAFE", font: { bold: true, color: "#1E3A8A" }, borders: { preset: "outside", style: "medium", color: "#2563EB" } };
invoice.getRange("B3").format.numberFormat = "0";
invoice.getRange("D3").values = [["Order date"]];
invoice.getRange("E3").formulas = [[lookup("C", "Order not found")]];
invoice.getRange("G3").values = [["Order ID"]];
invoice.getRange("H3").formulas = [[lookup("B")]];
invoice.getRange("A5").values = [["Bill to"]];
invoice.getRange("B5:D5").merge();
invoice.getRange("B5").formulas = [[lookup("D", "Order not found")]];
invoice.getRange("A6").values = [["Address"]];
invoice.getRange("B6:D6").merge();
invoice.getRange("B6").formulas = [[lookup("E")]];
invoice.getRange("A7").values = [["Email"]];
invoice.getRange("B7:D7").merge();
invoice.getRange("B7").formulas = [[lookup("F")]];
invoice.getRange("A8").values = [["Phone"]];
invoice.getRange("B8:D8").merge();
invoice.getRange("B8").formulas = [[lookup("G")]];
invoice.getRange("F5").values = [["Event start"]];
invoice.getRange("G5:H5").merge();
invoice.getRange("G5").formulas = [[lookup("H")]];
invoice.getRange("F6").values = [["Status code"]];
invoice.getRange("G6:H6").merge();
invoice.getRange("G6").formulas = [[lookup("I")]];
invoice.getRange("A10:H10").values = [["Line", "Description", "Category", "Qty", "Unit price", "Discount", "Tax", "Extended"]];
invoice.getRange("A10:H10").format = headerFormat;
invoice.getRange("A11:H60").merge();
invoice.getRange("A11").formulas = [[lookup("S", "No archived line items")]];
invoice.getRange("A11:H60").format = { wrapText: true, verticalAlignment: "top", borders: { preset: "outside", style: "thin", color: "#D1D5DB" } };
invoice.getRange("F63").values = [["Subtotal"]]; invoice.getRange("H63").formulas = [[lookup("J")]];
invoice.getRange("F64").values = [["Tax"]]; invoice.getRange("H64").formulas = [[lookup("K")]];
invoice.getRange("F65").values = [["Tip"]]; invoice.getRange("H65").formulas = [[lookup("L")]];
invoice.getRange("F66").values = [["Order total"]]; invoice.getRange("H66").formulas = [[lookup("M")]];
invoice.getRange("F67").values = [["Payments"]]; invoice.getRange("H67").formulas = [[lookup("N")]];
invoice.getRange("F68").values = [["Refunds"]]; invoice.getRange("H68").formulas = [[lookup("O")]];
invoice.getRange("F69").values = [["Balance due"]]; invoice.getRange("H69").formulas = [[lookup("P")]];
invoice.getRange("F63:H69").format = { borders: { preset: "all", style: "thin", color: "#D1D5DB" }, font: { bold: true } };
invoice.getRange("H63:H69").format.numberFormat = "$#,##0.00";
invoice.getRange("A63").values = [["Invoice notes"]];
invoice.getRange("A64:E69").merge();
invoice.getRange("A64").formulas = [[lookup("Q")]];
invoice.getRange("A64:E69").format = { wrapText: true, fill: "#F9FAFB", borders: { preset: "outside", style: "thin", color: "#D1D5DB" } };
invoice.getRange("A71:H72").merge();
invoice.getRange("A71").values = [[`This invoice is reconstructed from archived PCS API fields. The archived order total is authoritative; line-item extensions are reconstructed when PCS did not return an extended amount. For workbook performance, lookup currently indexes the newest ${invoiceIndexLimit.toLocaleString("en-US")} archived order numbers.`]];
invoice.getRange("A71:H72").format = { fill: "#FEF3C7", font: { italic: true, color: "#92400E" }, wrapText: true, borders: { preset: "outside", style: "thin", color: "#F59E0B" } };
invoice.getRange("A:A").format.columnWidth = 18;
invoice.getRange("B:B").format.columnWidth = 24;
invoice.getRange("C:C").format.columnWidth = 22;
invoice.getRange("D:D").format.columnWidth = 10;
invoice.getRange("E:H").format.columnWidth = 15;
invoice.freezePanes.freezeRows(3);

const hourlyLastRow = Math.max(hourlyRows.length + 1, 2);
hourlyData.getRange("A1:F1").values = [["Date", "Hour", "Orders", "Item quantity", "Paid value*", "Order value*"]];
if (hourlyRows.length) {
  hourlyData.getRange(`A2:F${hourlyRows.length + 1}`).values = hourlyRows.map((row) => [
    new Date(`${row.day}T00:00:00`), row.hour, row.orders, row.itemQuantity, row.paidValue, row.orderValue,
  ]);
}
hourlyData.getRange("A1:F1").format = headerFormat;
hourlyData.getRange(`A2:A${hourlyLastRow}`).format.numberFormat = "yyyy-mm-dd";
hourlyData.getRange(`B2:D${hourlyLastRow}`).format.numberFormat = "#,##0";
hourlyData.getRange(`E2:F${hourlyLastRow}`).format.numberFormat = "$#,##0.00";
hourlyData.getRange("A:F").format.columnWidth = 16;
hourlyData.freezePanes.freezeRows(1);

hourlyAnalysis.showGridLines = false;
hourlyAnalysis.getRange("A1:J1").merge();
hourlyAnalysis.getRange("A1").values = [["HOURLY SALES - DATE RANGE"]];
hourlyAnalysis.getRange("A1:J1").format = { fill: "#111827", font: { bold: true, color: "#FFFFFF", size: 18 }, horizontalAlignment: "center" };
hourlyAnalysis.getRange("A3").values = [["Start date"]];
hourlyAnalysis.getRange("B3").values = [[new Date("2026-08-03T00:00:00")]];
hourlyAnalysis.getRange("C3").values = [["End date"]];
hourlyAnalysis.getRange("D3").values = [[new Date("2026-08-09T00:00:00")]];
hourlyAnalysis.getRange("E3").values = [["Sales metric"]];
hourlyAnalysis.getRange("F3").values = [["Paid value"]];
hourlyAnalysis.getRange("F3").dataValidation = { rule: { type: "list", values: ["Paid value", "Order value"] } };
hourlyAnalysis.getRange("A3:F3").format = { fill: "#DBEAFE", font: { bold: true, color: "#1E3A8A" }, borders: { preset: "outside", style: "thin", color: "#2563EB" } };
hourlyAnalysis.getRange("B3:D3").format.numberFormat = "yyyy-mm-dd";
hourlyAnalysis.getRange("A5:E5").values = [["Hour", "Orders", "Item quantity", "Sales", "Average / order"]];
hourlyAnalysis.getRange("A5:E5").format = headerFormat;
const hourlySummaryRows = Array.from({ length: 24 }, (_, hour) => [hour, null, null, null, null]);
hourlyAnalysis.getRange("A6:E29").values = hourlySummaryRows;
for (let row = 6; row <= 29; row++) {
  hourlyAnalysis.getRange(`B${row}`).formulas = [[`=SUMIFS('Hourly Data'!$C$2:$C$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},">="&$B$3,'Hourly Data'!$A$2:$A$${hourlyLastRow},"<="&$D$3,'Hourly Data'!$B$2:$B$${hourlyLastRow},$A${row})`]];
  hourlyAnalysis.getRange(`C${row}`).formulas = [[`=SUMIFS('Hourly Data'!$D$2:$D$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},">="&$B$3,'Hourly Data'!$A$2:$A$${hourlyLastRow},"<="&$D$3,'Hourly Data'!$B$2:$B$${hourlyLastRow},$A${row})`]];
  hourlyAnalysis.getRange(`D${row}`).formulas = [[`=IF($F$3="Paid value",SUMIFS('Hourly Data'!$E$2:$E$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},">="&$B$3,'Hourly Data'!$A$2:$A$${hourlyLastRow},"<="&$D$3,'Hourly Data'!$B$2:$B$${hourlyLastRow},$A${row}),SUMIFS('Hourly Data'!$F$2:$F$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},">="&$B$3,'Hourly Data'!$A$2:$A$${hourlyLastRow},"<="&$D$3,'Hourly Data'!$B$2:$B$${hourlyLastRow},$A${row}))`]];
  hourlyAnalysis.getRange(`E${row}`).formulas = [[`=IFERROR(D${row}/B${row},0)`]];
}
hourlyAnalysis.getRange("A6:A29").format.numberFormat = "00\:00";
hourlyAnalysis.getRange("B6:C29").format.numberFormat = "#,##0";
hourlyAnalysis.getRange("D6:E29").format.numberFormat = "$#,##0.00";
hourlyAnalysis.getRange("A5:E29").format.borders = thinGrid.borders;
const hourlyChart = hourlyAnalysis.charts.add("line", { chartType: "line", title: "Sales by hour", hasLegend: false });
const hourlySeries = hourlyChart.series.add("Sales");
hourlySeries.categoryFormula = `'Hourly Date Range'!$A$6:$A$29`;
hourlySeries.formula = `'Hourly Date Range'!$D$6:$D$29`;
hourlyChart.yAxis = { numberFormatCode: "$#,##0" };
hourlyChart.xAxis = { axisType: "textAxis" };
hourlyChart.setPosition("G5", "N19");
hourlyAnalysis.getRange("A32:Y32").merge();
hourlyAnalysis.getRange("A32").values = [["DAY-BY-DAY / HOUR-BY-HOUR SALES (first 21 days of selected range)"]];
hourlyAnalysis.getRange("A32:Y32").format = headerFormat;
hourlyAnalysis.getRange("A33:Y33").values = [["Date", ...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`)]];
hourlyAnalysis.getRange("A33:Y33").format = headerFormat;
hourlyAnalysis.getRange("A34").formulas = [["=$B$3"]];
for (let row = 35; row <= 54; row++) hourlyAnalysis.getRange(`A${row}`).formulas = [[`=IF(A${row - 1}+1<=$D$3,A${row - 1}+1,"")`]];
for (let row = 34; row <= 54; row++) {
  for (let col = 0; col < 24; col++) {
    const column = String.fromCharCode(66 + col);
    hourlyAnalysis.getRange(`${column}${row}`).formulas = [[`=IF($A${row}="","",IF($F$3="Paid value",SUMIFS('Hourly Data'!$E$2:$E$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},$A${row},'Hourly Data'!$B$2:$B$${hourlyLastRow},${col}),SUMIFS('Hourly Data'!$F$2:$F$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},$A${row},'Hourly Data'!$B$2:$B$${hourlyLastRow},${col})))`]];
  }
}
hourlyAnalysis.getRange("A34:A54").format.numberFormat = "yyyy-mm-dd";
hourlyAnalysis.getRange("B34:Y54").format.numberFormat = "$#,##0";
hourlyAnalysis.getRange("B34:Y54").conditionalFormats.add("colorScale", { colors: ["#FFFFFF", "#BFDBFE", "#1D4ED8"], thresholds: ["min", "50%", "max"] });
hourlyAnalysis.getRange("A33:Y54").format.borders = thinGrid.borders;
hourlyAnalysis.getRange("A55:Y56").merge();
hourlyAnalysis.getRange("A55").values = [["Preliminary archive analysis. PCS Sales By Hour uses item-level transaction timestamps, tag membership, quantity, and discounts. Those fields are not yet fully available in the archive. Paid value = archived payments less refunds; Order value = non-cancelled order total less balance due."]];
hourlyAnalysis.getRange("A55:Y56").format = { fill: "#FEF3C7", font: { italic: true, color: "#92400E" }, wrapText: true, borders: { preset: "outside", style: "thin", color: "#F59E0B" } };
hourlyAnalysis.getRange("A:A").format.columnWidth = 14;
hourlyAnalysis.getRange("B:Y").format.columnWidth = 11;
hourlyAnalysis.freezePanes.freezeRows(3);

weekCompare.showGridLines = false;
weekCompare.getRange("A1:K1").merge();
weekCompare.getRange("A1").values = [["WEEK-OVER-YEAR SALES COMPARISON"]];
weekCompare.getRange("A1:K1").format = { fill: "#111827", font: { bold: true, color: "#FFFFFF", size: 18 }, horizontalAlignment: "center" };
weekCompare.getRange("A3").values = [["Reference week start"]];
weekCompare.getRange("B3").values = [[new Date("2026-08-03T00:00:00")]];
weekCompare.getRange("D3").values = [["Sales metric"]];
weekCompare.getRange("E3").values = [["Paid value"]];
weekCompare.getRange("E3").dataValidation = { rule: { type: "list", values: ["Paid value", "Order value"] } };
weekCompare.getRange("A4").values = [["Weekday alignment"]];
weekCompare.getRange("B4").values = [[364]];
weekCompare.getRange("C4:E4").merge();
weekCompare.getRange("C4").values = [["days back per comparison year (52 weeks)"]];
weekCompare.getRange("A3:E4").format = { fill: "#DBEAFE", font: { bold: true, color: "#1E3A8A" }, borders: { preset: "outside", style: "thin", color: "#2563EB" } };
weekCompare.getRange("B3").format.numberFormat = "yyyy-mm-dd";
weekCompare.getRange("A6:L6").values = [["Year", "Week start", "Week end", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Week sales", "Orders"]];
weekCompare.getRange("A6:L6").format = headerFormat;
for (let row = 7; row <= 16; row++) {
  const offset = row - 7;
  weekCompare.getRange(`B${row}`).formulas = [[offset === 0 ? "=$B$3" : `=$B$3-$B$4*${offset}`]];
  weekCompare.getRange(`A${row}`).formulas = [[`=YEAR(B${row})`]];
  weekCompare.getRange(`C${row}`).formulas = [[`=B${row}+6`]];
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const column = String.fromCharCode(68 + dayOffset);
    weekCompare.getRange(`${column}${row}`).formulas = [[`=IF($E$3="Paid value",SUMIFS('Hourly Data'!$E$2:$E$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},$B${row}+${dayOffset}),SUMIFS('Hourly Data'!$F$2:$F$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},$B${row}+${dayOffset}))`]];
  }
  weekCompare.getRange(`K${row}`).formulas = [[`=SUM(D${row}:J${row})`]];
  weekCompare.getRange(`L${row}`).formulas = [[`=SUMIFS('Hourly Data'!$C$2:$C$${hourlyLastRow},'Hourly Data'!$A$2:$A$${hourlyLastRow},">="&B${row},'Hourly Data'!$A$2:$A$${hourlyLastRow},"<="&C${row})`]];
}
weekCompare.getRange("B7:C16").format.numberFormat = "yyyy-mm-dd";
weekCompare.getRange("D7:K16").format.numberFormat = "$#,##0";
weekCompare.getRange("L7:L16").format.numberFormat = "#,##0";
weekCompare.getRange("A6:L16").format.borders = thinGrid.borders;
weekCompare.getRange("D7:J16").conditionalFormats.add("colorScale", { colors: ["#FFFFFF", "#BFDBFE", "#1D4ED8"], thresholds: ["min", "50%", "max"] });
const weekChart = weekCompare.charts.add("line", { chartType: "line", title: "Aligned week sales by year", hasLegend: false });
const weekSeries = weekChart.series.add("Week sales");
weekSeries.categoryFormula = `'Week Over Year'!$A$7:$A$16`;
weekSeries.formula = `'Week Over Year'!$K$7:$K$16`;
weekChart.yAxis = { numberFormatCode: "$#,##0" };
weekChart.xAxis = { axisType: "textAxis" };
weekChart.setPosition("A19", "H34");
weekCompare.getRange("I19:L27").merge();
weekCompare.getRange("I19").values = [["How to use\n\nChoose the Monday of the holiday/event week in B3. Prior rows step back exactly 52 weeks, preserving Monday-Sunday alignment. For holidays whose timing shifts differently, overwrite a Week start cell with the exact comparison Monday you want."]];
weekCompare.getRange("I19:L27").format = { fill: "#F3F4F6", wrapText: true, verticalAlignment: "top", borders: { preset: "outside", style: "thin", color: "#D1D5DB" } };
weekCompare.getRange("A36:L37").merge();
weekCompare.getRange("A36").values = [["Preliminary archive analysis using the same metric definitions as Hourly Date Range. It is intended for operational comparisons, not exact reconciliation to PCS Sales By Hour until transaction timestamps and tag configuration are archived."]];
weekCompare.getRange("A36:L37").format = { fill: "#FEF3C7", font: { italic: true, color: "#92400E" }, wrapText: true, borders: { preset: "outside", style: "thin", color: "#F59E0B" } };
weekCompare.getRange("A:A").format.columnWidth = 12;
weekCompare.getRange("B:C").format.columnWidth = 15;
weekCompare.getRange("D:J").format.columnWidth = 13;
weekCompare.getRange("K:L").format.columnWidth = 16;
weekCompare.freezePanes.freezeRows(4);

sources.getRange("A14:D14").values = [["Sales By Hour", "Seven-day PCS report with hours as rows and each day showing transaction quantity and sales.", "PCS Sales By Hour reference PDF dated 2026-08-28", "Workbook version is preliminary until item-level transaction timestamps and product-tag membership are archived."]];
sources.getRange("A14:D14").format = { ...thinGrid, wrapText: true };

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(finalOutputDir, { recursive: true });
for (const sheetName of ["Dashboard", "Coverage", "Monthly Orders", "Issues", "Definitions", "Invoice Lookup", "Order Data", "Hourly Date Range", "Week Over Year", "Hourly Data"]) {
  const previewRanges = {
    "Issues": "A1:O40",
    "Invoice Lookup": "A1:H72",
    "Order Data": "A1:S30",
    "Hourly Date Range": "A1:Y56",
    "Week Over Year": "A1:L37",
    "Hourly Data": "A1:F30",
  };
  const preview = await workbook.render({
    sheetName,
    range: previewRanges[sheetName],
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
console.log(JSON.stringify({ outputPath, runs: runs.length, orders: totalOrders, issues: allIssues.length, monthlyRows: monthlyRows.length, invoiceOrders: orderRows.length, hourlyRows: hourlyRows.length }, null, 2));
