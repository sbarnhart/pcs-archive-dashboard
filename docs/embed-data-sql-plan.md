# Embed data and SQL plan

## Objective

Build a repeatable, read-only archive of Embed Card Systems SQL Server data that can be joined to the PCS archive for operations, revenue reconciliation, game performance, card liability, and exception review. Direct SQL extraction is the primary source. Existing XLSX and PDF exports are reconciliation evidence and schema clues.

The design has three layers:

1. **Raw archive** — unchanged SQL extracts and report files, with checksums, extraction watermarks, and source metadata.
2. **SQL warehouse** — typed, normalized tables with stable keys and documented business-day rules.
3. **Views and dashboard outputs** — operational and accounting metrics derived from SQL.

Do not load report totals directly into transaction tables. Report exports are snapshots or aggregates and must retain their covered date range and filter settings.

## Source inventory already available

| Source | Observed grain | Important fields | Coverage observed | Recommended use |
|---|---|---|---|---|
| `CardProductSales.xlsx` | One row per card product for one report run | product ID, description, sold/reversed/net quantity, average unit sale, gross sales, tax, coupons | 2013-02-01 through 2026-09-15 | Product catalog seed and report-level sales reconciliation |
| `GameActivity (3).xlsx` | One row per game unit for one report run | serial number, game description, staff/guest plays, play value, ticket issue, average tickets, payout percent | 2024-06-04 through 2026-09-15 | Game performance snapshot and game master seed |
| `CombinedCards.xlsx` | One row per card-combine transfer | timestamp, cashier, computer, source barcode, destination barcode, cash, bonus, free games, tickets | 2024-08-01 through 2026-09-15 | Card transfer graph, fraud/exception review, balance lineage |
| `RecycledCards.xlsx` | One row per recycled-card event | timestamp, cashier, barcode, card type, play value/bonus, e-cash, p-cash, tickets | 2013-01-01 through 2026-09-15 | Card lifecycle, liability reduction, exception review |
| `CardBalanceDetails (2).xlsx` and `(3)` | Detailed card balances; exact layout still needs profiling | expected barcode and balance components | Exported 2026-09-15 | Current card-liability snapshot; compare the two copies before loading |
| `PrizePayouts.xlsx` | Report shell/summary, not a usable detailed fact in the current file | date range and location | 2026-03-28 through 2026-04-03 | Validation only until a detailed export is obtained |
| `KioskandReloadStation*.pdf` | One report per period/export | kiosk/reload totals and report metadata | Multiple historical files plus 2025 and 2026 | Reconciliation evidence; replace with XLSX/CSV/SQL where possible |
| `SixWeekGameTrend.pdf` | Aggregated trend report | game trend metrics | Point-in-time export | Validation and dashboard comparison |
| `TopTenByGameUnit.pdf` | Ranked game-unit summary | top game metrics | Point-in-time export | Validation and dashboard comparison |

## Proposed SQL model

Use string columns for barcodes, product IDs, game serial numbers, terminal IDs, and other identifiers. Leading zeroes are meaningful and numeric types can corrupt them.

### Control and lineage

`source_file`

- `source_file_id` primary key
- `source_system` (`embed`, later `pcs` or other systems)
- `file_name`, `relative_archive_path`, `sha256`, `byte_size`
- `exported_at`, `loaded_at`
- `report_name`, `report_version`, `location_name`
- `range_start_local`, `range_end_local`
- `filter_json`, `row_count`, `load_status`, `load_error`

Every staged and final fact row should retain `source_file_id` and `source_row_number`.

### Dimensions

`dim_location`

- Stable internal `location_id`
- Embed location name/code and PCS facility ID
- Time zone and business-day cutoff (observed Embed reports use a 06:00 boundary)

`dim_card_product`

- `card_product_key`, source product ID, description
- Product family: reload, timed play, comp, party card, package, other
- Face value where applicable
- Effective dates and active flag

`dim_game_unit`

- `game_unit_key`, serial number, description
- Game type: redemption, video, merchandiser, timed attraction, other
- Physical location, reader/controller, operational status
- Installed/retired dates
- Canonical identity for renamed or replacement units

`dim_employee`

- Stable employee key plus source-specific cashier name/ID
- Avoid treating spelling variants as different employees; keep an alias table

`dim_terminal`

- Computer/kiosk/register identifier, device type, location, active dates

`dim_card`

- Internal surrogate `card_key`
- Barcode stored as protected text; optionally store a one-way hash for most analytical access
- Card type, issue date if known, status, first/last observed timestamps

