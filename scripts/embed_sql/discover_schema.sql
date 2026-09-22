/*
  Read-only Embed SQL Server catalog discovery.

  Run this while connected to the intended Embed database. It reads metadata
  and allocation statistics only; it does not read business rows or modify the
  database. Save every result set for the extraction design review.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

SELECT
    @@SERVERNAME AS server_name,
    DB_NAME() AS database_name,
    SERVERPROPERTY('ProductVersion') AS product_version,
    SERVERPROPERTY('ProductLevel') AS product_level,
    SERVERPROPERTY('Edition') AS edition,
    d.compatibility_level,
    d.collation_name,
    d.snapshot_isolation_state_desc,
    d.is_read_committed_snapshot_on
FROM sys.databases AS d
WHERE d.database_id = DB_ID();

SELECT
    s.name AS schema_name,
    o.name AS object_name,
    o.type_desc AS object_type,
    SUM(CASE WHEN p.index_id IN (0, 1) THEN p.row_count ELSE 0 END) AS approximate_row_count,
    o.create_date,
    o.modify_date
FROM sys.objects AS o
JOIN sys.schemas AS s
  ON s.schema_id = o.schema_id
LEFT JOIN sys.dm_db_partition_stats AS p
  ON p.object_id = o.object_id
WHERE o.type IN ('U', 'V')
  AND o.is_ms_shipped = 0
GROUP BY s.name, o.name, o.type_desc, o.create_date, o.modify_date
ORDER BY approximate_row_count DESC, s.name, o.name;

SELECT
    s.name AS schema_name,
    o.name AS object_name,
    o.type_desc AS object_type,
    c.column_id,
    c.name AS column_name,
    t.name AS data_type,
    c.max_length,
    c.precision,
    c.scale,
    c.is_nullable,
    c.is_identity,
    c.is_computed,
    dc.definition AS default_definition
FROM sys.objects AS o
JOIN sys.schemas AS s
  ON s.schema_id = o.schema_id
JOIN sys.columns AS c
  ON c.object_id = o.object_id
JOIN sys.types AS t
  ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints AS dc
  ON dc.object_id = c.default_object_id
WHERE o.type IN ('U', 'V')
  AND o.is_ms_shipped = 0
ORDER BY s.name, o.name, c.column_id;

SELECT
    s.name AS schema_name,
    t.name AS table_name,
    kc.name AS primary_key_name,
    ic.key_ordinal,
    c.name AS column_name
FROM sys.key_constraints AS kc
JOIN sys.tables AS t
  ON t.object_id = kc.parent_object_id
JOIN sys.schemas AS s
  ON s.schema_id = t.schema_id
JOIN sys.index_columns AS ic
  ON ic.object_id = t.object_id
 AND ic.index_id = kc.unique_index_id
JOIN sys.columns AS c
  ON c.object_id = t.object_id
 AND c.column_id = ic.column_id
WHERE kc.type = 'PK'
ORDER BY s.name, t.name, ic.key_ordinal;

SELECT
    fk.name AS foreign_key_name,
    OBJECT_SCHEMA_NAME(fk.parent_object_id) AS child_schema,
    OBJECT_NAME(fk.parent_object_id) AS child_table,
    pc.name AS child_column,
    OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS parent_schema,
    OBJECT_NAME(fk.referenced_object_id) AS parent_table,
    rc.name AS parent_column,
    fkc.constraint_column_id
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc
  ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns AS pc
  ON pc.object_id = fkc.parent_object_id
 AND pc.column_id = fkc.parent_column_id
JOIN sys.columns AS rc
  ON rc.object_id = fkc.referenced_object_id
 AND rc.column_id = fkc.referenced_column_id
ORDER BY child_schema, child_table, fk.name, fkc.constraint_column_id;

SELECT
    s.name AS schema_name,
    o.name AS object_name,
    c.name AS candidate_column,
    t.name AS data_type
FROM sys.objects AS o
JOIN sys.schemas AS s
  ON s.schema_id = o.schema_id
JOIN sys.columns AS c
  ON c.object_id = o.object_id
JOIN sys.types AS t
  ON t.user_type_id = c.user_type_id
WHERE o.type IN ('U', 'V')
  AND o.is_ms_shipped = 0
  AND (
       c.name LIKE '%card%'
    OR c.name LIKE '%barcode%'
    OR c.name LIKE '%game%'
    OR c.name LIKE '%play%'
    OR c.name LIKE '%ticket%'
    OR c.name LIKE '%product%'
    OR c.name LIKE '%sale%'
    OR c.name LIKE '%load%'
    OR c.name LIKE '%transfer%'
    OR c.name LIKE '%recycl%'
    OR c.name LIKE '%balance%'
    OR c.name LIKE '%cashier%'
    OR c.name LIKE '%employeAe%'
    OR c.name LIKE '%terminal%'
    OR c.name LIKE '%location%'
    OR c.name LIKE '%date%'
    OR c.name LIKE '%time%'
  )
ORDER BY s.name, o.name, c.column_id;

SELECT
    s.name AS schema_name,
    v.name AS view_name,
    m.definition
FROM sys.views AS v
JOIN sys.schemas AS s
  ON s.schema_id = v.schema_id
LEFT JOIN sys.sql_modules AS m
  ON m.object_id = v.object_id
WHERE v.is_ms_shipped = 0
ORDER BY s.name, v.name;
