/*
   drop.sql - removes every table and view of the POS database
   (keeps the database, its users and permissions).

   Dropping a table also drops the triggers on it, so triggers.sql
   must be run again after the schema file.

   Order matters: the views first (VW_CART and the 4 report views), then tables
   CHILDREN FIRST because of the foreign keys. Keep this list in sync with the
   schema file (27 tables).

   Rebuild order:  drop.sql -> schema.sql -> triggers.sql -> views.sql -> (optional) tests -> seed.sql
*/
USE pos_store;
GO

-- Safety check: stop if this is not the POS database
IF DB_NAME() <> 'pos_store'
BEGIN
    RAISERROR('Not connected to pos_store. Nothing was dropped.', 16, 1);
    SET NOEXEC ON;
END
GO

-- Views (the report views read the tables, so they go first)
DROP VIEW IF EXISTS VW_REWARDS_REPORT;
DROP VIEW IF EXISTS VW_INVENTORY_REPORT;
DROP VIEW IF EXISTS VW_SALES_BY_CATEGORY;
DROP VIEW IF EXISTS VW_SALES_REPORT;
DROP VIEW IF EXISTS VW_CART;
DROP PROCEDURE IF EXISTS sp_Checkout;
GO

-- Tables, children first
DROP TABLE IF EXISTS PRODUCT_RETURN_ITEM;
DROP TABLE IF EXISTS NOTIFICATION;
DROP TABLE IF EXISTS LOYALTY_TRANSACTION;
DROP TABLE IF EXISTS REVIEW;
DROP TABLE IF EXISTS PAYMENT;
DROP TABLE IF EXISTS TRANSACTION_ITEM;
DROP TABLE IF EXISTS CART_ITEM;
DROP TABLE IF EXISTS PRODUCT_RETURN;
DROP TABLE IF EXISTS SALES_TRANSACTION;
DROP TABLE IF EXISTS PRICE_CHANGE;
DROP TABLE IF EXISTS INVENTORY_ADJUSTMENT;
DROP TABLE IF EXISTS LOW_STOCK_ALERT;
DROP TABLE IF EXISTS SUPPLIER_ORDER_ITEM;
DROP TABLE IF EXISTS SUPPLIER_ORDER;
DROP TABLE IF EXISTS SUPPLIER_PRODUCT;
DROP TABLE IF EXISTS TAX_RATE;
DROP TABLE IF EXISTS PRODUCT;
DROP TABLE IF EXISTS CUSTOMER_PHONE;
DROP TABLE IF EXISTS CATEGORY;
DROP TABLE IF EXISTS CUSTOMER_ADDRESS;
DROP TABLE IF EXISTS CUSTOMER;
DROP TABLE IF EXISTS DISCOUNT;
DROP TABLE IF EXISTS REWARD_TIER;
DROP TABLE IF EXISTS SUPPLIER;
DROP TABLE IF EXISTS SALE_EVENT;
DROP TABLE IF EXISTS REWARD_PROGRAM;
DROP TABLE IF EXISTS EMPLOYEE;
GO

SET NOEXEC OFF;
GO

-- Check: both counts must be 0 before you run the schema file again
SELECT (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped = 0) AS tables_left,
       (SELECT COUNT(*) FROM sys.views  WHERE is_ms_shipped = 0) AS views_left;
GO