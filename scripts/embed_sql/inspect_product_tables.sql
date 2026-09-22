/* Run in SSMS with ECS7 selected. All statements are read-only. */

/* 1. Complete columns for product, stock, location, price, and supplier joins. */
SELECT
    s.name AS Schema_Name,
    o.name AS Object_Name,
    o.type_desc AS Object_Type,
    c.column_id AS Column_Id,
    c.name AS Column_Name,
    TYPE_NAME(c.user_type_id) AS Data_Type,
    c.is_nullable AS Is_Nullable
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.columns AS c ON c.object_id = o.object_id
WHERE o.type IN ('U', 'V')
  AND o.name IN (
      'Locations', 'Product_Master_List', 'Product_Barcodes',
      'Product_Pricing', 'Product_Suppliers', 'Suppliers',
      'ECS_Stock_On_Hand', 'Stock_Products', 'Store_Products',
      'Product_Categories', 'Product_Classes'
  )
ORDER BY s.name, o.name, c.column_id;

/* 2. Declared unique indexes and foreign keys among those objects. */
SELECT
    OBJECT_SCHEMA_NAME(i.object_id) AS Schema_Name,
    OBJECT_NAME(i.object_id) AS Table_Name,
    i.name AS Index_Name,
    i.is_primary_key AS Is_Primary_Key,
    i.is_unique AS Is_Unique,
    ic.key_ordinal AS Key_Ordinal,
    c.name AS Column_Name
FROM sys.indexes AS i
JOIN sys.index_columns AS ic
  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c
  ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id IN (
    OBJECT_ID('dbo.Locations'), OBJECT_ID('dbo.Product_Master_List'),
    OBJECT_ID('dbo.Product_Barcodes'), OBJECT_ID('dbo.Product_Pricing'),
    OBJECT_ID('dbo.Product_Suppliers'), OBJECT_ID('dbo.Suppliers'),
    OBJECT_ID('dbo.Stock_Products'), OBJECT_ID('dbo.Store_Products')
)
  AND (i.is_primary_key = 1 OR i.is_unique = 1)
  AND ic.key_ordinal > 0
ORDER BY Schema_Name, Table_Name, i.name, ic.key_ordinal;

SELECT
    fk.name AS Foreign_Key,
    OBJECT_NAME(fk.parent_object_id) AS Child_Table,
    pc.name AS Child_Column,
    OBJECT_NAME(fk.referenced_object_id) AS Parent_Table,
    rc.name AS Parent_Column
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc
  ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns AS pc
  ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.columns AS rc
  ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE fk.parent_object_id IN (
    OBJECT_ID('dbo.Product_Barcodes'), OBJECT_ID('dbo.Product_Pricing'),
    OBJECT_ID('dbo.Product_Suppliers'), OBJECT_ID('dbo.Stock_Products'),
    OBJECT_ID('dbo.Store_Products')
)
ORDER BY Child_Table, Foreign_Key, fkc.constraint_column_id;

/* 3. Product shown on the Product Details screenshot. Its UI had unsaved changes. */
DECLARE @ExampleProductId bigint = 5851010110000326;

SELECT TOP (20) *
FROM dbo.Product_Pricing
WHERE Product_Id = @ExampleProductId
ORDER BY Effective_Date DESC, Price_Zone;

SELECT TOP (20) *
FROM dbo.Product_Suppliers
WHERE Product_Id = @ExampleProductId
ORDER BY Preferred_Supplier DESC, Supplier_Id;

SELECT TOP (20) *
FROM dbo.Product_Barcodes
WHERE Product_Id = @ExampleProductId
ORDER BY Barcode;

/* 4. Small examples showing the keys in the two reorder tables. */
SELECT TOP (10) * FROM dbo.Stock_Products;
SELECT TOP (10) * FROM dbo.Store_Products;
