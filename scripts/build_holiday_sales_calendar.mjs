import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const exportsDir = path.join(root, "exports");
const outputDir = path.join(root, "outputs", "holiday-sales-hours");
const qaDir = path.join(root, "tmp", "holiday-sales-hours-qa");
const outputPath = path.join(outputDir, "PCS Holiday Sales by Hour.xlsx");

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLocal(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}/.test(text)) return null;
  const instant = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function dateFromYmd(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nthWeekday(year, monthIndex, weekday, nth) {
  const date = new Date(year, monthIndex, 1, 12);
  date.setDate(1 + ((7 + weekday - date.getDay()) % 7) + (nth - 1) * 7);
  return date;
}

function lastWeekday(year, monthIndex, weekday) {
  const date = new Date(year, monthIndex + 1, 0, 12);
  date.setDate(date.getDate() - ((7 + date.getDay() - weekday) % 7));
  return date;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function holidaysForYear(year) {
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  return [
    ["New Year's Day", new Date(year, 0, 1, 12)],
    ["Martin Luther King Jr. Day", nthWeekday(year, 0, 1, 3)],
    ["Presidents Day", nthWeekday(year, 1, 1, 3)],
    ["Easter", easterSunday(year)],
    ["Mother's Day", nthWeekday(year, 4, 0, 2)],
    ["Memorial Day", lastWeekday(year, 4, 1)],
    ["Father's Day", nthWeekday(year, 5, 0, 3)],
    ["Independence Day", new Date(year, 6, 4, 12)],
    ["Labor Day", nthWeekday(year, 8, 1, 1)],
    ["Halloween", new Date(year, 9, 31, 12)],
    ["Veterans Day", new Date(year, 10, 11, 12)],
    ["Thanksgiving", thanksgiving],
    ["Black Friday", addDays(thanksgiving, 1)],
    ["Christmas Eve", new Date(year, 11, 24, 12)],
    ["Christmas Day", new Date(year, 11, 25, 12)],
    ["New Year's Eve", new Date(year, 11, 31, 12)],
  ].map(([name, date]) => ({ year, name, date, day: ymd(date) }));
}

async function selectRuns() {
  const entries = await fs.readdir(exportsDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(exportsDir, entry.name, "manifest.json");
    if (!(await exists(manifestFile))) continue;
    try {
      const manifest = await readJson(manifestFile);
      if (manifest.completedAt && manifest.dateRange?.start && manifest.dateRange?.end) {
        candidates.push({ name: entry.name, manifest });
      }
    } catch {}
  }
  return candidates.filter((candidate) => !candidates.some((other) =>
    other.name !== candidate.name &&
    other.manifest.dateRange.start <= candidate.manifest.dateRange.start &&
    other.manifest.dateRange.end >= candidate.manifest.dateRange.end &&
    (other.manifest.dateRange.start < candidate.manifest.dateRange.start ||
      other.manifest.dateRange.end > candidate.manifest.dateRange.end)
  )).sort((a, b) => a.manifest.dateRange.start.localeCompare(b.manifest.dateRange.start));
}

const selectedRuns = await selectRuns();
const ordersById = new Map();
for (const run of selectedRuns) {
  const orderRoot = path.join(exportsDir, run.name, "facility-1", "orders");
  if (!(await exists(orderRoot))) continue;
  const dirs = (await fs.readdir(orderRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(orderRoot, entry.name));
  const rows = await mapLimited(dirs, 64, async (dir) => {
    try {
      const detail = await readJson(path.join(dir, "detail.json"));
      const itemsFile = path.join(dir, "items.json");
      const items = (await exists(itemsFile)) ? await readJson(itemsFile) : [];
      return { detail, items: Array.isArray(items) ? items : [], run: run.name, completedAt: run.manifest.completedAt };
    } catch { return null; }
  });
  for (const row of rows.filter(Boolean)) {
    const id = String(row.detail.orderId ?? row.detail.id ?? "");
    if (!id) continue;
    const current = ordersById.get(id);
    if (!current || String(row.completedAt) > String(current.completedAt)) ordersById.set(id, row);
  }
}

const hourly = new Map();
let excludedCancelled = 0;
let excludedUnclosed = 0;
for (const { detail, items } of ordersById.values()) {
  if (detail.cancelDate || detail.isDeleted || Number(detail.statusCode ?? detail.status) === 6) {
    excludedCancelled += 1;
    continue;
  }
  const stamp = parseLocal(detail.dateClosed);
  if (!stamp) {
    excludedUnclosed += 1;
    continue;
  }
  const key = `${stamp.day}|${stamp.hour}`;
  const row = hourly.get(key) ?? { day: stamp.day, hour: stamp.hour, orders: 0, items: 0, sales: 0 };
  row.orders += 1;
  row.items += items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  row.sales += Math.max(0, Number(detail.orderTotal ?? 0));
  hourly.set(key, row);
}

const hourlyRows = [...hourly.values()].sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour);
const firstDay = hourlyRows[0]?.day ?? "";
const lastDay = hourlyRows.at(-1)?.day ?? "";
const firstYear = Number(firstDay.slice(0, 4));
const lastYear = Number(lastDay.slice(0, 4));

const daily = new Map();
for (const row of hourlyRows) {
  const day = daily.get(row.day) ?? { day: row.day, orders: 0, items: 0, sales: 0, hours: Array(24).fill(0) };
  day.orders += row.orders;
  day.items += row.items;
  day.sales += row.sales;
  day.hours[row.hour] += row.sales;
  daily.set(row.day, day);
}

const holidayRows = [];
for (let year = firstYear; year <= lastYear; year += 1) {
  for (const holiday of holidaysForYear(year)) {
    if (holiday.day < firstDay || holiday.day > lastDay) continue;
    for (let offset = -7; offset <= 7; offset += 1) {
      const date = addDays(holiday.date, offset);
      const day = ymd(date);
      const data = daily.get(day) ?? { orders: 0, items: 0, sales: 0, hours: Array(24).fill(0) };
      holidayRows.push({ holiday, offset, date, day, ...data });
    }
  }
}

const summaryRows = [];
for (let year = firstYear; year <= lastYear; year += 1) {
  for (const holiday of holidaysForYear(year)) {
    if (holiday.day < firstDay || holiday.day > lastDay) continue;
    const rows = holidayRows.filter((row) => row.holiday.year === year && row.holiday.name === holiday.name);
    const windowSales = rows.reduce((sum, row) => sum + row.sales, 0);
    const windowOrders = rows.reduce((sum, row) => sum + row.orders, 0);
    const windowItems = rows.reduce((sum, row) => sum + row.items, 0);
    const holidayDay = rows.find((row) => row.offset === 0);
    const peakDay = rows.reduce((best, row) => row.sales > best.sales ? row : best, rows[0]);
    const hourTotals = Array(24).fill(0);
    for (const row of rows) row.hours.forEach((value, hour) => { hourTotals[hour] += value; });
    const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
    summaryRows.push({
      year, holiday: holiday.name, date: holiday.date, weekday: holiday.date.toLocaleDateString("en-US", { weekday: "long" }),
      holidaySales: holidayDay?.sales ?? 0, windowSales, windowOrders, windowItems,
      peakDay: dateFromYmd(peakDay.day), peakDaySales: peakDay.sales, peakHour, peakHourSales: hourTotals[peakHour],
    });
  }
}

const workbook = Workbook.create();
const overview = workbook.worksheets.add("Holiday Overview");
const calendar = workbook.worksheets.add("Holiday Calendar");
const allHours = workbook.worksheets.add("All Hourly Data");
const method = workbook.worksheets.add("Method and Sources");

const font = "Arial";
const titleFormat = { font: { name: font, size: 18, bold: true, color: "#172554" } };
const headerFormat = {
  fill: "#1E3A8A",
  font: { name: font, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
const noteFormat = { fill: "#FFF7ED", font: { name: font, italic: true, color: "#9A3412" }, wrapText: true };

overview.showGridLines = false;
overview.getRange("A1:L1").merge();
overview.getRange("A1").values = [["Holiday sales by hour"]];
overview.getRange("A1:L1").format = titleFormat;
overview.getRange("A2:L2").merge();
overview.getRange("A2").values = [[`Archived PCS orders closed from ${firstDay} through ${lastDay}. Each holiday window covers seven days before through seven days after.`]];
overview.getRange("A2:L2").format = { font: { name: font, color: "#475569", italic: true } };
overview.getRange("A4:L4").values = [["Year", "Holiday", "Holiday date", "Weekday", "Holiday sales", "15-day sales", "Orders", "Items", "Peak date", "Peak-day sales", "Peak hour", "Peak-hour sales"]];
if (summaryRows.length) overview.getRange(`A5:L${summaryRows.length + 4}`).values = summaryRows.map((row) => [
  row.year, row.holiday, row.date, row.weekday, row.holidaySales, row.windowSales, row.windowOrders, row.windowItems,
  row.peakDay, row.peakDaySales, `${String(row.peakHour).padStart(2, "0")}:00`, row.peakHourSales,
]);
overview.getRange("A4:L4").format = headerFormat;
overview.getRange(`C5:C${summaryRows.length + 4}`).format.numberFormat = "mmm d, yyyy";
overview.getRange(`I5:I${summaryRows.length + 4}`).format.numberFormat = "mmm d, yyyy";
overview.getRange(`E5:F${summaryRows.length + 4}`).format.numberFormat = "$#,##0";
overview.getRange(`J5:J${summaryRows.length + 4}`).format.numberFormat = "$#,##0";
overview.getRange(`L5:L${summaryRows.length + 4}`).format.numberFormat = "$#,##0";
overview.getRange(`G5:H${summaryRows.length + 4}`).format.numberFormat = "#,##0";
overview.getRange(`K5:K${summaryRows.length + 4}`).format.numberFormat = "@";
overview.getRange("A:L").format.font = { name: font, size: 10 };
overview.getRange("A:A").format.columnWidth = 9;
overview.getRange("B:B").format.columnWidth = 27;
overview.getRange("C:D").format.columnWidth = 16;
overview.getRange("E:L").format.columnWidth = 15;
overview.freezePanes.freezeRows(4);
overview.getRange(`A4:L${summaryRows.length + 4}`).conditionalFormats.add("Custom", { formula: "=MOD(ROW(),2)=1", format: { fill: "#F8FAFC" } });

const visibleHours = Array.from({ length: 16 }, (_, index) => index + 8);
calendar.showGridLines = false;
calendar.getRange("A1:Y1").merge();
calendar.getRange("A1").values = [["Holiday calendar"]];
calendar.getRange("A1:Y1").format = titleFormat;
calendar.getRange("A2:Y2").merge();
calendar.getRange("A2").values = [["Rows show each holiday's 15-day planning window. Hour columns show archived sales by closing hour; darker cells indicate higher sales within the calendar."]];
calendar.getRange("A2:Y2").format = { font: { name: font, color: "#475569", italic: true } };
calendar.getRange("A4:Y4").values = [["Year", "Holiday", "Offset", "Date", "Weekday", "Orders", "Items", "Daily sales", ...visibleHours.map((hour) => `${String(hour).padStart(2, "0")}:00`), "Other hours"]];
calendar.getRange(`A5:Y${holidayRows.length + 4}`).values = holidayRows.map((row) => [
  row.holiday.year, row.holiday.name, row.offset, row.date, row.date.toLocaleDateString("en-US", { weekday: "short" }),
  row.orders, row.items, row.sales, ...visibleHours.map((hour) => row.hours[hour]),
  row.hours.slice(0, 8).reduce((a, b) => a + b, 0),
]);
calendar.getRange("A4:Y4").format = headerFormat;
calendar.getRange(`D5:D${holidayRows.length + 4}`).format.numberFormat = "mmm d, yyyy";
calendar.getRange(`F5:G${holidayRows.length + 4}`).format.numberFormat = "#,##0";
calendar.getRange(`H5:Y${holidayRows.length + 4}`).format.numberFormat = "$#,##0";
calendar.getRange(`I5:Y${holidayRows.length + 4}`).conditionalFormats.add("colorScale", { colors: ["#FFFFFF", "#BFDBFE", "#1D4ED8"], thresholds: ["min", "50%", "max"] });
calendar.getRange(`A5:Y${holidayRows.length + 4}`).conditionalFormats.add("Custom", { formula: "=$C5=0", format: { fill: "#FEF3C7", font: { bold: true, color: "#78350F" } } });
calendar.getRange("A:Y").format.font = { name: font, size: 10 };
calendar.getRange("A:A").format.columnWidth = 9;
calendar.getRange("B:B").format.columnWidth = 27;
calendar.getRange("C:C").format.columnWidth = 9;
calendar.getRange("D:E").format.columnWidth = 15;
calendar.getRange("F:H").format.columnWidth = 13;
calendar.getRange("I:Y").format.columnWidth = 11;
calendar.freezePanes.freezeRows(4);
calendar.freezePanes.freezeColumns(5);

allHours.getRange("A1:E1").values = [["Date", "Hour", "Orders", "Items", "Sales"]];
if (hourlyRows.length) allHours.getRange(`A2:E${hourlyRows.length + 1}`).values = hourlyRows.map((row) => [dateFromYmd(row.day), `${String(row.hour).padStart(2, "0")}:00`, row.orders, row.items, row.sales]);
allHours.getRange("A1:E1").format = headerFormat;
allHours.getRange(`A2:A${hourlyRows.length + 1}`).format.numberFormat = "yyyy-mm-dd";
allHours.getRange(`B2:B${hourlyRows.length + 1}`).format.numberFormat = "@";
allHours.getRange(`C2:D${hourlyRows.length + 1}`).format.numberFormat = "#,##0";
allHours.getRange(`E2:E${hourlyRows.length + 1}`).format.numberFormat = "$#,##0.00";
allHours.getRange("A:E").format.font = { name: font, size: 10 };
allHours.getRange("A:E").format.columnWidth = 16;
allHours.freezePanes.freezeRows(1);

method.showGridLines = false;
method.getRange("A1:D1").merge();
method.getRange("A1").values = [["Method and sources"]];
method.getRange("A1:D1").format = titleFormat;
method.getRange("A3:D3").values = [["Topic", "Rule", "Source", "Limitation"]];
method.getRange("A4:D10").values = [
  ["Sales", "Non-cancelled archived order total, grouped by dateClosed hour.", "https://api.partycs.com/orders", "Planning estimate; PCS may apply additional tag, void, refund, discount, or item-timestamp rules."],
  ["Items", "Sum of archived order-item quantity for each included order.", "https://api.partycs.com/orders/{orderId}/items", "Package components may be counted differently by the PCS report."],
  ["Holiday window", "Seven calendar days before through seven calendar days after each holiday.", "Workbook holiday rules", "School breaks and local events are not yet included."],
  ["Validation", "Sample PCS report: September 7-13, 2026 showed 671 items and $15,557.78.", "https://lazertagextreme.partycentersoftware.com/reports/sales_by_hour.asp?action=get_report", "API sample returned 670 top-level item units; the one-unit difference is accepted for planning."],
  ["Archive range", `${firstDay} through ${lastDay}; ${ordersById.size.toLocaleString("en-US")} unique archived orders scanned.`, "Local PCS archive exports", "Partial years and closures create gaps; use the coverage context when comparing years."],
  ["Excluded", `${excludedCancelled.toLocaleString("en-US")} cancelled/void/deleted orders and ${excludedUnclosed.toLocaleString("en-US")} orders without a close timestamp.`, "Archived order status and dateClosed fields", "Unclosed future bookings are intentionally excluded."],
  ["Refresh", "Rebuild after new yearly exports complete.", "scripts/build_holiday_sales_calendar.mjs", "The Google Sheet is a snapshot until replaced with a newly imported build."],
];
method.getRange("A3:D3").format = headerFormat;
method.getRange("A4:D10").format = { font: { name: font, size: 10 }, wrapText: true, verticalAlignment: "top", borders: { preset: "all", style: "thin", color: "#E2E8F0" } };
method.getRange("A:A").format.columnWidth = 18;
method.getRange("B:B").format.columnWidth = 55;
method.getRange("C:C").format.columnWidth = 65;
method.getRange("D:D").format.columnWidth = 55;
method.getRange("A12:D13").merge();
method.getRange("A12").values = [["Use this workbook for staffing, operating-hour, promotion, and inventory planning. It is not an accounting closeout or tax report."]];
method.getRange("A12:D13").format = noteFormat;

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });

const overviewPreview = await workbook.render({ sheetName: "Holiday Overview", range: "A1:L35", scale: 1.25, format: "png" });
await fs.writeFile(path.join(qaDir, "holiday-overview.png"), new Uint8Array(await overviewPreview.arrayBuffer()));
const calendarPreview = await workbook.render({ sheetName: "Holiday Calendar", range: "A1:Y34", scale: 1, format: "png" });
await fs.writeFile(path.join(qaDir, "holiday-calendar.png"), new Uint8Array(await calendarPreview.arrayBuffer()));
const methodPreview = await workbook.render({ sheetName: "Method and Sources", range: "A1:D13", scale: 1.25, format: "png" });
await fs.writeFile(path.join(qaDir, "method-and-sources.png"), new Uint8Array(await methodPreview.arrayBuffer()));

const inspection = await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 8000, tableMaxRows: 6, tableMaxCols: 10 });
await fs.writeFile(path.join(qaDir, "inspection.ndjson"), inspection.ndjson ?? String(inspection));
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
await fs.writeFile(path.join(qaDir, "formula-errors.ndjson"), errors.ndjson ?? String(errors));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, selectedRuns: selectedRuns.map((run) => run.name), uniqueOrders: ordersById.size, hourlyRows: hourlyRows.length, holidayRows: holidayRows.length, firstDay, lastDay, excludedCancelled, excludedUnclosed }, null, 2));
