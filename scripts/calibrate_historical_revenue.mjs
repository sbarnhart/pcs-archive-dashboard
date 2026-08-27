import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const years = [2019, 2020];
const report = JSON.parse(await fs.readFile(path.join(root, "exports", "reporting", "revenue-by-month.json"), "utf8"));
const pcs = new Map(report.months.map((row) => [row.month, Number(row.revenue)]));

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const monthly = new Map();
for (const year of years) {
  const orderRoot = path.join(root, "exports", `year-${year}-through-${year}-12-31`, "facility-1", "orders");
  const entries = await fs.readdir(orderRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(orderRoot, entry.name, "detail.json"));
  const orders = (await mapLimited(files, 96, async (file) => {
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
  })).filter(Boolean);
  for (const order of orders) {
    const rawDate = order.orderDate ?? order.eventStartDateTime ?? order.createdUtc;
    if (!rawDate) continue;
    const month = String(rawDate).slice(0, 7);
    const row = monthly.get(month) ?? {
      allOrderValue: 0,
      activeOrderValue: 0,
      closedActiveOrderValue: 0,
      balanceProxy: 0,
      activeBalanceProxy: 0,
      clampedBalanceProxy: 0,
      activeClampedBalanceProxy: 0,
      snapshotPayments: 0,
      snapshotNetPayments: 0,
    };
    const total = Number(order.orderTotal ?? 0);
    const balance = Number(order.balanceDue ?? 0);
    const payments = Number(order.totalPayments ?? 0);
    const refunds = Number(order.totalRefunds ?? 0);
    const active = !order.cancelDate;
    row.allOrderValue += total;
    row.balanceProxy += total - balance;
    row.clampedBalanceProxy += Math.max(0, total - balance);
    row.snapshotPayments += payments;
    row.snapshotNetPayments += payments - refunds;
    if (active) {
      row.activeOrderValue += total;
      row.activeBalanceProxy += total - balance;
      row.activeClampedBalanceProxy += Math.max(0, total - balance);
      if (order.dateClosed) row.closedActiveOrderValue += total;
    }
    monthly.set(month, row);
  }
}

const methods = [
  "allOrderValue",
  "activeOrderValue",
  "closedActiveOrderValue",
  "balanceProxy",
  "activeBalanceProxy",
  "clampedBalanceProxy",
  "activeClampedBalanceProxy",
  "snapshotPayments",
  "snapshotNetPayments",
];
const comparable = [...monthly.entries()]
  .filter(([month]) => pcs.has(month) && pcs.get(month) > 0)
  .sort(([a], [b]) => a.localeCompare(b));

const summaries = methods.map((method) => {
  const rows = comparable.map(([month, values]) => ({ month, actual: pcs.get(month), estimate: values[method] }));
  const actualTotal = rows.reduce((sum, row) => sum + row.actual, 0);
  const estimateTotal = rows.reduce((sum, row) => sum + row.estimate, 0);
  const mae = rows.reduce((sum, row) => sum + Math.abs(row.estimate - row.actual), 0) / rows.length;
  const wmape = rows.reduce((sum, row) => sum + Math.abs(row.estimate - row.actual), 0) / actualTotal;
  return { method, months: rows.length, actualTotal, estimateTotal, totalDifference: estimateTotal - actualTotal, mae, wmape };
}).sort((a, b) => a.wmape - b.wmape);

console.log(JSON.stringify({ summaries, monthly: comparable.map(([month, values]) => ({ month, pcs: pcs.get(month), ...values })) }, null, 2));
