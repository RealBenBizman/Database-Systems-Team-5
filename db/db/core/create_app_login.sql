USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'pos_app')
    CREATE LOGIN pos_app WITH PASSWORD = 'ChangeThisPassword!', CHECK_POLICY = ON;
GO

USE pos_store;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'pos_app')
    CREATE USER pos_app FOR LOGIN pos_app;
GO

GRANT SELECT, INSERT, UPDATE ON SCHEMA::dbo TO pos_app;
GRANT EXECUTE                ON SCHEMA::dbo TO pos_app;
GRANT DELETE                 ON dbo.CART_ITEM TO pos_app;

EXECUTE AS USER = 'pos_app';
SELECT HAS_PERMS_BY_NAME('dbo.PRODUCT',  'OBJECT', 'SELECT') AS can_select,
       HAS_PERMS_BY_NAME('dbo.PRODUCT',  'OBJECT', 'UPDATE') AS can_update,
       HAS_PERMS_BY_NAME('dbo.PRODUCT',  'OBJECT', 'DELETE') AS can_delete_product,
       HAS_PERMS_BY_NAME('dbo.CART_ITEM',  'OBJECT', 'DELETE') AS can_delete_cart;
REVERT;
GO