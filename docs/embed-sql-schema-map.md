# Embed ECS7 database map

Working map for the Embed Card Systems SQL Server database `ECS7`, updated 2026-09-22 from SSMS screenshots and pasted query results. This documents confirmed columns and likely relationships. It is not yet a validated data dictionary.

The supplied server inventory identifies `ECSSERVER`, SQL Server `12.0.2000.8` (2014 RTM Express, 64-bit), database compatibility level `100`, collation `SQL_Latin1_General_CP1_CI_AS`, snapshot isolation `ON`, and read-committed snapshot `OFF`. This is a point-in-time inventory, not a connection from this workspace.

## Source coverage

| Source | Evidence | Limit |
|---|---|---|
| `SELECT * FROM Product_Master_List` | 21 columns; 1,279 pasted rows | Snapshot from the test run |
| `SELECT * FROM Product_Barcodes` | Barcode assignments; 1,266 pasted rows | Snapshot from the test run |
| `SELECT TOP 1000 ... FROM ECS_Stock_On_Hand` | Stock location, on-hand quantity, purchase price, average cost | Only the first 1,000 rows were pasted |
| Column-name search | Pricing, supplier, stock, card, game, sale, and payment column names | Filtered catalog, not every table or column |
| Full object and column catalogs | 332 objects and 3,059 column entries | Approximate table row counts, not live `COUNT(*)` values |
| Primary-key export | Keys for eight core product, stock, location, and supplier tables | Foreign keys not supplied |
| Product Details screenshot | UI labels for ticket value, sale price, suppliers, and reorder settings | Screen showed **Unsaved Changes**, so values might not have reached SQL |

The pasted product and barcode results are data snapshots. The supplied catalog confirms object types and columns; the separate key export confirms the primary keys below. Foreign keys, exact row counts, and relationship behavior still need validation.

## Product and inventory tables

| Table or view | Grain and useful columns | Evidence status |
|---|---|---|
| `dbo.Product_Master_List` | Product: `Product_Id`, `Managing_Location`, name, description, category/class/tax, sale type, active/deleted flags, last modified | Columns and rows confirmed |
| `dbo.Product_Barcodes` | Barcode assignment: `Barcode`, `Product_Id`, `Item_Id`, `Exported` | Columns and rows confirmed |
| `dbo.Product_Pricing` | Product × price zone × effective date: `Ticket_Value`, `Vending_Price`, `Minimum_Cost`, `Tendered_To_Card`, `Is_Price_ExTax` | Columns and composite primary key confirmed; value semantics untested |
| `dbo.Locations` | Location: `Location_Id`, `Location_Description`, `Price_Zone`, `Tax_Zone`, manager location IDs | Columns confirmed |
| `dbo.Stock_Products` | Product: `Product_Id`, `Product_Code`, `Non_Stock`, `Mandatory_Stock_Take`, `Reorder_Level_Min`, `Reorder_Level_Max` | Columns and product primary key confirmed |
| `dbo.Store_Products` | Product × location × warehouse: `Location_Id`, `Warehouse_Id`, `Product_Id`, `Stock_Quantity`, `Reorder_Level`, `Last_Purchase_Price`, `Average_Unit_Cost` | Columns and composite primary key confirmed |
| `dbo.ECS_Stock_On_Hand` | Product × location/stock location: `product_id`, `location_id`, `Stock_Location`, `Quantity_On_Hand`, `last_purchase_price`, `average_unit_cost` | Confirmed view; columns and 1,000 sample rows confirmed |
| `dbo.Product_Suppliers` | Product × supplier: `Product_Id`, `Supplier_Id`, `Preferred_Supplier`, `Container_Price`, `Container_Quantity`, item code, deleted flag | Columns and composite primary key confirmed |
| `dbo.Suppliers` | Supplier: `Supplier_Id`, `Supplier_Code`, `Supplier_Name`, contact fields | Columns and primary key confirmed |
| `dbo.Product_Categories`, `dbo.Product_Classes` | Category/class IDs and descriptions, scoped by location | Columns confirmed; keys not supplied |
| `dbo.Product_Components`, `dbo.Product_Plays`, `dbo.Product_Plays_Games` | Product components and product-to-game play definitions | Columns confirmed; keys and business behavior not yet validated |

