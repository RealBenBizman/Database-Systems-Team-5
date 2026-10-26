USE pos_store;
GO

SELECT COUNT(*) AS tables_created FROM sys.tables;
SELECT COUNT(*) AS fks FROM sys.foreign_keys;
SELECT name FROM sys.tables ORDER BY name;