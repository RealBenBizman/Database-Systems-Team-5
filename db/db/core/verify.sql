/*
   verify.sql - checks that the database matches the final design

   Run it after schema.sql and triggers.sql (before or after seed.sql).
   It does not change anything. Result sets, in order:
     1) a PASS/FAIL grid of structure counts
     2) the status of every trigger the project plans to have (13 in total)
     3) triggers found in the database that are not on that list (should be empty)
     4) the list of table names

   The expected numbers were counted from schema.sql: 27 tables, 43 foreign keys,
   74 CHECK constraints, 6 UNIQUE constraints, 21 identity columns. The identity
   check counts only columns that belong to your own tables (it joins to
   sys.tables). If the schema file changes, update the numbers here.

   Soft delete: every table has Marked_for_deletion BIT NOT NULL DEFAULT 0, and
   every foreign key is ON DELETE NO ACTION / ON UPDATE NO ACTION (no SET NULL,
   no CASCADE). The grid checks both.

   @expected_triggers is 6 today (the 5 first triggers + TR_SALES_TRANSACTION_StatusFlow).
   Change it to 13 when every part's triggers have been merged.
*/
USE pos_store;
GO

SET NOCOUNT ON;

DECLARE @expected_triggers INT = 6;

DECLARE @tables  TABLE (Table_name SYSNAME PRIMARY KEY);
DECLARE @planned TABLE (Trigger_name SYSNAME PRIMARY KEY, Planned_in NVARCHAR(40));
DECLARE @r       TABLE (Seq INT IDENTITY(1,1), Item NVARCHAR(80), Expected NVARCHAR(40), Actual NVARCHAR(40));

INSERT INTO @tables (Table_name)
VALUES ('CART_ITEM'), ('CATEGORY'), ('CUSTOMER'), ('CUSTOMER_ADDRESS'), ('CUSTOMER_PHONE'),
       ('DISCOUNT'), ('EMPLOYEE'), ('INVENTORY_ADJUSTMENT'), ('LOW_STOCK_ALERT'),
       ('LOYALTY_TRANSACTION'), ('NOTIFICATION'), ('PAYMENT'), ('PRICE_CHANGE'), ('PRODUCT'),
       ('PRODUCT_RETURN'), ('PRODUCT_RETURN_ITEM'), ('REVIEW'), ('REWARD_PROGRAM'), ('REWARD_TIER'),
       ('SALE_EVENT'), ('SALES_TRANSACTION'), ('SUPPLIER'), ('SUPPLIER_ORDER'), ('SUPPLIER_ORDER_ITEM'),
       ('SUPPLIER_PRODUCT'), ('TAX_RATE'), ('TRANSACTION_ITEM');

INSERT INTO @planned (Trigger_name, Planned_in)
VALUES ('TR_SALES_TRANSACTION_Complete',      'Built: trigger 1'),
       ('TR_LOYALTY_TRANSACTION_Balance',     'Built: trigger 2'),
       ('TR_PRODUCT_LowStock',                'Built: trigger 3'),
       ('TR_SUPPLIER_ORDER_Received',         'Built: trigger 4'),
       ('TR_REWARD_PROGRAM_NoOverlap',        'Built: trigger 5'),
       ('TR_SALES_TRANSACTION_StatusFlow',    'Part 0'),
       ('TR_REVIEW_Guard',                    'Part 1'),
       ('TR_TRANSACTION_ITEM_Guard',          'Part 2'),
       ('TR_PAYMENT_Guard',                   'Part 2'),
       ('TR_SALES_TRANSACTION_PaymentCheck',  'Part 2'),
       ('TR_PRODUCT_RETURN_ITEM_Guard',       'Part 3'),
       ('TR_PRODUCT_RETURN_Refunded',         'Part 3'),
       ('TR_INVENTORY_ADJUSTMENT_Apply',      'Part 4');

INSERT INTO @r (Item, Expected, Actual)
VALUES (N'Tables', '27',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.tables)),
       (N'Expected table names missing', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM @tables x
         WHERE NOT EXISTS (SELECT 1 FROM sys.tables t WHERE t.name = x.Table_name))),
       (N'Tables that are not on the expected list', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.tables t
         WHERE NOT EXISTS (SELECT 1 FROM @tables x WHERE x.Table_name = t.name))),
       (N'Views (VW_CART)', '1',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.views WHERE is_ms_shipped = 0)),
       (N'Foreign keys', '43',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.foreign_keys)),
       (N'Foreign keys with any action other than NO ACTION (must be 0)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.foreign_keys
         WHERE delete_referential_action <> 0 OR update_referential_action <> 0)),
       (N'Tables without Marked_for_deletion (must be 0)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.tables t
         WHERE NOT EXISTS (SELECT 1 FROM sys.columns c
                           WHERE c.object_id = t.object_id AND c.name = 'Marked_for_deletion'))),
       (N'Marked_for_deletion columns that are not BIT NOT NULL DEFAULT 0', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.columns c
         JOIN sys.tables t ON t.object_id = c.object_id
         WHERE c.name = 'Marked_for_deletion'
           AND (c.system_type_id <> 104 OR c.is_nullable = 1
                OR NOT EXISTS (SELECT 1 FROM sys.default_constraints d
                               WHERE d.parent_object_id = c.object_id
                                 AND d.parent_column_id = c.column_id
                                 AND d.definition = '((0))')))),
       (N'CHECK constraints', '74',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.check_constraints)),
       (N'UNIQUE constraints', '6',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.key_constraints WHERE type = 'UQ')),
       (N'Identity columns (on user tables)', '21',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.identity_columns ic
         JOIN sys.tables t ON t.object_id = ic.object_id
         WHERE t.is_ms_shipped = 0)),
       (N'User triggers', CAST(@expected_triggers AS NVARCHAR(40)),
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.triggers WHERE parent_class = 1)),
       (N'Disabled triggers (must be 0)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.triggers WHERE parent_class = 1 AND is_disabled = 1)),
       (N'Nested triggers (server setting, must be 1)', '1',
        (SELECT CAST(value_in_use AS NVARCHAR(40)) FROM sys.configurations WHERE name = 'nested triggers'));

-- 1) structure grid
SELECT Item, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result
FROM   @r
ORDER BY Seq;

-- 2) every planned trigger: built, disabled or still to come
SELECT p.Trigger_name, p.Planned_in,
       OBJECT_NAME(t.parent_id) AS On_table,
       CASE WHEN t.object_id IS NULL THEN 'not built yet'
            WHEN t.is_disabled = 1   THEN 'DISABLED'
            ELSE 'ok' END AS Status
FROM   @planned p
LEFT JOIN sys.triggers t ON t.name = p.Trigger_name AND t.parent_class = 1
ORDER BY CASE WHEN t.object_id IS NULL THEN 1 ELSE 0 END, p.Planned_in, p.Trigger_name;

-- 3) triggers in the database that nobody planned (expect no rows)
SELECT t.name AS Unplanned_trigger, OBJECT_NAME(t.parent_id) AS On_table
FROM   sys.triggers t
WHERE  t.parent_class = 1
  AND  NOT EXISTS (SELECT 1 FROM @planned p WHERE p.Trigger_name = t.name);

-- 4) table names
SELECT name AS table_name FROM sys.tables ORDER BY name;
GO