### Facts

`fact_card_product_sales_snapshot`

- Grain: product × location × report run
- Quantities sold/reversed/net, average unit sale, gross sales, tax, percent of total, coupons
- This remains a snapshot fact until transaction-level card product sales are extracted

`fact_game_activity_snapshot`

- Grain: game unit × location × report run
- Staff plays, guest plays, play value, electronic/paper tickets, average tickets per play, payout percent
- Store report values and independently recomputed values for QA

`fact_card_transfer`

- Grain: one combine/transfer event
- Transfer timestamp, business date, cashier, terminal
- From-card and to-card keys
- Cash, bonus, free games, and ticket balances transferred
- Deterministic event hash for deduplication

`fact_card_recycle`

- Grain: one recycled-card event
- Event timestamp, business date, cashier, card, card type
- Play value, play bonus, e-cash, p-cash, tickets
- Preserve negative values; do not silently convert them to zero

`fact_card_balance_snapshot`

- Grain: card × snapshot timestamp
- Each available balance bucket, card status/type, last-use fields if present
- Snapshot totals become the authoritative point-in-time liability balance, with transfers and recycle events used to explain movement

`fact_game_play`

- Preferred grain: one game play/swipe from direct SQL
- Timestamp, business date, card, game unit, play price/value, staff flag, tickets awarded, result/status
- If direct SQL cannot provide this, keep only the aggregate game-activity snapshot and label its limitations

`fact_kiosk_transaction`

- Preferred grain: one sale/reload/refund/void transaction
- Timestamp, business date, terminal, card, product, cashier, tender, gross, discount, tax, net, reversal relationship

### Mapping and bridge tables

- `map_embed_product_to_pcs_product`: Embed card product ↔ PCS product/SKU, effective dates, confidence, review status
- `map_embed_location_to_pcs_facility`: Embed location ↔ PCS facility
- `map_employee_alias`: cashier display variants ↔ canonical employee
- `map_game_alias`: historical serial/description variants ↔ canonical game unit
- `bridge_card_transfer`: transfer event ↔ source and destination cards; supports recursive lineage queries

## Ingestion rules

1. Copy each export into an immutable archive using a timestamped name.
2. Calculate SHA-256 before loading. Skip exact duplicates but record that they were received.
3. Capture report title, version, location, filters, printed timestamp, and covered range.
4. Load the full worksheet to a staging table before transforming it.
5. Exclude title, note, total, and printed-on rows from facts, but preserve them in source metadata.
6. Parse dates in the venue's local time, then also store UTC.
7. Derive `business_date` using the configured 06:00 local cutoff rather than midnight.
8. Parse currency symbols and percentages into decimal columns while retaining the original cell text in staging.
9. Deduplicate with source-natural keys plus a deterministic row hash. Never deduplicate only on amount and date.
10. Quarantine malformed rows and report them; do not drop them silently.

## SQL Server access model

- Connect to the Embed SQL Server locally or across the trusted LAN/VPN.
- Use Windows integrated authentication when practical. Otherwise keep the SQL login in the operating-system credential store or environment variables, never in Git.
- Create a dedicated read-only login/user even if administrator access is available. Grant `CONNECT` and `SELECT` to the required database objects plus metadata visibility needed for discovery.
- Do not add indexes, views, triggers, stored procedures, CDC, or change tracking to the vendor database without vendor review.
- Prefer snapshot isolation if already enabled. Do not enable it as part of extraction. Otherwise use ordinary read-committed reads during lower-volume periods and extract in bounded date windows.
- Record SQL Server/database version, compatibility level, database collation, server time zone assumptions, and Embed application version.
- Store every extraction query version and its parameters beside the output manifest.

## Work plan

### Phase 1 — Connect and discover

- [ ] Record server/instance, database name, authentication method, and whether access is local or remote.
- [ ] Install Microsoft ODBC Driver 18 and a supported client (`sqlcmd` or Python `pyodbc`) on the extraction machine.
- [ ] Run the read-only catalog discovery query and archive its results.
- [ ] Identify tables/views containing cards, balances, games, plays, products, sales, loads, transfers, recycling, tickets, prizes, employees, terminals, locations, and audit data.
- [ ] Identify primary keys, foreign keys, timestamp columns, row counts, and high-water-mark candidates.
- [ ] Determine whether vendor views or stored procedures reproduce the reports more reliably than base tables.
- [ ] Confirm SQL Server timestamps, the venue time zone, and the 06:00 business-day boundary.

