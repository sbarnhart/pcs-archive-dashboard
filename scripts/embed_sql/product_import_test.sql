/*
  Embed ECS7 product extract for the inventory import test.
  Read-only. Re-run near go-live for fresh source data.

  Grain: product x barcode x stock location. A product can have multiple
  barcodes, and those rows should be reviewed before importing into a
  one-row-per-product template.

  @AsOf controls which effective-dated price is selected. Set it to the
  intended export date/time. @LocationId is the Embed managing location.
*/

DECLARE @LocationId int = 585101;
DECLARE @AsOf datetime = GETDATE();

SELECT
    CONVERT(varchar(30), p.Product_Id) AS Code,
    p.Product_Name AS [Product Name],
    p.Product_Description AS [Description],
    RTRIM(p.Category_Id) AS Category,
    RTRIM(p.Class_Id) AS [Embed Class],
    RTRIM(p.Tax_Group) AS [Embed Tax Group],
    p.Sale_Type AS [Embed Sale Type],
    p.Product_Type AS [Embed Product Type],
    p.Active_Product AS [Embed Active],
    p.Deleted AS [Embed Deleted],
    p.Require_Comment AS [Comment Required],
    p.Orderable_Item AS [Orderable Item],
    p.Last_Modified AS [Product Last Modified],

    b.Barcode AS [Bar Code],
    b.Item_Id AS [Barcode Item Id],

    loc.Price_Zone AS [Price Zone],
    pricing.Effective_Date AS [Price Effective Date],
    pricing.Ticket_Value AS [Price In Tickets],
    pricing.Vending_Price AS [Vending Price],
    pricing.Minimum_Cost AS [Embed Minimum Cost],
    pricing.Tendered_To_Card AS [Embed Tendered To Card],
    pricing.New_Card_Cost AS [Embed New Card Cost],
    pricing.Is_Price_ExTax AS [Price Excludes Tax],

    s.Stock_Location AS [Stock Location],
    s.Quantity_On_Hand AS [Current Qty On Hand],
    s.average_unit_cost AS [Average Unit Cost],
    s.last_purchase_price AS [Last Purchase Price],
    stock_product.Non_Stock AS [Non Stock Product],
    stock_product.Mandatory_Stock_Take AS [Mandatory Stock Take],
    stock_product.Reorder_Level_Min AS [Reorder Minimum],
    stock_product.Reorder_Level_Max AS [Reorder Maximum],
    store_totals.Stock_Quantity AS [Store Qty Across Warehouses],

    supplier.Supplier_Id AS [Supplier Id],
    supplier.Supplier_Name AS [Vendor Name],
    ps.Product_Supplier_Code AS [Supplier Item Code],
    ps.Container_Quantity AS [Supplier Container Qty],
    ps.Container_Price AS [Supplier Container Price],
    ps.Preferred_Supplier AS [Preferred Supplier]
FROM ECS7.dbo.Product_Master_List AS p
LEFT JOIN ECS7.dbo.Locations AS loc
    ON loc.Location_Id = p.Managing_Location
LEFT JOIN ECS7.dbo.Product_Barcodes AS b
    ON b.Product_Id = p.Product_Id
LEFT JOIN ECS7.dbo.ECS_Stock_On_Hand AS s
    ON s.product_id = p.Product_Id
   AND s.location_id = p.Managing_Location
LEFT JOIN ECS7.dbo.Stock_Products AS stock_product
    ON stock_product.Product_Id = p.Product_Id
OUTER APPLY (
    SELECT SUM(CONVERT(bigint, store.Stock_Quantity)) AS Stock_Quantity
    FROM ECS7.dbo.Store_Products AS store
    WHERE store.Product_Id = p.Product_Id
      AND store.Location_Id = p.Managing_Location
) AS store_totals
OUTER APPLY (
    SELECT TOP (1) pp.*
    FROM ECS7.dbo.Product_Pricing AS pp
    WHERE pp.Product_Id = p.Product_Id
      AND pp.Price_Zone = loc.Price_Zone
      AND pp.Effective_Date <= @AsOf
    ORDER BY pp.Effective_Date DESC, pp.Last_Modified DESC
) AS pricing
OUTER APPLY (
    SELECT TOP (1) supplier_link.*
    FROM ECS7.dbo.Product_Suppliers AS supplier_link
    WHERE supplier_link.Product_Id = p.Product_Id
      AND supplier_link.Deleted = 0
    ORDER BY supplier_link.Preferred_Supplier DESC,
             supplier_link.Supplier_Id
) AS ps
LEFT JOIN ECS7.dbo.Suppliers AS supplier
    ON supplier.Supplier_Id = ps.Supplier_Id
WHERE p.Managing_Location = @LocationId
ORDER BY p.Product_Name, p.Product_Id, b.Barcode, s.Stock_Location;

/*
  Reorder minimum and maximum are from Stock_Products. Warehouse-specific
  Store_Products.Reorder_Level is not collapsed into a single import field.
  Compare both kinds of reorder setting with saved values in the Embed UI
  before mapping Reorder Point or Reorder Qty in the destination template.
*/