### Confirmed primary keys

| Table | Primary-key columns, in order |
|---|---|
| `Locations` | `Location_Id` |
| `Product_Master_List` | `Product_Id` |
| `Product_Barcodes` | `Barcode` |
| `Product_Pricing` | `Product_Id`, `Price_Zone`, `Effective_Date` |
| `Product_Suppliers` | `Product_Id`, `Supplier_Id` |
| `Stock_Products` | `Product_Id` |
| `Store_Products` | `Product_Id`, `Location_Id`, `Warehouse_Id` |
| `Suppliers` | `Supplier_Id` |

These are the keys from the supplied eight-table key export. A barcode is globally unique in this database, but a product may have several barcodes. The price and store tables deliberately have multiple rows per product.

### Product relationship map

```text
Locations.Location_Id ───────────── Product_Master_List.Managing_Location
        │                                      │
        │ Price_Zone                           ├── Product_Barcodes.Product_Id
        └──────────────── Product_Pricing      ├── Product_Pricing.Product_Id
                                             ├── Stock_Products.Product_Id
                                             ├── Store_Products.Product_Id
                                             ├── ECS_Stock_On_Hand.product_id
                                             └── Product_Suppliers.Product_Id
                                                          │
                                                          └── Suppliers.Supplier_Id
```

These are candidate joins based on matching identifiers and the pasted rows; declared foreign keys have not been supplied. `Store_Products` uses all three keys (`Product_Id`, `Location_Id`, `Warehouse_Id`) for warehouse detail. A direct join to several barcodes, suppliers, price dates, and warehouses can multiply product rows. The requested import layout repeats the product on an additional row for each extra barcode, supplier, or other repeated item; label suppliers `Supplier 1`, `Supplier 2`, etc. Number each relationship independently and do not create a Cartesian product of barcodes × suppliers × warehouses. [product_related_items.sql](../scripts/embed_sql/product_related_items.sql) returns these as three separate result sets. Exact placement of supplier labels in the destination template must be checked because it currently has only `Vendor Name`, not a supplier-number column.

### Observations from the test snapshots

- 1,209 of the 1,279 pasted products had `Active_Product = 1` and `Deleted = 0`.
- 88 active, non-deleted products had no matching barcode in the pasted barcode result.
- 57 product IDs had multiple barcodes, representing 70 additional barcode rows.
- 69 barcode rows had `Product_Id = 0`.
- Barcodes include leading zeroes and nonnumeric text. Treat them as strings. SQL `bigint` product IDs should also be written as text to Excel to avoid loss of digits.
- The 1,000 pasted stock rows are limited by `TOP 1000`; do not use that result for total inventory counts.

These counts describe the supplied test results. Recompute them with fresh extracts before go-live.

## Inventory import template fields

| Template field | SQL source | Status |
|---|---|---|
| Code | `Product_Master_List.Product_Id` | Confirmed; export to Excel as text |
| Product Name / Description | `Product_Master_List.Product_Name`, `Product_Description` | Confirmed |
| Category | `Product_Master_List.Category_Id` | Category code confirmed; display label may need `Product_Categories` |
| Price In Tickets | `Product_Pricing.Ticket_Value` | Column confirmed; use location price zone and selected effective date |
| Cost | `Store_Products.Average_Unit_Cost` or `ECS_Stock_On_Hand.average_unit_cost` | Candidate; confirm stock scope and cost policy |
| Sale Price | Unidentified | Do not equate `Minimum_Cost` with the UI sale price without a row check |
| Vendor Name | `Product_Suppliers.Supplier_Id` → `Suppliers.Supplier_Name` | Candidate; a product may have several suppliers |
| Bar Code | `Product_Barcodes.Barcode` | Confirmed; decide how the destination handles multiple barcodes |
| Redeemable / Sellable / Display In POS / UOM / Display Group | Product flags or other configuration tables | Unresolved |
| Reorder Point | `Stock_Products.Reorder_Level_Min` or warehouse-specific `Store_Products.Reorder_Level` | Candidate; compare with UI for several products |
| Reorder Qty | `Stock_Products.Reorder_Level_Max` may be a target stock level, not an order quantity | Unresolved mapping |
| Opening Qty | Preserve Embed's reported on-hand quantity exactly, including large balances and explicit zeros; use fallback `1` only after a complete stock extract confirms no quantity record | User confirmed Senmox can display negative stock while Embed blocks processing below zero and explicitly requested that reported balances remain unchanged. The available stock extract is capped at 1,000 rows, so unmatched products stay blank. Put opening quantity only on the first row of a multi-barcode product to prevent double-counting. |
| Receive Price | `Store_Products.Last_Purchase_Price`, stock view price, or supplier container price | Candidate; confirm unit versus container basis |

