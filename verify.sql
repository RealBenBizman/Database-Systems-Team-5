USE pos_store;
GO

SELECT COUNT(*) AS tables_created FROM sys.tables;   -- expect 23
SELECT COUNT(*) AS fks FROM sys.foreign_keys;
SELECT name FROM sys.tables ORDER BY name;