### Phase 2 — Preserve report evidence

- [ ] Move/copy the current `D:\embed` business exports into a managed raw archive; exclude installers and unrelated ZIP files.
- [ ] Hash every source and create a report-file manifest.
- [ ] Compare the two `CardBalanceDetails` files to determine whether they are identical, overlapping, or separate snapshots.
- [ ] Profile every workbook and PDF for headers, date coverage, totals, and filters.

### Phase 3 — Build SQL foundation

- [ ] Choose database engine. SQLite/DuckDB is sufficient for a single-user archive; PostgreSQL is preferable for multi-user dashboards and scheduled loads.
- [ ] Create control, staging, dimension, fact, and mapping schemas.
- [ ] Build idempotent loaders for the five usable XLSX sources.
- [ ] Add data-quality tests for row counts, identifier preservation, totals, duplicate events, and date coverage.
- [ ] Create a load audit report for each run.

### Phase 4 — Build direct SQL extracts

Build incremental, read-only extracts for:

- [ ] Card master and all balance buckets
- [ ] Card issue, sale, reload, adjustment, transfer, and recycle history
- [ ] Game master, readers, game pricing, and configuration history
- [ ] Play/swipe transactions with ticket awards and staff-play indicators
- [ ] Product master and product-price history
- [ ] Kiosk/POS transactions, tenders, discounts, refunds, reversals, and voids
- [ ] Employee/cashier and terminal master data
- [ ] Prize/redemption transactions and prize inventory/cost data
- [ ] Maintenance, offline-reader, and communication-error logs if available

Never query vendor tables from dashboard code directly; land extracts into the archive first. Use immutable Parquet or CSV/JSONL files with a manifest, row count, checksum, query version, extraction start/end time, and high-water mark.

### Phase 5 — Join Embed and PCS

- [ ] Create location, product, employee, and business-date mappings.
- [ ] Reconcile Embed card product gross sales to PCS product/order/payment data by business day.
- [ ] Keep timing differences, refunds, comps, and party-package allocations as explicit reconciliation categories.
- [ ] Link PCS party/order IDs to issued card products only when a reliable shared identifier exists; otherwise use a reviewed mapping, not fuzzy matching as fact.

### Phase 6 — Views and dashboards

- [ ] Card liability by balance bucket and age
- [ ] Loads, play value consumed, tickets earned/redeemed, and breakage
- [ ] Game revenue, plays, tickets per play, payout percentage, and downtime indicators
- [ ] Staff-play rate and high-value adjustments
- [ ] Card combine chains, repeated destination cards, rapid transfers, and unusual cashier activity
- [ ] Recycled cards with nonzero or negative residual balances
- [ ] Kiosk versus staffed-POS mix, reload behavior, refunds, and voids
- [ ] PCS-to-Embed daily reconciliation with explained/unexplained variance

## Other useful data to add

- Game purchase cost, install date, floor location, manufacturer, warranty, and depreciation category
- Prize SKU, cost, ticket price, inventory count, shrink, and sensor calibration history
- Reader serial number, MAC/IP, switch port, game assignment, firmware, and last-online timestamp
- Operating calendar, holidays, closures, school breaks, promotions, and pricing changes
- Weather for demand analysis, stored at daily/hourly grain rather than joined into raw transactions
- Party package definitions and included card value by effective date
- Coupons, comps, employee discounts, and reason codes
- Maintenance tickets and out-of-service intervals
- Data dictionary entries for every balance bucket and report metric

## Validation checks

- Report detail sums match report grand totals within rounding tolerance.
- `qty_net = qty_sold - qty_reversed` for card products.
- Recomputed game average tickets and payout percentages agree with report values or produce a documented exception.
- Transfer source and destination barcodes are different unless the self-transfer is explicitly valid.
- Card balance snapshots reconcile to balance components and never lose leading zeroes.
- No fact row falls outside its source file's covered range.
- Repeat loads produce no duplicate facts.
- PCS/Embed daily variance is split into timing, refund/reversal, comp, package allocation, and unexplained categories.

## First implementation slice

Start with a local DuckDB or SQLite database and these five tables:

1. `source_file`
2. `dim_card`
3. `fact_card_transfer`
4. `fact_card_recycle`
5. `fact_game_activity_snapshot`

This slice uses the strongest current sources, establishes lineage and business-date handling, and immediately supports card-transfer and game-performance analysis. Add product sales and balance snapshots next, after the duplicate balance files are resolved.