The current read-only extract is [product_import_test.sql](../scripts/embed_sql/product_import_test.sql). It is a test query, not yet the final import mapping.

## Other domains to map

The supplied object catalog contains 332 objects and 3,059 column entries. Approximate row counts identify where most activity is: `Messages` 473,583; `Play_Transactions` 455,525; `Sale_Invoices` 193,180; `Card_Transactions` 128,666; `Sale_Card_Transactions` 64,267; and `Sale_Transactions` 54,735. These are catalog estimates, not reconciled business totals. `ECS_Stock_On_Hand` is a view, so its reported catalog row count of zero does **not** mean it is empty. Product-related catalog counts are `Product_Master_List` 1,279, `Product_Barcodes` 1,266, `Product_Pricing` 1,861, `Product_Suppliers` 1,215, `Stock_Products` 1,183, and `Store_Products` 1,180.

| Domain | Tables identified so far | Questions for the catalog and sample rows |
|---|---|---|
| Cards and balances | `Cards`, `Card_Products`, `Card_Types`, `Card_Transactions`, `Card_Audit`, `Card_Balance_Snapshot_Data`, `Card_Statistics`, `Card_Statuses`, `GC_Transfers` | Card key/barcode, balance buckets, transaction dates, transfer and recycle lineage |
| Games and plays | `Game_Master_List`, `Game_Definitions`, `Game_Details`, `Game_Classes`, `Game_Swipers`, `Play_Transactions`, `Play_Transaction_Prizes`, `Plays` | Unit/reader key, play grain, game value, tickets awarded |
| Sales and payments | `Sale_Items`, `Payments`, `Payment_Authorisation_Details`, `General_Transactions`, `Online_Transactions`, `Online_Transaction_Items`, `Other_Income` | Sale header/item/payment joins, reversals, refunds, tenders |
| Stock and purchasing | `Stock_Transactions`, `Stock_Takes`, `Purchase_Orders`, `Purchase_Order_Details`, `Deliveries`, `Suppliers` | Movement dates, purchase units, cost, supplier, warehouse |
| Parties and PCS links | `Parent_Cards`, `Party_Cards`, `Party_Group`, `Party_Coupons`, `PCS_Orders_Lookup`, `PCS_Deposits_Lookup` | Party/card relationships and PCS order/deposit identifiers |
| Operations | `Api_Usage*`, `Metrics`, `Notifications*`, `POS_*`, `Postponed_Imports` | Readers, upload delays, terminals, exceptions |

Roles inferred only from table names remain provisional. The full catalog should be used before extracting these domains. Do not extract password or authentication values for the business map; `Locations.User_Password` exists but is unrelated to the requested analysis.

## Next mapping steps

1. Run the foreign-key and remaining-index sections of [discover_schema.sql](../scripts/embed_sql/discover_schema.sql) in SSMS with `ECS7` selected. Object, column, and core primary-key outputs have already been supplied; declared foreign keys are still missing.
2. Run [inspect_product_tables.sql](../scripts/embed_sql/inspect_product_tables.sql) for the remaining product relationships and one example product.
3. Validate product pricing against the Embed UI after saving a product. Confirm what `Minimum_Cost` and `Vending_Price` mean for the destination's Sale Price.
4. Validate reorder minimum/maximum, warehouse reorder level, and current quantity against multiple products in the UI.
5. Map cards, games, sales, and payments from the complete catalog and reconcile one known report total for each domain.
6. Freeze the tested extract queries. Refresh and compare row counts, barcodes, prices, stock, and timestamps immediately before go-live.

No direct SQL Server connection is configured in this workspace. This map has not been executed against `ECS7` from here.
