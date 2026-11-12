/*
   create_app_user_azure.sql - the limited database user the Node.js app connects with (Azure SQL Database)

   Azure SQL Database version of create_app_login.sql. There is no master step: the user
   lives inside the pos_store database ("contained user") and signs in with its own password.

   Why: the app must not use the server admin account. This user can read, insert and
   update, run stored procedures, and delete ONLY cart rows (everything else is soft
   delete, see Marked_for_deletion).

   Before running:
     1) Replace ChangeThisPassword!1 below with a long random password (Azure requires upper
        and lower case, a digit and a symbol). Put the same value in Vercel as DB_PASSWORD
        and in .env.local. Never commit the real one: keep the placeholder in Git.
     2) Connect to the pos_store database (not master) as the server admin, run the
        schema, triggers, views and the other parts' SQL first, then run this file.
     3) Use DB_USER=pos_app. No @server suffix is needed.
*/

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'pos_app')
    CREATE USER pos_app WITH PASSWORD = 'ChangeThisPassword!1';
GO

GRANT SELECT, INSERT, UPDATE ON SCHEMA::dbo TO pos_app;   -- all tables and views
GRANT EXECUTE                ON SCHEMA::dbo TO pos_app;   -- stored procedures (sp_Checkout)
GRANT DELETE                 ON dbo.CART_ITEM TO pos_app; -- the one table whose rows are really deleted
GO

-- Check (expect SELECT 1, UPDATE 1, DELETE on PRODUCT 0, DELETE on CART_ITEM 1):
EXECUTE AS USER = 'pos_app';
SELECT HAS_PERMS_BY_NAME('dbo.PRODUCT',   'OBJECT', 'SELECT') AS can_select,
       HAS_PERMS_BY_NAME('dbo.PRODUCT',   'OBJECT', 'UPDATE') AS can_update,
       HAS_PERMS_BY_NAME('dbo.PRODUCT',   'OBJECT', 'DELETE') AS can_delete_product,
       HAS_PERMS_BY_NAME('dbo.CART_ITEM', 'OBJECT', 'DELETE') AS can_delete_cart;
REVERT;
GO
