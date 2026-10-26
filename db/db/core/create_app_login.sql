-- Part 1: run in master
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'pos_app')
    CREATE LOGIN pos_app WITH PASSWORD = 'ChangeThisPassword!', CHECK_POLICY = ON;
GO

-- Part 2: run in pos_store
USE pos_store;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'pos_app')
    CREATE USER pos_app FOR LOGIN pos_app;
GO

GRANT SELECT, INSERT, UPDATE ON SCHEMA::dbo TO pos_app;   -- all tables and the view
GRANT EXECUTE                ON SCHEMA::dbo TO pos_app;   -- stored procedures added later
GRANT DELETE                 ON dbo.CART_ITEM TO pos_app; --the one table whose rows are really deleted

-- Check (expect 1, 1, 0, 1):
EXECUTE AS USER = 'pos_app';
SELECT HAS_PERMS_BY_NAME('dbo.PRODUCT',  'OBJECT', 'SELECT') AS can_select,
       HAS_PERMS_BY_NAME('dbo.PRODUCT',  'OBJECT', 'UPDATE') AS can_update,
       HAS_PERMS_BY_NAME('dbo.PRODUCT',  'OBJECT', 'DELETE') AS can_delete_product,
       HAS_PERMS_BY_NAME('dbo.CART_ITEM',  'OBJECT', 'DELETE') AS can_delete_cart;
REVERT;
GO