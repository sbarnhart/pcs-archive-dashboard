import fs from "node:fs/promises";

const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const pos = line.indexOf("=");
      return [line.slice(0, pos).trim(), line.slice(pos + 1).trim()];
    }),
);

const [start, end] = process.argv.slice(2);
if (!start || !end) throw new Error("Usage: node scripts/probe_sales_by_hour.mjs YYYY-MM-DD YYYY-MM-DD");

const baseUrl = env.PCS_API_BASE_URL || "https://api.partycs.com";
const facilityId = (env.PCS_FACILITY_IDS || env.PCS_FACILITY_ID).split(",")[0].trim();
const headers = {
  accept: "application/json",
  "pcs-facility-id": facilityId,
  "pcs-company-id": env.PCS_COMPANY_ID,
};

async function getJson(url) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { headers });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 15000)));
  }
  throw new Error(`PCS request failed after retries: ${url}`);
}

const orders = [];
for (let page = 1; ; page += 1) {
  const url = new URL(`${baseUrl}/orders`);
  const params = {
    OrderDateStart: `${start}T00:00:00.000Z`,
    OrderDateEnd: `${end}T23:59:59.999Z`,
    Sort: "orderId_asc",
    Page: page,
    Size: 100,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const payload = await getJson(url);
  orders.push(...(payload.items || []));
  if (!payload.hasNextPage) break;
}

let cursor = 0;
const workers = Array.from({ length: 12 }, async () => {
  while (cursor < orders.length) {
    const index = cursor++;
    const order = orders[index];
    order.items = await getJson(`${baseUrl}/orders/${order.orderId}/items`);
  }
});
await Promise.all(workers);

await fs.mkdir("tmp", { recursive: true });
const out = `tmp/sales-by-hour-${start}_${end}.json`;
await fs.writeFile(out, `${JSON.stringify(orders, null, 2)}\n`);

const itemRows = orders.flatMap((order) =>
  (order.items || []).map((item) => ({ order, item })),
);
const metrics = {
  orders: orders.length,
  orderTotal: orders.reduce((sum, row) => sum + Number(row.orderTotal || 0), 0),
  items: itemRows.length,
  quantity: itemRows.reduce((sum, row) => sum + Number(row.item.quantity || 0), 0),
  itemPrice: itemRows.reduce((sum, row) => sum + Number(row.item.price || 0) * Number(row.item.quantity || 0), 0),
  itemListPrice: itemRows.reduce((sum, row) => sum + Number(row.item.listPrice || 0) * Number(row.item.quantity || 0), 0),
  itemPriceExtended: itemRows.reduce((sum, row) => sum + Number(row.item.priceExtended || 0), 0),
  itemListPriceExtended: itemRows.reduce((sum, row) => sum + Number(row.item.listPriceExtended || 0), 0),
  itemTax: itemRows.reduce((sum, row) => sum + Number(row.item.tax || 0), 0),
  itemDiscount: itemRows.reduce((sum, row) => sum + Number(row.item.discount || 0), 0),
};
console.log(JSON.stringify({ out, ...metrics }, null, 2));
