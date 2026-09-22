import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load("D:/embed/CombinedCards.xlsx"));
console.log((await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 16000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 180,
})).ndjson);

const sheet = workbook.worksheets.getItem("Results");
const rows = sheet.getRange("A4:I1605").values
  .filter((r) => r[0] && r[3] != null && r[4] != null)
  .map((r, idx) => ({
    row: idx + 4,
    dateText: String(r[0]),
    timestamp: Date.parse(String(r[0])),
    cashier: String(r[1] ?? ""),
    computer: String(r[2] ?? ""),
    from: String(r[3]),
    to: String(r[4]),
    cash: Number(r[5] ?? 0),
    bonus: Number(r[6] ?? 0),
    freeGames: Number(r[7] ?? 0),
    tickets: Number(r[8] ?? 0),
  }));

const byDest = new Map();
const bySource = new Map();
for (const r of rows) {
  if (!byDest.has(r.to)) byDest.set(r.to, { to: r.to, count: 0, sources: new Set(), cashiers: new Set(), cash: 0, bonus: 0, freeGames: 0, tickets: 0, first: r, last: r });
  const d = byDest.get(r.to);
  d.count++; d.sources.add(r.from); d.cashiers.add(r.cashier); d.cash += r.cash; d.bonus += r.bonus; d.freeGames += r.freeGames; d.tickets += r.tickets;
  if (r.timestamp < d.first.timestamp) d.first = r;
  if (r.timestamp > d.last.timestamp) d.last = r;
  if (!bySource.has(r.from)) bySource.set(r.from, []);
  bySource.get(r.from).push(r);
}

const destSummary = [...byDest.values()].map((d) => ({
  to: d.to, count: d.count, uniqueSources: d.sources.size, cashiers: [...d.cashiers],
  cash: +d.cash.toFixed(2), bonus: +d.bonus.toFixed(2), freeGames: d.freeGames, tickets: d.tickets,
  first: d.first.dateText, last: d.last.dateText,
}));

const topByCount = [...destSummary].sort((a,b) => b.count-a.count || b.cash-a.cash).slice(0,20);
const topByCash = [...destSummary].sort((a,b) => b.cash-a.cash).slice(0,20);
const topByTickets = [...destSummary].sort((a,b) => b.tickets-a.tickets).slice(0,20);
const topBySources = [...destSummary].sort((a,b) => b.uniqueSources-a.uniqueSources || b.count-a.count).slice(0,20);
const selfTransfers = rows.filter((r) => r.from === r.to);
const highCash = [...rows].sort((a,b) => b.cash-a.cash).slice(0,20);
const highTickets = [...rows].sort((a,b) => b.tickets-a.tickets).slice(0,20);

// Detect same-day chains where a receiving card is subsequently used as a source.
const sortedAsc = [...rows].sort((a,b) => a.timestamp-b.timestamp);
const recentReceived = new Map();
const chains = [];
for (const r of sortedAsc) {
  const prior = recentReceived.get(r.from);
  if (prior) {
    const mins = (r.timestamp-prior.timestamp)/60000;
    if (mins >= 0 && mins <= 120) chains.push({ minutes: +mins.toFixed(1), firstRow: prior.row, secondRow: r.row, intermediary: r.from, into: prior.to, thenTo: r.to, cashier1: prior.cashier, cashier2: r.cashier, first: prior.dateText, second: r.dateText });
  }
  recentReceived.set(r.to, r);
}

const cashierStats = new Map();
for (const r of rows) {
  if (!cashierStats.has(r.cashier)) cashierStats.set(r.cashier, {cashier:r.cashier,count:0,cash:0,tickets:0,dests:new Set()});
  const c = cashierStats.get(r.cashier); c.count++; c.cash += r.cash; c.tickets += r.tickets; c.dests.add(r.to);
}
const cashiers = [...cashierStats.values()].map(c => ({cashier:c.cashier,count:c.count,cash:+c.cash.toFixed(2),tickets:c.tickets,uniqueDestinations:c.dests.size})).sort((a,b)=>b.count-a.count);

console.log(JSON.stringify({
  totals: { rows: rows.length, uniqueDestinations: byDest.size, uniqueSources: bySource.size, cash: +rows.reduce((s,r)=>s+r.cash,0).toFixed(2), bonus: +rows.reduce((s,r)=>s+r.bonus,0).toFixed(2), freeGames: rows.reduce((s,r)=>s+r.freeGames,0), tickets: rows.reduce((s,r)=>s+r.tickets,0) },
  topByCount, topBySources, topByCash, topByTickets,
  selfTransfers: selfTransfers.slice(0,50),
  highCash, highTickets,
  rapidChains: chains.sort((a,b)=>a.minutes-b.minutes).slice(0,100),
  cashiers,
}, null, 2));
