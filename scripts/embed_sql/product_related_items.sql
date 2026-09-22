/*
  Embed ECS7 related product rows for the Senmox import test.
  Read-only. Export each result set separately; do not join these independent
  one-to-many relationships together, or barcode x supplier x warehouse rows
  will multiply. Re-run all result sets before go-live.
*/
DECLARE @LocationId int = 585101;

/* Result set 1: every barcode, numbered within its product. */
SELECT
    CONVERT(varchar(30), p.Product_Id) AS Product_Id,
    ROW_NUMBER() OVER (
        PARTITION BY p.Product_Id ORDER BY b.Barcode
    ) AS Barcode_Number,
    b.Barcode,
    b.Item_Id
FROM ECS7.dbo.Product_Master_List AS p
JOIN ECS7.dbo.Product_Barcodes AS b
    ON b.Product_Id = p.Product_Id
WHERE p.Managing_Location = @LocationId
  AND p.Active_Product = 1
  AND p.Deleted = 0
ORDER BY p.Product_Id, Barcode_Number;

/* Result set 2: every non-deleted supplier, preferred supplier first. */
SELECT
    CONVERT(varchar(30), p.Product_Id) AS Product_Id,
    ROW_NUMBER() OVER (
        PARTITION BY p.Product_Id
        ORDER BY ps.Preferred_Supplier DESC, ps.Supplier_Id
    ) AS Supplier_Number,
    ps.Supplier_Id,
    s.Supplier_Name,
    ps.Preferred_Supplier,
    ps.Product_Supplier_Code,
    ps.Container_Id,
    ps.Container_Quantity,
    ps.Container_Price
FROM ECS7.dbo.Product_Master_List AS p
JOIN ECS7.dbo.Product_Suppliers AS ps
    ON ps.Product_Id = p.Product_Id
   AND ps.Deleted = 0
LEFT JOIN ECS7.dbo.Suppliers AS s
    ON s.Supplier_Id = ps.Supplier_Id
WHERE p.Managing_Location = @LocationId
  AND p.Active_Product = 1
  AND p.Deleted = 0
ORDER BY p.Product_Id, Supplier_Number;

/* Result set 3: every location/warehouse stock row. */
SELECT
    CONVERT(varchar(30), p.Product_Id) AS Product_Id,
    ROW_NUMBER() OVER (
        PARTITION BY p.Product_Id ORDER BY sp.Location_Id, sp.Warehouse_Id
    ) AS Stock_Row_Number,
    sp.Location_Id,
    sp.Warehouse_Id,
    sp.Stock_Quantity,
    sp.Reorder_Level,
    sp.Last_Purchase_Price,
    sp.Average_Unit_Cost
FROM ECS7.dbo.Product_Master_List AS p
JOIN ECS7.dbo.Store_Products AS sp
    ON sp.Product_Id = p.Product_Id
WHERE p.Managing_Location = @LocationId
  AND p.Active_Product = 1
  AND p.Deleted = 0
ORDER BY p.Product_Id, Stock_Row_Number;
