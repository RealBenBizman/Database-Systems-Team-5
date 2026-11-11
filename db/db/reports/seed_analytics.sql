/*
   seed_analytics.sql - six months of demo data for the reports (REP-0, db/reports)

   WHY
     The core seed has 8 sales, 7 customers and no returns or supplier history, so every report page is
     empty or flat. This file adds enough history for the four reports (sales, customers, inventory,
     returns) to show real trends, comparisons, backlogs and late suppliers.

   WHEN TO RUN
     Once, on a database that already has db/core/schema.sql, triggers.sql and seed.sql (and optionally
     the loyalty and catalog scripts). It adds data only: no table, view or trigger is changed, and
     nothing that exists is edited, except that the stock of products and the open/closed low-stock
     alerts are brought back in line at the end (see STOCK below).
     Run it as one piece (there is no GO). It stops with a clear message, before changing anything, if
     it was already run or if something it needs is missing.

   REHEARSAL (the rolled-back test)
     Set @dry to 1 on the first line below and run it. Everything is built, the check grid is printed,
     and then ALL of it is rolled back. Set it back to 0 for the real run.

   WHAT IT CREATES
     70 customers      emails first.lastNN@analytics.posstore.test, password Password123!, one default
                       home address each in TX, CA, NY or FL. 8 heavy, 30 regular and 32 light buyers,
                       10 who joined long ago, about a quarter of the light ones stop buying part-way.
     ~550 sales        spread over the last 179 days (about 2 a day at first, about 3 a day now, more at
                       weekends and during the current Autumn Sale), built exactly like seed.sql builds
                       them: open sale, items with the price and discount snapshot, tax per line, one card
                       payment for the Total, then UPDATE to completed so the REAL triggers produce
                       the stock, loyalty points, tiers and (not here, see STOCK) alerts.
                       About 45% are in-store sales (an employee is set), the rest are online.
     30 returns        10 refunded (a couple slow), 5 approved, 9 requested (some waiting more than 3
                       days), 6 denied; free-text reasons. One product is returned far more than any
                       other. They go through the same steps the app uses (requested, approved or denied,
                       refunded), so the triggers restock the goods and take the points back.
     suppliers         the 6 suppliers and a link for every product that has none (skipped when they exist)
                       and 17 supplier orders: 12 received (one supplier is always 3 to 9 days late, one
                       always on time), 2 cancelled, 1 pending and 2 on the way, one of them overdue.
     low-stock alerts  one resolved alert per received order, and one open alert on the fast seller
                       (linked to its overdue order).

   WHAT THE REPORTS SHOULD SHOW (these come from the rules below, not from luck)
     - 2 products with no sales at all and 3 that last sold more than 110 days ago (both show as dead
       stock), 3 that are new (first sales in the last 45 days), plus the 5 products that already
       had no demand (they are left out of the sales completely).
     - the fast seller (most units in the last 30 days, among products with a threshold of 30 or less)
       is left with about 4 days of stock, below its supplier's lead time, with an open alert.
     - returns: 8 to 10 refunded, a backlog of requested and approved, some denied, and one product on
       top of the most-returned list.
     - a supplier with late deliveries, and an overdue open order.
     - sales trending up from the first half to the second half of the six months.

   STOCK
     To let the old sales go through (the real trigger refuses a sale for more units than are in
     stock) the stock is raised by the planned quantity first. At the end the stock of every product is
     put back to what it was when the script started, except the fast seller. The two low-stock
     triggers that would otherwise open and close alerts all along the way are paused while this runs
     (TR_PRODUCT_LowStock, TR_CUSTOMER_TierReward) and switched on again before the end; alerts are
     then reconciled with one UPDATE, like the last step of seed.sql.

   RANDOMNESS
     Nothing is random between runs. Every choice comes from a fixed MD5 hash of the item it is about
     (the first 4 bytes of HASHBYTES('MD5', ...) turned into a number between 0 and 1), so the same
     database gives the same data. Dates are relative to the day the script runs.

   CHOICES MADE HERE (not project decisions)
     - A customer who joined less than 180 days ago usually (85%) places a first order within two days
       of signing up. Light buyers are the ones that lapse.
     - Refunds are rounded DOWN to the cent, so they always satisfy the refund guard (trigger 11).
     - TR_CUSTOMER_TierReward stays paused: the customers reach tiers through their points but the
       tier reward (free item) is not created for them.
     - Backdated rows: the sale, payment, loyalty rows, returns and supplier orders carry their real
       dates, not the day the script ran.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @dry   BIT          = 0;       -- 1 = rehearsal: build everything, print the grid, roll it all back
DECLARE @pw    VARCHAR(255) = '$2b$10$6EConWh.yGG.UumoKPOnbuhQe9qQYsvrAhe8UZhCVT/i5VKIw4jhu';  -- Password123!
DECLARE @now   DATETIME2    = SYSDATETIME();
DECLARE @today DATE         = CAST(@now AS DATE);

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Item NVARCHAR(120), Expected NVARCHAR(60), Actual NVARCHAR(60), Pass BIT NULL);

DECLARE @mgr INT, @sup1 INT, @sup2 INT;
DECLARE @fast INT, @fastUnits INT, @fastThr INT, @fastSup INT, @fastLead INT, @fastStock INT;
DECLARE @problem INT, @maxAlert INT, @tierWasOn BIT = 0;
DECLARE @lateSup INT, @goodSup INT, @nSup INT = 0;

-- loop variables: sales
DECLARE @key INT, @cust INT, @when DATETIME2, @method VARCHAR(10), @card CHAR(4), @emp INT, @n INT, @tx INT;
-- loop variables: returns
DECLARE @rkey INT, @rtx INT, @rprod INT, @rn INT, @rq INT, @rstatus VARCHAR(10), @rreason NVARCHAR(200);
DECLARE @rreq DATETIME2, @rref DATETIME2, @rhandler INT, @rid INT, @rL BIGINT, @rS BIGINT, @rT BIGINT, @rR BIGINT, @ramt DECIMAL(10,2);
-- loop variables: supplier orders
DECLARE @ono INT, @osup INT, @odays INT, @ostatus VARCHAR(20), @orecv DATE, @oid INT;

-- Guards: stop before changing anything if the database is not ready

IF EXISTS (SELECT 1 FROM CUSTOMER WHERE Email LIKE '%@analytics.posstore.test')
    THROW 50910, 'Analytics seed stopped: it was already run on this database (customers @analytics.posstore.test exist). Rebuild the database (drop.sql, schema.sql, triggers.sql, seed.sql) to run it again.', 1;

IF (SELECT COUNT(*) FROM sys.triggers
    WHERE parent_class = 1 AND is_disabled = 0
      AND name IN ('TR_SALES_TRANSACTION_Complete', 'TR_LOYALTY_TRANSACTION_Balance', 'TR_PRODUCT_LowStock',
                   'TR_SUPPLIER_ORDER_Received', 'TR_TRANSACTION_ITEM_Guard', 'TR_PAYMENT_GUARD',
                   'TR_SALES_TRANSACTION_PaymentCheck', 'TR_PRODUCT_RETURN_ITEM_Guard',
                   'TR_PRODUCT_RETURN_Refunded')) < 9
    THROW 50911, 'Analytics seed stopped: one of the 9 triggers it relies on is missing or disabled. Run triggers.sql first.', 1;

IF (SELECT CAST(value_in_use AS INT) FROM sys.configurations WHERE name = 'nested triggers') <> 1
    THROW 50911, 'Analytics seed stopped: nested triggers is OFF. The trigger chain needs it ON.', 1;

IF NOT EXISTS (SELECT 1 FROM EMPLOYEE WHERE Role = 'Manager' AND Marked_for_deletion = 0)
    THROW 50912, 'Analytics seed stopped: there is no manager employee. Run db/core/seed.sql first.', 1;

IF NOT EXISTS (SELECT 1 FROM REWARD_PROGRAM
               WHERE Effective_from <= DATEADD(DAY, -190, @today) AND (Effective_to IS NULL OR Effective_to >= @today))
    THROW 50913, 'Analytics seed stopped: no reward program covers the last 190 days up to today, so the sales would earn no points.', 1;

-- Work tables (dropped first so a second run in the same session works)

IF OBJECT_ID('tempdb..#an_num')    IS NOT NULL DROP TABLE #an_num;
IF OBJECT_ID('tempdb..#an_cust')   IS NOT NULL DROP TABLE #an_cust;
IF OBJECT_ID('tempdb..#an_prod0')  IS NOT NULL DROP TABLE #an_prod0;
IF OBJECT_ID('tempdb..#an_prod')   IS NOT NULL DROP TABLE #an_prod;
IF OBJECT_ID('tempdb..#an_stock0') IS NOT NULL DROP TABLE #an_stock0;
IF OBJECT_ID('tempdb..#an_sup')    IS NOT NULL DROP TABLE #an_sup;
IF OBJECT_ID('tempdb..#an_day')    IS NOT NULL DROP TABLE #an_day;
IF OBJECT_ID('tempdb..#an_sale')   IS NOT NULL DROP TABLE #an_sale;
IF OBJECT_ID('tempdb..#an_line')   IS NOT NULL DROP TABLE #an_line;
IF OBJECT_ID('tempdb..#an_ret')    IS NOT NULL DROP TABLE #an_ret;
IF OBJECT_ID('tempdb..#an_so')     IS NOT NULL DROP TABLE #an_so;
IF OBJECT_ID('tempdb..#an_soi')    IS NOT NULL DROP TABLE #an_soi;

BEGIN TRY
    BEGIN TRAN;

    -- Who and what we start from -------------------------------------------------------------------------

    SELECT TOP (1) @mgr = Employee_id FROM EMPLOYEE WHERE Role = 'Manager' AND Marked_for_deletion = 0 ORDER BY Employee_id;
    SELECT @sup1 = MIN(Employee_id), @sup2 = MAX(Employee_id) FROM EMPLOYEE WHERE Role = 'Support' AND Marked_for_deletion = 0;

    -- every product's stock now, to put it back at the end
    SELECT Product_id, Stock_quantity AS Stock0 INTO #an_stock0 FROM PRODUCT;

    -- the numbers 1..400
    SELECT TOP (400) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    INTO   #an_num
    FROM   sys.all_objects a CROSS JOIN sys.all_objects b;

    -- Pause the triggers that would open alerts and give tier rewards while old history is replayed
    SELECT @tierWasOn = CASE WHEN EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_CUSTOMER_TierReward' AND is_disabled = 0) THEN 1 ELSE 0 END;
    IF @tierWasOn = 1 DISABLE TRIGGER TR_CUSTOMER_TierReward ON CUSTOMER;
    DISABLE TRIGGER TR_PRODUCT_LowStock ON PRODUCT;


    -- 1. Customers (70) and one default home address each ------------------------------------------------

    DECLARE @fn TABLE (i INT PRIMARY KEY, v NVARCHAR(50));
    INSERT INTO @fn (i, v)
    VALUES (0, N'Liam'), (1, N'Olivia'), (2, N'Noah'), (3, N'Sofia'), (4, N'Mateo'), (5, N'Ava'), (6, N'Ethan'),
           (7, N'Mia'), (8, N'Lucas'), (9, N'Zoe'), (10, N'Jayden'), (11, N'Nora'), (12, N'Diego'), (13, N'Ivy');

    DECLARE @ln TABLE (i INT PRIMARY KEY, v NVARCHAR(50));
    INSERT INTO @ln (i, v)
    VALUES (0, N'Carter'), (1, N'Rivera'), (2, N'Bennett'), (3, N'Foster'), (4, N'Hayes'),
           (5, N'Kim'), (6, N'Morales'), (7, N'Patel'), (8, N'Reed'), (9, N'Sullivan');

    DECLARE @city TABLE (i INT PRIMARY KEY, State CHAR(2), City NVARCHAR(50), Zip VARCHAR(10));
    INSERT INTO @city (i, State, City, Zip)
    VALUES (0, 'TX', N'Houston', '77002'), (1, 'TX', N'Austin', '78701'), (2, 'CA', N'Los Angeles', '90012'),
           (3, 'CA', N'San Diego', '92101'), (4, 'NY', N'New York', '10013'), (5, 'NY', N'Buffalo', '14202'),
           (6, 'FL', N'Miami', '33132'), (7, 'FL', N'Orlando', '32801');

    DECLARE @street TABLE (i INT PRIMARY KEY, v NVARCHAR(60));
    INSERT INTO @street (i, v)
    VALUES (0, N'Maple Ave'), (1, N'Oak St'), (2, N'Pine Rd'), (3, N'Cedar Ln'),
           (4, N'Elm St'), (5, N'Lake Dr'), (6, N'Hill Blvd'), (7, N'River Way');

    CREATE TABLE #an_cust (
        Seq INT PRIMARY KEY, First_name NVARCHAR(50), Last_name NVARCHAR(50), Email VARCHAR(100),
        Class CHAR(1), Weight DECIMAL(6,2), Legacy BIT, Created_days INT, Lapse_days INT NULL, Has_signup BIT,
        Pay VARCHAR(10), Card CHAR(4), City_idx INT, Customer_id INT NULL);

    -- class: 8 heavy (H), 30 regular (R), 32 light (L); legacy: 10 customers who joined 181 to 300 days ago
    ;WITH nums AS (
        SELECT TOP (70) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS Seq
        FROM sys.all_objects o1 CROSS JOIN sys.all_objects o2
    ), base AS (
        SELECT nums.Seq, fn.v AS First_name, ln.v AS Last_name,
               ROW_NUMBER() OVER (ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('class', '|', nums.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT))  AS Class_rank,
               ROW_NUMBER() OVER (ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('legacy', '|', nums.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS Legacy_rank
        FROM   nums
        JOIN   @fn fn ON fn.i = (nums.Seq - 1) % 14
        JOIN   @ln ln ON ln.i = (nums.Seq - 1) % 10
    ), typed AS (
        SELECT b.*,
               CASE WHEN b.Class_rank <= 8 THEN 'H' WHEN b.Class_rank <= 38 THEN 'R' ELSE 'L' END AS Class,
               CASE WHEN b.Legacy_rank <= 10 THEN 1 ELSE 0 END AS Legacy
        FROM   base b
    )
    INSERT INTO #an_cust (Seq, First_name, Last_name, Email, Class, Weight, Legacy, Created_days, Lapse_days, Has_signup,
                          Pay, Card, City_idx)
    SELECT t.Seq, t.First_name, t.Last_name,
           CONCAT(LOWER(t.First_name), '.', LOWER(t.Last_name), RIGHT(CONCAT('0', t.Seq), 2), '@analytics.posstore.test'),
           t.Class,
           CASE t.Class WHEN 'H' THEN 8 WHEN 'R' THEN 3 ELSE 1 END,
           t.Legacy,
           CASE WHEN t.Legacy = 1 THEN 181 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('legdays', '|', t.Seq)), 1, 4)) % 1000000) % 120
                ELSE 3 + CAST(FLOOR(175 * POWER(CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('created', '|', t.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT), 0.85)) AS INT) END,
           CASE WHEN t.Class = 'L' AND CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('lapse', '|', t.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.45 THEN 20 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('lapsed', '|', t.Seq)), 1, 4)) % 1000000) % 100 END,
           CASE WHEN t.Legacy = 0 AND CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('signup', '|', t.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.85 THEN 1 ELSE 0 END,
           CASE WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('pay', '|', t.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.62 THEN 'credit' ELSE 'debit' END,
           CAST(1000 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('card', '|', t.Seq)), 1, 4)) % 1000000) % 9000 AS CHAR(4)),
           ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('city', '|', t.Seq)), 1, 4)) % 1000000) % 8
    FROM   typed t;

    INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash, Created_date, Notify_offers, Notify_cart)
    SELECT c.First_name, c.Last_name, c.Email, @pw, DATEADD(DAY, -c.Created_days, @today),
           CASE WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('notifyoffers', '|', c.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.8  THEN 1 ELSE 0 END,
           CASE WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('notifycart', '|', c.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.75 THEN 1 ELSE 0 END
    FROM   #an_cust c
    ORDER BY c.Seq;

    UPDATE a SET a.Customer_id = c.Customer_id
    FROM   #an_cust a JOIN CUSTOMER c ON c.Email = a.Email;

    IF EXISTS (SELECT 1 FROM #an_cust WHERE Customer_id IS NULL)
        THROW 50916, 'Analytics seed error: a customer could not be created.', 1;

    INSERT INTO CUSTOMER_ADDRESS (Customer_id, Address_type, Recipient_name, Street, Apt, City, State, Zip, is_default)
    SELECT a.Customer_id, 'home', CONCAT(a.First_name, N' ', a.Last_name),
           CONCAT(100 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('house', '|', a.Seq)), 1, 4)) % 1000000) % 900, N' ', st.v),
           CASE WHEN ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('apt', '|', a.Seq)), 1, 4)) % 1000000) % 5 = 0 THEN CONCAT('Apt ', 1 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('aptno', '|', a.Seq)), 1, 4)) % 1000000) % 40) END,
           ci.City, ci.State, ci.Zip, 1
    FROM   #an_cust a
    JOIN   @city   ci ON ci.i = a.City_idx
    JOIN   @street st ON st.i = ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('street', '|', a.Seq)), 1, 4)) % 1000000) % 8;

    -- about one in eight of the newer customers was referred by an older one
    UPDATE c SET c.Referred_by_id = ref.Customer_id
    FROM   CUSTOMER c
    JOIN   #an_cust a ON a.Customer_id = c.Customer_id
    CROSS APPLY (SELECT TOP (1) b.Customer_id
                 FROM   #an_cust b
                 WHERE  b.Created_days > a.Created_days
                 ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('referrer', '|', a.Seq, '|', b.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) ref
    WHERE  a.Created_days < 150 AND CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('referred', '|', a.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.15;


    -- 2. Products that can sell, and what kind of seller each one is -------------------------------------
    --    Not used: inactive or soft-deleted products, five products that already had no demand, and
    --    categories that do not have exactly one tax rate for TX, CA, NY and FL on every sale date.

    SELECT p.Product_id, p.SKU, p.Sell_price, p.Cost_price, p.Category_id, p.Stock_quantity AS Stock0,
           p.Reorder_threshold,
           CASE WHEN c.Name = N'Gift Cards' THEN 1 ELSE 0 END AS Is_gift,
           ROW_NUMBER() OVER (PARTITION BY CASE WHEN c.Name = N'Gift Cards' THEN 1 ELSE 0 END
                              ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('class', '|', p.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS Rnk
    INTO   #an_prod0
    FROM   PRODUCT p
    JOIN   CATEGORY c ON c.Category_id = p.Category_id AND c.Marked_for_deletion = 0
    WHERE  p.Is_active = 1 AND p.Marked_for_deletion = 0
      AND  p.SKU NOT IN ('COLL-STAT-RARE', 'COLL-POST-LIM', 'MERC-HOOD-L', 'ACC-CHRG-DOC', 'GAME-RETRO-PS4')
      AND  NOT EXISTS (SELECT 1
                       FROM  (VALUES ('TX'), ('CA'), ('NY'), ('FL')) s (State)
                       WHERE (SELECT COUNT(*) FROM TAX_RATE t
                              WHERE  t.Category_id = p.Category_id AND t.State = s.State AND t.Marked_for_deletion = 0
                                AND  t.Effective_from <= DATEADD(DAY, -250, @today)
                                AND  (t.Effective_to IS NULL OR t.Effective_to >= @today)) <> 1);

    -- Class: N normal, H hot (three times as likely to be bought), O old (sold only 110+ days ago),
    --        W new (sold only in the last 45 days), D dead (never sold). Gift cards are always normal.
    SELECT q.Product_id, q.SKU, q.Sell_price, q.Cost_price, q.Category_id, q.Stock0, q.Reorder_threshold, q.Is_gift,
           q.Class,
           CAST(CASE WHEN q.Sell_price < 15 THEN 5.0 WHEN q.Sell_price < 40 THEN 4.0 WHEN q.Sell_price < 100 THEN 2.5
                     WHEN q.Sell_price < 250 THEN 1.2 ELSE 0.7 END
                * CASE WHEN q.Class = 'H' THEN 3 ELSE 1 END
                * CASE WHEN q.Is_gift = 1 THEN 0.5 ELSE 1 END AS DECIMAL(6,2)) AS Weight
    INTO   #an_prod
    FROM  (SELECT p0.*,
                  CASE WHEN p0.Is_gift = 1 THEN 'N' WHEN p0.Rnk <= 3 THEN 'O' WHEN p0.Rnk <= 6 THEN 'W'
                       WHEN p0.Rnk <= 8 THEN 'D' WHEN p0.Rnk <= 11 THEN 'H' ELSE 'N' END AS Class
           FROM   #an_prod0 p0) q;

    IF (SELECT COUNT(*) FROM #an_prod WHERE Class IN ('N', 'H')) < 3
        THROW 50914, 'Analytics seed stopped: fewer than 3 products can be sold (active, with a tax rate for TX, CA, NY and FL).', 1;


    -- 3. Suppliers, and a supplier link for every product that has none ----------------------------------

    DECLARE @map TABLE (Category_name NVARCHAR(100), Supplier_name NVARCHAR(100), Lead INT);
    INSERT INTO @map (Category_name, Supplier_name, Lead)
    VALUES (N'Video Games',  N'Lone Star Game Distributors', 5),
           (N'Consoles',     N'Arcadia Hardware Wholesale',  12),
           (N'Accessories',  N'Gridline Accessories Co.',    7),
           (N'Collectibles', N'Relic & Co. Collectibles',    14),
           (N'Merchandise',  N'Pixel Parade Merchandise',    9),
           (N'Gift Cards',   N'Giftline Prepaid Services',   2);

    INSERT INTO SUPPLIER (Supplier_name, Supplier_email, Supplier_phone, Street_address, Apt_number, City, State, Zip_code)
    SELECT v.Supplier_name, v.Supplier_email, v.Supplier_phone, v.Street_address, NULL, v.City, v.State, v.Zip_code
    FROM (VALUES
        (N'Lone Star Game Distributors', 'orders@lonestargames.example.com',   '2145550141', N'4100 Commerce St',    N'Dallas',   'TX', '75226'),
        (N'Arcadia Hardware Wholesale',  'sales@arcadiahardware.example.com',  '4085550142', N'900 Innovation Way',  N'San Jose', 'CA', '95110'),
        (N'Gridline Accessories Co.',    'orders@gridlineaccessories.example.com', '3125550143', N'250 Wacker Dr',   N'Chicago',  'IL', '60606'),
        (N'Relic & Co. Collectibles',    'trade@reliccollectibles.example.com', '6155550144', N'77 Music Row',       N'Nashville', 'TN', '37203'),
        (N'Pixel Parade Merchandise',    'hello@pixelparade.example.com',      '2065550145', N'1500 Pike Pl',        N'Seattle',  'WA', '98101'),
        (N'Giftline Prepaid Services',   'support@giftline.example.com',       '6025550146', N'33 Central Ave',      N'Phoenix',  'AZ', '85004')
    ) v (Supplier_name, Supplier_email, Supplier_phone, Street_address, City, State, Zip_code)
    WHERE NOT EXISTS (SELECT 1 FROM SUPPLIER s WHERE s.Supplier_name = v.Supplier_name OR s.Supplier_email = v.Supplier_email);

    INSERT INTO SUPPLIER_PRODUCT (Supplier_id, Product_id, Supplier_sku, Unit_cost, Lead_time_days)
    SELECT s.Supplier_id, p.Product_id, LEFT(CONCAT('SUP-', p.SKU), 50), p.Cost_price, m.Lead
    FROM   PRODUCT p
    JOIN   CATEGORY c ON c.Category_id = p.Category_id
    JOIN   @map m     ON m.Category_name = c.Name
    JOIN   SUPPLIER s ON s.Supplier_name = m.Supplier_name AND s.Marked_for_deletion = 0
    WHERE  p.Marked_for_deletion = 0
      AND  NOT EXISTS (SELECT 1 FROM SUPPLIER_PRODUCT sp WHERE sp.Product_id = p.Product_id AND sp.Marked_for_deletion = 0)
      AND  NOT EXISTS (SELECT 1 FROM SUPPLIER_PRODUCT x  WHERE x.Supplier_id = s.Supplier_id AND x.Product_id = p.Product_id);

    -- suppliers that can receive an order (they supply at least one active product); role L late, G reliable, A average
    SELECT d.Supplier_id, s.Supplier_name, ROW_NUMBER() OVER (ORDER BY d.Supplier_id) AS Rk, CAST('A' AS CHAR(1)) AS Role
    INTO   #an_sup
    FROM  (SELECT DISTINCT sp.Supplier_id
           FROM   SUPPLIER_PRODUCT sp
           JOIN   PRODUCT p ON p.Product_id = sp.Product_id AND p.Is_active = 1 AND p.Marked_for_deletion = 0
           WHERE  sp.Marked_for_deletion = 0) d
    JOIN   SUPPLIER s ON s.Supplier_id = d.Supplier_id AND s.Marked_for_deletion = 0;

    SELECT @nSup = COUNT(*) FROM #an_sup;

    IF @nSup > 0
    BEGIN
        SELECT @lateSup = COALESCE((SELECT TOP (1) Supplier_id FROM #an_sup WHERE Supplier_name LIKE N'Relic%' ORDER BY Rk),
                                   (SELECT TOP (1) Supplier_id FROM #an_sup WHERE Rk = 2),
                                   (SELECT TOP (1) Supplier_id FROM #an_sup WHERE Rk = 1));
        SELECT @goodSup = COALESCE((SELECT TOP (1) Supplier_id FROM #an_sup WHERE Supplier_name LIKE N'Lone Star%' ORDER BY Rk),
                                   (SELECT TOP (1) Supplier_id FROM #an_sup WHERE Rk = 1));
        UPDATE #an_sup SET Role = CASE WHEN Supplier_id = @lateSup THEN 'L' WHEN Supplier_id = @goodSup THEN 'G' ELSE 'A' END;
    END;


    -- 4. The plan for the sales -------------------------------------------------------------------------

    CREATE TABLE #an_sale (
        Sale_key INT NULL, Kind CHAR(1) NOT NULL, Cust_seq INT NULL, Days_ago INT NOT NULL, Slot INT NOT NULL,
        Minute_of_day INT NOT NULL, Sale_date DATE NULL, When_dt DATETIME2 NULL, Customer_id INT NULL, Tx_id INT NULL);

    -- (a) first orders: most customers who joined in the last 180 days buy within two days of signing up
    INSERT INTO #an_sale (Kind, Cust_seq, Days_ago, Slot, Minute_of_day)
    SELECT 'S', c.Seq, c.Created_days - ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('signoff', '|', c.Seq)), 1, 4)) % 1000000) % 3, 0, 540 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('signmin', '|', c.Seq)), 1, 4)) % 1000000) % 720
    FROM   #an_cust c
    WHERE  c.Has_signup = 1;

    -- (b) everyone else's orders: a number of orders per day (rising over time, more at weekends and
    --     during the Autumn Sale), each given to one customer
    CREATE TABLE #an_day (Days_ago INT PRIMARY KEY, Cnt INT NOT NULL);
    INSERT INTO #an_day (Days_ago, Cnt)
    SELECT k.n,
           CAST(FLOOR(1.8 + 1.5 * (179 - k.n) / 178.0
                      + CASE WHEN DATEDIFF(DAY, '19000101', DATEADD(DAY, -k.n, @today)) % 7 >= 5 THEN 0.7 ELSE 0 END
                      + CASE WHEN k.n <= 14 THEN 0.8 ELSE 0 END
                      + CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('day', '|', k.n)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS INT)
    FROM   #an_num k
    WHERE  k.n BETWEEN 1 AND 179;

    INSERT INTO #an_sale (Kind, Days_ago, Slot, Minute_of_day)
    SELECT 'B', d.Days_ago, k.n, 540 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('bodymin', '|', d.Days_ago, '|', k.n)), 1, 4)) % 1000000) % 720
    FROM   #an_day d
    JOIN   #an_num k ON k.n <= d.Cnt;

    -- who buys: among the customers who already existed and have not stopped buying, the likelihood
    -- is the customer's weight (heavy 8, regular 3, light 1)
    UPDATE s SET s.Cust_seq = pick.Seq
    FROM   #an_sale s
    CROSS APPLY (SELECT TOP (1) c.Seq
                 FROM   #an_cust c
                 WHERE  c.Created_days > s.Days_ago
                   AND  (c.Lapse_days IS NULL OR s.Days_ago > c.Lapse_days)
                 ORDER BY -LOG(CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('buyer', '|', s.Days_ago, '|', s.Slot, '|', c.Seq)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) / c.Weight) pick
    WHERE  s.Kind = 'B';

    DELETE FROM #an_sale WHERE Cust_seq IS NULL;

    ;WITH x AS (
        SELECT Sale_key, ROW_NUMBER() OVER (ORDER BY Days_ago DESC, Minute_of_day, Kind, Cust_seq, Slot) AS rn
        FROM   #an_sale)
    UPDATE x SET Sale_key = rn;

    UPDATE s SET s.Sale_date   = DATEADD(DAY, -s.Days_ago, @today),
                 s.When_dt     = DATEADD(MINUTE, s.Minute_of_day, CAST(DATEADD(DAY, -s.Days_ago, @today) AS DATETIME2)),
                 s.Customer_id = c.Customer_id
    FROM   #an_sale s
    JOIN   #an_cust c ON c.Seq = s.Cust_seq;

    -- (c) the lines: 1 to 3 different products per sale, drawn by weight among the products that can sell
    --     on that date (a weighted draw without repeats: the smallest -LOG(u)/weight wins)
    CREATE TABLE #an_line (Sale_key INT NOT NULL, Product_id INT NOT NULL, Qty INT NOT NULL, PRIMARY KEY (Sale_key, Product_id));

    ;WITH cand AS (
        SELECT s.Sale_key, p.Product_id, p.Sell_price,
               -LOG(CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('prod', '|', s.Sale_key, '|', p.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) / p.Weight AS Race,
               1 + CASE WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('nlines', '|', s.Sale_key)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.40 THEN 0 WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('nlines', '|', s.Sale_key)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.75 THEN 1 ELSE 2 END AS Wanted
        FROM   #an_sale s
        JOIN   #an_prod p ON p.Class IN ('N', 'H')
                          OR (p.Class = 'O' AND s.Days_ago >= 110)
                          OR (p.Class = 'W' AND s.Days_ago <= 45)
    ), ranked AS (
        SELECT cand.*, ROW_NUMBER() OVER (PARTITION BY Sale_key ORDER BY Race) AS rn FROM cand
    )
    INSERT INTO #an_line (Sale_key, Product_id, Qty)
    SELECT r.Sale_key, r.Product_id,
           CASE WHEN r.Sell_price < 15 THEN 1 + CAST(FLOOR(CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('qty', '|', r.Sale_key, '|', r.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) * 4) AS INT)
                WHEN r.Sell_price < 60 THEN 1 + CASE WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('qty', '|', r.Sale_key, '|', r.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.25 THEN 1 ELSE 0 END
                ELSE 1 END
    FROM   ranked r
    WHERE  r.rn <= r.Wanted;

    -- The fast seller: most units in the last 30 days among products with a small reorder threshold
    SELECT TOP (1) @fast = x.Product_id, @fastUnits = x.Units
    FROM  (SELECT l.Product_id, SUM(l.Qty) AS Units
           FROM   #an_line l
           JOIN   #an_sale s ON s.Sale_key = l.Sale_key AND s.Days_ago <= 30
           JOIN   #an_prod p ON p.Product_id = l.Product_id
           WHERE  p.Class IN ('N', 'H') AND p.Is_gift = 0 AND p.Reorder_threshold BETWEEN 1 AND 30
           GROUP BY l.Product_id) x
    ORDER BY x.Units DESC, x.Product_id;

    IF @fast IS NOT NULL
    BEGIN
        SELECT @fastThr = Reorder_threshold FROM #an_prod WHERE Product_id = @fast;
        SELECT TOP (1) @fastSup = sp.Supplier_id, @fastLead = sp.Lead_time_days
        FROM   SUPPLIER_PRODUCT sp
        WHERE  sp.Product_id = @fast AND sp.Marked_for_deletion = 0
        ORDER BY sp.Unit_cost, sp.Supplier_id;
    END;

    -- The product that gets returned most: the best seller in the return window that is not the fast seller
    SELECT TOP (1) @problem = x.Product_id
    FROM  (SELECT l.Product_id, COUNT(*) AS Lines_n
           FROM   #an_line l
           JOIN   #an_sale s ON s.Sale_key = l.Sale_key AND s.Days_ago BETWEEN 3 AND 110
           JOIN   #an_prod p ON p.Product_id = l.Product_id
           WHERE  p.Class IN ('N', 'H') AND p.Is_gift = 0 AND p.Product_id <> ISNULL(@fast, 0)
           GROUP BY l.Product_id) x
    ORDER BY x.Lines_n DESC, x.Product_id;


    -- 5. Replay the sales the way checkout builds them ---------------------------------------------------

    -- room in stock for every planned unit (put back to the starting stock at the end)
    UPDATE p SET p.Stock_quantity = p.Stock_quantity + b.Qty
    FROM   PRODUCT p
    JOIN  (SELECT Product_id, SUM(Qty) AS Qty FROM #an_line GROUP BY Product_id) b ON b.Product_id = p.Product_id;

    DECLARE sale_cur CURSOR LOCAL STATIC READ_ONLY FOR
        SELECT s.Sale_key, s.Customer_id, s.When_dt, c.Pay, c.Card
        FROM   #an_sale s
        JOIN   #an_cust c ON c.Seq = s.Cust_seq
        ORDER BY s.Days_ago DESC, s.Minute_of_day, s.Sale_key;

    OPEN sale_cur;
    FETCH NEXT FROM sale_cur INTO @key, @cust, @when, @method, @card;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- in-store sales (about 45%) have an employee; online sales do not
        SET @emp = CASE WHEN ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('channel', '|', @key)), 1, 4)) % 1000000) % 100 < 45
                        THEN CASE ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('employee', '|', @key)), 1, 4)) % 1000000) % 3 WHEN 0 THEN @mgr WHEN 1 THEN ISNULL(@sup1, @mgr) ELSE ISNULL(@sup2, @mgr) END
                   END;

        -- 1) open sale, ship-to copied from the customer's default address
        INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Status,
                                       Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
        SELECT @cust, @emp, @when, 'open', a.Recipient_name, a.Street, a.Apt, a.City, a.State, a.Zip
        FROM   CUSTOMER_ADDRESS a
        WHERE  a.Customer_id = @cust AND a.is_default = 1;
        SET @n  = @@ROWCOUNT;
        SET @tx = SCOPE_IDENTITY();
        IF @n <> 1
            THROW 50902, 'Analytics seed error: a customer has no default address.', 1;

        -- 2) items: price snapshot + the single largest percent saving among the product discount and
        --    the category discount (active and in date on the sale date)
        INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
        SELECT @tx, p.Product_id, l.Qty, p.Sell_price, d.Discount_id, ISNULL(d.Saving, 0)
        FROM   #an_line l
        JOIN   PRODUCT  p ON p.Product_id = l.Product_id
        JOIN   CATEGORY c ON c.Category_id = p.Category_id
        OUTER APPLY (SELECT TOP (1) x.Discount_id, x.Saving
                     FROM  (SELECT dd.Discount_id,
                                   ROUND(l.Qty * p.Sell_price * dd.Amount / 100.0, 2) AS Saving
                            FROM   DISCOUNT dd
                            WHERE  dd.Discount_id IN (p.Discount_id, c.Discount_id)
                              AND  dd.Is_active   = 1
                              AND  dd.Amount_type = 'percent'
                              AND  CAST(@when AS DATE) BETWEEN dd.Start_date AND dd.End_date) x
                     ORDER BY x.Saving DESC, x.Discount_id) d
        WHERE  l.Sale_key = @key;

        IF (SELECT COUNT(*) FROM TRANSACTION_ITEM WHERE Transaction_id = @tx)
           <> (SELECT COUNT(*) FROM #an_line WHERE Sale_key = @key)
            THROW 50903, 'Analytics seed error: a planned line was not inserted.', 1;

        -- 3) every line must have exactly one tax rate (category, ship-to state, sale date)
        IF EXISTS (SELECT 1
                   FROM   TRANSACTION_ITEM ti
                   JOIN   PRODUCT p           ON p.Product_id = ti.Product_id
                   JOIN   SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
                   WHERE  ti.Transaction_id = @tx
                     AND  (SELECT COUNT(*) FROM TAX_RATE tr
                           WHERE  tr.Category_id = p.Category_id
                             AND  tr.State = s.Ship_state
                             AND  tr.Marked_for_deletion = 0
                             AND  CAST(s.Transaction_date AS DATE) >= tr.Effective_from
                             AND  (tr.Effective_to IS NULL OR CAST(s.Transaction_date AS DATE) <= tr.Effective_to)) <> 1)
            THROW 50904, 'Analytics seed error: a line has no tax rate (or more than one).', 1;

        -- 4) totals: Subtotal = SUM(Line_total), tax rounded per line, Total = Subtotal + Tax
        UPDATE s
        SET    s.Subtotal   = t.Sub,
               s.Tax_amount = t.Tax,
               s.Total      = t.Sub + t.Tax
        FROM   SALES_TRANSACTION s
        CROSS APPLY (SELECT SUM(ti.Line_total)                     AS Sub,
                            SUM(ROUND(ti.Line_total * tr.Rate, 2)) AS Tax
                     FROM   TRANSACTION_ITEM ti
                     JOIN   PRODUCT  p  ON p.Product_id = ti.Product_id
                     JOIN   TAX_RATE tr ON tr.Category_id = p.Category_id
                                       AND tr.State = s.Ship_state
                                       AND tr.Marked_for_deletion = 0
                                       AND CAST(s.Transaction_date AS DATE) >= tr.Effective_from
                                       AND (tr.Effective_to IS NULL OR CAST(s.Transaction_date AS DATE) <= tr.Effective_to)
                     WHERE  ti.Transaction_id = s.Transaction_id) t
        WHERE  s.Transaction_id = @tx;

        -- 5) one card payment for the full Total, recorded while the sale is still open
        INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4, Paid_at)
        SELECT Transaction_id, @method, Total, @card, @when
        FROM   SALES_TRANSACTION
        WHERE  Transaction_id = @tx;

        -- 6) complete: fires TR_SALES_TRANSACTION_Complete -> stock and a loyalty row (and the tier)
        UPDATE SALES_TRANSACTION
        SET    Status            = 'completed',
               Tracking_number   = CONCAT('TRK-AN-', @key),
               Estimated_arrival = DATEADD(DAY, 5, CAST(@when AS DATE))
        WHERE  Transaction_id = @tx;

        UPDATE #an_sale SET Tx_id = @tx WHERE Sale_key = @key;

        FETCH NEXT FROM sale_cur INTO @key, @cust, @when, @method, @card;
    END;

    CLOSE sale_cur;
    DEALLOCATE sale_cur;

    -- the trigger stamps the loyalty row with the time it ran: give it the day of the sale
    UPDATE l SET l.Created_at = s.Transaction_date
    FROM   LOYALTY_TRANSACTION l
    JOIN   SALES_TRANSACTION s ON s.Transaction_id = l.Transaction_id
    WHERE  l.Reason = N'Purchase'
      AND  l.Transaction_id IN (SELECT Tx_id FROM #an_sale WHERE Tx_id IS NOT NULL);


    -- 6. Returns ----------------------------------------------------------------------------------------
    --    One return per sale. Pool A (30 days or younger, not closed yet): 14 returns, 5 approved and 9
    --    requested. Pool B (older): 16 returns, 10 refunded and 6 denied. The product that is returned
    --    most is favoured in the draw. Gift cards are not returned.

    CREATE TABLE #an_ret (
        Ret_key INT IDENTITY(1,1) PRIMARY KEY, Sale_key INT NOT NULL, Tx_id INT NOT NULL, Product_id INT NOT NULL,
        N INT NOT NULL, Pool CHAR(1) NOT NULL, Score FLOAT NOT NULL,
        Status VARCHAR(10) NULL, Q INT NULL, Reason NVARCHAR(200) NULL, Requested_at DATETIME2 NULL,
        Refunded_at DATETIME2 NULL, Handler INT NULL, Return_id INT NULL);

    DECLARE @reason TABLE (i INT PRIMARY KEY, v NVARCHAR(200));
    INSERT INTO @reason (i, v)
    VALUES (0, N'Defective or damaged'),
           (1, N'Defective: stopped working after a few days'),
           (2, N'Wrong item received'),
           (3, N'Not as described'),
           (4, N'Changed my mind'),
           (5, N'Other: the gift was a duplicate'),
           (6, N'Other: found it cheaper somewhere else'),
           (7, N'Arrived damaged, the box was crushed');

    ;WITH base AS (
        SELECT s.Sale_key, s.Tx_id, l.Product_id, l.Qty,
               CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retA', '|', s.Sale_key, '|', l.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) AS Draw,
               ROW_NUMBER() OVER (PARTITION BY l.Product_id ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retA', '|', s.Sale_key, '|', l.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS Prank
        FROM   #an_sale s
        JOIN   #an_line l ON l.Sale_key = s.Sale_key
        JOIN   #an_prod p ON p.Product_id = l.Product_id AND p.Is_gift = 0
        WHERE  s.Tx_id IS NOT NULL AND s.Days_ago BETWEEN 3 AND 21
    ), sc AS (
        -- the 3 best draws of the most-returned product are always in this pool
        SELECT Sale_key, Tx_id, Product_id, Qty,
               Draw * CASE WHEN Product_id = @problem AND Prank <= 3 THEN 0.01 ELSE 1.0 END AS Score
        FROM   base
    ), one AS (
        SELECT sc.*, ROW_NUMBER() OVER (PARTITION BY Sale_key ORDER BY Score) AS rn FROM sc
    )
    INSERT INTO #an_ret (Sale_key, Tx_id, Product_id, N, Pool, Score)
    SELECT TOP (14) Sale_key, Tx_id, Product_id, Qty, 'A', Score
    FROM   one
    WHERE  rn = 1
    ORDER BY Score, Sale_key;

    ;WITH base AS (
        SELECT s.Sale_key, s.Tx_id, l.Product_id, l.Qty,
               CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retB', '|', s.Sale_key, '|', l.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) AS Draw,
               ROW_NUMBER() OVER (PARTITION BY l.Product_id ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retB', '|', s.Sale_key, '|', l.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS Prank
        FROM   #an_sale s
        JOIN   #an_line l ON l.Sale_key = s.Sale_key
        JOIN   #an_prod p ON p.Product_id = l.Product_id AND p.Is_gift = 0
        WHERE  s.Tx_id IS NOT NULL AND s.Days_ago BETWEEN 9 AND 110
          AND  NOT EXISTS (SELECT 1 FROM #an_ret r WHERE r.Sale_key = s.Sale_key)
    ), sc AS (
        -- the 5 best draws of the most-returned product are always in this pool
        SELECT Sale_key, Tx_id, Product_id, Qty,
               Draw * CASE WHEN Product_id = @problem AND Prank <= 5 THEN 0.01 ELSE 1.0 END AS Score
        FROM   base
    ), one AS (
        SELECT sc.*, ROW_NUMBER() OVER (PARTITION BY Sale_key ORDER BY Score) AS rn FROM sc
    )
    INSERT INTO #an_ret (Sale_key, Tx_id, Product_id, N, Pool, Score)
    SELECT TOP (16) Sale_key, Tx_id, Product_id, Qty, 'B', Score
    FROM   one
    WHERE  rn = 1
    ORDER BY Score, Sale_key;

    -- status inside each pool (random order), the two oldest refunds are the slow ones
    ;WITH x AS (
        SELECT Ret_key, Pool, ROW_NUMBER() OVER (PARTITION BY Pool ORDER BY CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retstatus', '|', Sale_key)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS rk FROM #an_ret
    )
    UPDATE r SET r.Status = CASE WHEN r.Pool = 'A' THEN CASE WHEN x.rk <= 5  THEN 'approved' ELSE 'requested' END
                                 ELSE                   CASE WHEN x.rk <= 10 THEN 'refunded' ELSE 'denied'    END END
    FROM   #an_ret r JOIN x ON x.Ret_key = r.Ret_key;

    UPDATE r SET
        r.Q = CASE WHEN r.N = 1 THEN 1 WHEN CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retq', '|', r.Sale_key)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT) < 0.6 THEN r.N ELSE 1 END,
        r.Reason = rs.v,
        -- asked 1 to 2 days (pool A) or 1 to 4 days (pool B) after the sale, between 10:00 and 18:00
        r.Requested_at = DATEADD(MINUTE, 600 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retmin', '|', r.Sale_key)), 1, 4)) % 1000000) % 480,
                                 CAST(DATEADD(DAY, CASE WHEN r.Pool = 'A' THEN 1 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retday', '|', r.Sale_key)), 1, 4)) % 1000000) % 2
                                                        ELSE 1 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retday', '|', r.Sale_key)), 1, 4)) % 1000000) % 4 END, s.Sale_date) AS DATETIME2)),
        r.Handler = CASE ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('rethandler', '|', r.Sale_key)), 1, 4)) % 1000000) % 3 WHEN 0 THEN ISNULL(@sup2, @mgr) ELSE ISNULL(@sup1, @mgr) END
    FROM   #an_ret r
    JOIN   #an_sale s ON s.Sale_key = r.Sale_key
    JOIN   @reason rs ON rs.i = CASE WHEN r.Product_id = @problem AND ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retreason', '|', r.Sale_key)), 1, 4)) % 1000000) % 10 < 8
                                     THEN ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retreason2', '|', r.Sale_key)), 1, 4)) % 1000000) % 2
                                     ELSE ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retreason3', '|', r.Sale_key)), 1, 4)) % 1000000) % 8 END;

    -- refunded: 1 to 5 days after the request, the two oldest take 9 to 12 days; never later than 6 hours ago
    ;WITH slow AS (
        SELECT r.Ret_key, ROW_NUMBER() OVER (ORDER BY s.Days_ago DESC, r.Ret_key) AS rk
        FROM   #an_ret r JOIN #an_sale s ON s.Sale_key = r.Sale_key
        WHERE  r.Status = 'refunded'
    )
    UPDATE r SET r.Refunded_at =
        CASE WHEN DATEADD(MINUTE, 60 * CASE WHEN slow.rk <= 2 THEN 216 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retslow', '|', r.Sale_key)), 1, 4)) % 1000000) % 72
                                            ELSE 24 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retfast', '|', r.Sale_key)), 1, 4)) % 1000000) % 96 END, r.Requested_at) > DATEADD(HOUR, -6, @now)
             THEN DATEADD(HOUR, -6, @now)
             ELSE DATEADD(MINUTE, 60 * CASE WHEN slow.rk <= 2 THEN 216 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retslow', '|', r.Sale_key)), 1, 4)) % 1000000) % 72
                                            ELSE 24 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('retfast', '|', r.Sale_key)), 1, 4)) % 1000000) % 96 END, r.Requested_at) END
    FROM   #an_ret r JOIN slow ON slow.Ret_key = r.Ret_key;

    DECLARE ret_cur CURSOR LOCAL STATIC READ_ONLY FOR
        SELECT Ret_key, Tx_id, Product_id, Q, Status, Reason, Requested_at, Refunded_at, Handler
        FROM   #an_ret
        ORDER BY Requested_at, Ret_key;

    OPEN ret_cur;
    FETCH NEXT FROM ret_cur INTO @rkey, @rtx, @rprod, @rq, @rstatus, @rreason, @rreq, @rref, @rhandler;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- refund = the line's share of price after discounts plus its share of the sale's tax, in cents,
        -- rounded DOWN (what lib/returns.js allows is a little more, never less than this)
        SELECT @rL = CAST(ROUND(ti.Line_total * 100, 0) AS BIGINT),
               @rS = CAST(ROUND(s.Subtotal * 100, 0) AS BIGINT),
               @rT = CAST(ROUND(s.Tax_amount * 100, 0) AS BIGINT),
               @rn = ti.Quantity
        FROM   TRANSACTION_ITEM ti
        JOIN   SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
        WHERE  ti.Transaction_id = @rtx AND ti.Product_id = @rprod;

        SET @rR = CASE WHEN @rS = 0 THEN (@rL * @rq) / @rn
                       ELSE (@rL * (@rS + @rT) * @rq) / (@rS * @rn) END;
        SET @ramt = CAST(@rR / 100.0 AS DECIMAL(10,2));

        INSERT INTO PRODUCT_RETURN (Transaction_id, Requested_at, Status, Reason, Refund_total)
        VALUES (@rtx, @rreq, 'requested', @rreason, @ramt);
        SET @rid = SCOPE_IDENTITY();

        INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount)
        VALUES (@rid, @rprod, @rq, @ramt);

        IF @rstatus IN ('approved', 'refunded')
            UPDATE PRODUCT_RETURN SET Status = 'approved', Employee_id = @rhandler WHERE Return_id = @rid;
        IF @rstatus = 'denied'
            UPDATE PRODUCT_RETURN SET Status = 'denied', Employee_id = @rhandler WHERE Return_id = @rid;
        IF @rstatus = 'refunded'
            -- fires TR_PRODUCT_RETURN_Refunded: stock back and a negative loyalty row
            UPDATE PRODUCT_RETURN SET Status = 'refunded', Employee_id = @rhandler, Refunded_at = @rref WHERE Return_id = @rid;

        UPDATE #an_ret SET Return_id = @rid WHERE Ret_key = @rkey;

        FETCH NEXT FROM ret_cur INTO @rkey, @rtx, @rprod, @rq, @rstatus, @rreason, @rreq, @rref, @rhandler;
    END;

    CLOSE ret_cur;
    DEALLOCATE ret_cur;

    -- the refund trigger stamps the loyalty row with the time it ran: give it the day of the refund
    UPDATE l SET l.Created_at = pr.Refunded_at
    FROM   LOYALTY_TRANSACTION l
    JOIN   PRODUCT_RETURN pr ON pr.Transaction_id = l.Transaction_id AND pr.Status = 'refunded'
    WHERE  l.Reason = N'Return refund'
      AND  pr.Return_id IN (SELECT Return_id FROM #an_ret WHERE Return_id IS NOT NULL);


    -- 7. Supplier orders ---------------------------------------------------------------------------------
    --    1-12 received (every supplier in turn; the late one 3 to 9 days after its lead time, the reliable
    --    one 1 to 2 days early), 13-14 cancelled, 15 on the way and overdue (the fast seller's supplier),
    --    16 on the way, 17 pending.

    CREATE TABLE #an_so (
        Order_no INT PRIMARY KEY, Supplier_id INT NOT NULL, Days_ago INT NOT NULL, Final_status VARCHAR(20) NOT NULL,
        Received_date DATE NULL, Order_id INT NULL);
    CREATE TABLE #an_soi (Order_no INT NOT NULL, Product_id INT NOT NULL, Qty INT NOT NULL, Unit_cost DECIMAL(10,2) NOT NULL,
                          PRIMARY KEY (Order_no, Product_id));

    IF @nSup > 0
    BEGIN
        INSERT INTO #an_so (Order_no, Supplier_id, Days_ago, Final_status)
        SELECT k.n, sp.Supplier_id, 170 - 13 * (k.n - 1), 'Received'
        FROM   #an_num k
        JOIN   #an_sup sp ON sp.Rk = ((k.n - 1) % @nSup) + 1
        WHERE  k.n <= 12;

        INSERT INTO #an_so (Order_no, Supplier_id, Days_ago, Final_status)
        SELECT v.Order_no, sp.Supplier_id, v.Days_ago, v.Final_status
        FROM  (VALUES (13, 60, 'Cancelled'), (14, 35, 'Cancelled'), (16, 1, 'Ordered'), (17, 1, 'Pending')) v (Order_no, Days_ago, Final_status)
        JOIN   #an_sup sp ON sp.Rk = (v.Order_no % @nSup) + 1;

        IF @fast IS NOT NULL AND @fastSup IS NOT NULL
            INSERT INTO #an_so (Order_no, Supplier_id, Days_ago, Final_status) VALUES (15, @fastSup, 10, 'Ordered');

        -- 1 to 3 products per order among the ones the supplier supplies (order 15 always has the fast seller)
        ;WITH cand AS (
            SELECT o.Order_no, sp.Product_id, sp.Unit_cost, p.Reorder_threshold,
                   ROW_NUMBER() OVER (PARTITION BY o.Order_no
                                      ORDER BY CASE WHEN o.Order_no = 15 AND sp.Product_id = @fast THEN 0 ELSE 1 END,
                                               CAST((ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('soitem', '|', o.Order_no, '|', sp.Product_id)), 1, 4)) % 1000000) + 0.5) / 1000000.0 AS FLOAT)) AS rn,
                   1 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('soitems', '|', o.Order_no)), 1, 4)) % 1000000) % 3 AS Wanted
            FROM   #an_so o
            JOIN   SUPPLIER_PRODUCT sp ON sp.Supplier_id = o.Supplier_id AND sp.Marked_for_deletion = 0
            JOIN   PRODUCT p ON p.Product_id = sp.Product_id AND p.Is_active = 1 AND p.Marked_for_deletion = 0
        )
        INSERT INTO #an_soi (Order_no, Product_id, Qty, Unit_cost)
        SELECT c.Order_no, c.Product_id, 2 * c.Reorder_threshold + 3 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('soqty', '|', c.Order_no, '|', c.Product_id)), 1, 4)) % 1000000) % 10, c.Unit_cost
        FROM   cand c
        WHERE  c.rn <= c.Wanted;

        -- the overdue order was placed 4 days more than its longest lead time ago, so it is 4 days late
        UPDATE o SET o.Days_ago = l.Lead + 4
        FROM   #an_so o
        CROSS APPLY (SELECT MAX(sp.Lead_time_days) AS Lead
                     FROM   #an_soi i
                     JOIN   SUPPLIER_PRODUCT sp ON sp.Product_id = i.Product_id AND sp.Supplier_id = o.Supplier_id
                     WHERE  i.Order_no = o.Order_no) l
        WHERE  o.Order_no = 15;

        -- received date = order date + longest lead time of its items + the supplier's habit
        UPDATE o SET o.Received_date =
            DATEADD(DAY, CASE WHEN l.Lead + d.Delta < 0 THEN 0
                              WHEN l.Lead + d.Delta > o.Days_ago - 1 THEN o.Days_ago - 1
                              ELSE l.Lead + d.Delta END,
                    DATEADD(DAY, -o.Days_ago, @today))
        FROM   #an_so o
        JOIN   #an_sup s ON s.Supplier_id = o.Supplier_id
        CROSS APPLY (SELECT MAX(sp.Lead_time_days) AS Lead
                     FROM   #an_soi i
                     JOIN   SUPPLIER_PRODUCT sp ON sp.Product_id = i.Product_id AND sp.Supplier_id = o.Supplier_id
                     WHERE  i.Order_no = o.Order_no) l
        CROSS APPLY (SELECT CASE s.Role WHEN 'L' THEN 3 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('late', '|', o.Order_no)), 1, 4)) % 1000000) % 7
                                        WHEN 'G' THEN -(1 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('good', '|', o.Order_no)), 1, 4)) % 1000000) % 2)
                                        ELSE -1 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('avg', '|', o.Order_no)), 1, 4)) % 1000000) % 4 END AS Delta) d
        WHERE  o.Final_status = 'Received';

        DECLARE so_cur CURSOR LOCAL STATIC READ_ONLY FOR
            SELECT Order_no, Supplier_id, Days_ago, Final_status, Received_date FROM #an_so ORDER BY Days_ago DESC, Order_no;

        OPEN so_cur;
        FETCH NEXT FROM so_cur INTO @ono, @osup, @odays, @ostatus, @orecv;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- a received order is created as 'Ordered' and then received, so the trigger adds the stock
            INSERT INTO SUPPLIER_ORDER (Supplier_id, Employee_id, Order_date, Status)
            VALUES (@osup, @mgr, DATEADD(DAY, -@odays, @today), CASE WHEN @ostatus = 'Received' THEN 'Ordered' ELSE @ostatus END);
            SET @oid = SCOPE_IDENTITY();

            INSERT INTO SUPPLIER_ORDER_ITEM (Order_id, Product_id, Quantity, Unit_cost)
            SELECT @oid, Product_id, Qty, Unit_cost FROM #an_soi WHERE Order_no = @ono;

            IF @ostatus = 'Received'
                UPDATE SUPPLIER_ORDER SET Status = 'Received', Received_date = @orecv WHERE Order_id = @oid;

            UPDATE #an_so SET Order_id = @oid WHERE Order_no = @ono;

            FETCH NEXT FROM so_cur INTO @ono, @osup, @odays, @ostatus, @orecv;
        END;

        CLOSE so_cur;
        DEALLOCATE so_cur;

        -- history: the alert that led to each received order (raised the day before it, closed on receipt)
        INSERT INTO LOW_STOCK_ALERT (Product_id, Triggered_at, Resolved_at, Order_id)
        SELECT i.Product_id,
               DATEADD(HOUR, 9,  CAST(DATEADD(DAY, -1, so.Order_date) AS DATETIME2)),
               DATEADD(HOUR, 12, CAST(so.Received_date AS DATETIME2)),
               so.Order_id
        FROM   #an_so o
        JOIN   SUPPLIER_ORDER so ON so.Order_id = o.Order_id
        CROSS APPLY (SELECT TOP (1) x.Product_id FROM #an_soi x WHERE x.Order_no = o.Order_no ORDER BY x.Product_id) i
        WHERE  o.Final_status = 'Received';
    END;


    -- 8. Put the stock back, switch the triggers on, reconcile the alerts -------------------------------

    -- every product goes back to the stock it had when this script started (the trigger is still paused)
    UPDATE p SET p.Stock_quantity = s0.Stock0
    FROM   PRODUCT p JOIN #an_stock0 s0 ON s0.Product_id = p.Product_id;

    -- the fast seller is left with about 4 days of stock (never more than its reorder threshold)
    IF @fast IS NOT NULL
    BEGIN
        SET @fastStock = CAST(CEILING(4.0 * @fastUnits / 30.0) AS INT);
        IF @fastStock < 1 SET @fastStock = 1;
        IF @fastStock > @fastThr SET @fastStock = @fastThr;
        UPDATE PRODUCT SET Stock_quantity = @fastStock WHERE Product_id = @fast;
    END;

    ENABLE TRIGGER TR_PRODUCT_LowStock ON PRODUCT;
    IF @tierWasOn = 1 ENABLE TRIGGER TR_CUSTOMER_TierReward ON CUSTOMER;

    SELECT @maxAlert = ISNULL(MAX(Alert_id), 0) FROM LOW_STOCK_ALERT;

    -- same last step as seed.sql: products at or below their threshold get an alert (never a duplicate)
    -- and products back above it close theirs
    UPDATE PRODUCT SET Stock_quantity = Stock_quantity;

    -- the fast seller's open alert points at its overdue order and was raised the day before that order
    IF @fast IS NOT NULL
        UPDATE a SET a.Order_id = o.Order_id,
                     a.Triggered_at = CASE WHEN a.Alert_id > @maxAlert
                                           THEN DATEADD(HOUR, 15, CAST(DATEADD(DAY, -1, so.Order_date) AS DATETIME2))
                                           ELSE a.Triggered_at END
        FROM   LOW_STOCK_ALERT a
        JOIN   #an_so o ON o.Order_no = 15
        JOIN   SUPPLIER_ORDER so ON so.Order_id = o.Order_id
        WHERE  a.Product_id = @fast AND a.Resolved_at IS NULL AND a.Order_id IS NULL;

    -- any other alert opened just now looks 2 to 14 days old
    UPDATE a SET a.Triggered_at = DATEADD(HOUR, -(48 + ABS(CONVERT(INT, SUBSTRING(HASHBYTES('MD5', CONCAT('alertage', '|', a.Alert_id)), 1, 4)) % 1000000) % 288), @now)
    FROM   LOW_STOCK_ALERT a
    WHERE  a.Alert_id > @maxAlert AND a.Resolved_at IS NULL AND a.Product_id <> ISNULL(@fast, 0);


    -- 9. Self-check grid: the numbers the reports should be able to show ---------------------------------

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Customers created', CAST(x.e AS NVARCHAR(60)), CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = x.e THEN 1 ELSE 0 END
    FROM  (SELECT (SELECT COUNT(*) FROM CUSTOMER WHERE Email LIKE '%@analytics.posstore.test') AS v,
                  (SELECT COUNT(*) FROM #an_cust) AS e) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Sales completed (all planned sales)', CAST(x.e AS NVARCHAR(60)), CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = x.e AND x.v >= 300 THEN 1 ELSE 0 END
    FROM  (SELECT (SELECT COUNT(*) FROM SALES_TRANSACTION s JOIN #an_sale a ON a.Tx_id = s.Transaction_id WHERE s.Status = 'completed') AS v,
                  (SELECT COUNT(*) FROM #an_sale) AS e) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Sales still open', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM SALES_TRANSACTION s WHERE s.Status = 'open' AND s.Transaction_id IN (SELECT Tx_id FROM #an_sale)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Sales where payments <> Total', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM SALES_TRANSACTION s
           WHERE s.Transaction_id IN (SELECT Tx_id FROM #an_sale)
             AND s.Total <> ISNULL((SELECT SUM(p.Amount) FROM PAYMENT p WHERE p.Transaction_id = s.Transaction_id), 0)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Sales where Subtotal <> SUM(Line_total)', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM SALES_TRANSACTION s
           WHERE s.Transaction_id IN (SELECT Tx_id FROM #an_sale)
             AND s.Subtotal <> ISNULL((SELECT SUM(ti.Line_total) FROM TRANSACTION_ITEM ti WHERE ti.Transaction_id = s.Transaction_id), 0)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Customers whose points <> the sum of their loyalty rows', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM CUSTOMER c
           WHERE c.Customer_id IN (SELECT Customer_id FROM #an_cust)
             AND c.Loyalty_points <> ISNULL((SELECT SUM(l.Points_change) FROM LOYALTY_TRANSACTION l WHERE l.Customer_id = c.Customer_id), 0)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Sales in the last 90 days vs the 89 days before', N'more now', CONCAT(x.recent, N' vs ', x.earlier), CASE WHEN x.recent > x.earlier THEN 1 ELSE 0 END
    FROM  (SELECT (SELECT COUNT(*) FROM #an_sale WHERE Days_ago <= 90) AS recent,
                  (SELECT COUNT(*) FROM #an_sale WHERE Days_ago > 90)  AS earlier) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Products whose stock is not back to the starting stock (fast seller aside)', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT p JOIN #an_stock0 s0 ON s0.Product_id = p.Product_id
           WHERE p.Stock_quantity <> s0.Stock0 AND p.Product_id <> ISNULL(@fast, 0)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Active products with no sale in the last 90 days (dead stock)', N'at least 1', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 1 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT p
           WHERE p.Is_active = 1 AND p.Marked_for_deletion = 0
             AND NOT EXISTS (SELECT 1 FROM TRANSACTION_ITEM ti JOIN SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
                             WHERE ti.Product_id = p.Product_id AND s.Status = 'completed'
                               AND CAST(s.Transaction_date AS DATE) >= DATEADD(DAY, -90, @today))) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Fast seller has an open low-stock alert and stock <= its threshold', N'yes', CASE WHEN x.v = 1 THEN N'yes' ELSE N'no' END, CASE WHEN x.v = 1 THEN 1 ELSE 0 END
    FROM  (SELECT CASE WHEN @fast IS NOT NULL
                        AND EXISTS (SELECT 1 FROM LOW_STOCK_ALERT a WHERE a.Product_id = @fast AND a.Resolved_at IS NULL)
                        AND EXISTS (SELECT 1 FROM PRODUCT p WHERE p.Product_id = @fast AND p.Stock_quantity <= p.Reorder_threshold)
                       THEN 1 ELSE 0 END AS v) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Fast seller: days of stock left vs the supplier lead time', N'fewer days than lead',
           CONCAT(CAST(x.days_left AS DECIMAL(6,1)), N' days vs ', x.lead, N' days'),
           CASE WHEN x.days_left < x.lead THEN 1 ELSE 0 END
    FROM  (SELECT CAST(p.Stock_quantity AS FLOAT) / NULLIF(@fastUnits / 30.0, 0) AS days_left, ISNULL(@fastLead, 0) AS lead
           FROM   PRODUCT p WHERE p.Product_id = @fast) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Returns refunded', N'8 to 10', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v BETWEEN 8 AND 10 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT_RETURN WHERE Status = 'refunded' AND Return_id IN (SELECT Return_id FROM #an_ret)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Returns requested (backlog)', N'at least 5', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 5 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT_RETURN WHERE Status = 'requested' AND Return_id IN (SELECT Return_id FROM #an_ret)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Returns approved, waiting for the refund', N'at least 3', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 3 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT_RETURN WHERE Status = 'approved' AND Return_id IN (SELECT Return_id FROM #an_ret)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Returns denied', N'at least 3', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 3 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT_RETURN WHERE Status = 'denied' AND Return_id IN (SELECT Return_id FROM #an_ret)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Requested returns older than 3 days', N'at least 1', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 1 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT_RETURN
           WHERE Status = 'requested' AND Return_id IN (SELECT Return_id FROM #an_ret)
             AND CAST(Requested_at AS DATE) < DATEADD(DAY, -3, @today)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'The planned product is the most returned one', N'yes', CASE WHEN x.top_n = x.planned_n AND x.planned_n > 0 THEN N'yes' ELSE N'no' END,
           CASE WHEN x.top_n = x.planned_n AND x.planned_n > 0 THEN 1 ELSE 0 END
    FROM  (SELECT (SELECT TOP (1) COUNT(*) FROM #an_ret GROUP BY Product_id ORDER BY COUNT(*) DESC) AS top_n,
                  (SELECT COUNT(*) FROM #an_ret WHERE Product_id = @problem) AS planned_n) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Refunds above what the sale allows, or requested outside 30 days', N'0', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = 0 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v FROM PRODUCT_RETURN pr JOIN SALES_TRANSACTION s ON s.Transaction_id = pr.Transaction_id
           WHERE pr.Return_id IN (SELECT Return_id FROM #an_ret)
             AND (pr.Requested_at > DATEADD(DAY, 30, s.Transaction_date) OR pr.Requested_at > @now
                  OR pr.Refund_total > s.Total)) x;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Supplier orders created', CAST(x.e AS NVARCHAR(60)), CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v = x.e THEN 1 ELSE 0 END
    FROM  (SELECT (SELECT COUNT(*) FROM SUPPLIER_ORDER WHERE Order_id IN (SELECT Order_id FROM #an_so)) AS v,
                  (SELECT COUNT(*) FROM #an_so) AS e) x
    WHERE  @nSup > 0;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Received orders that arrived later than the longest lead time of their items', N'at least 1', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 1 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v
           FROM   SUPPLIER_ORDER so
           WHERE  so.Order_id IN (SELECT Order_id FROM #an_so) AND so.Status = 'Received'
             AND  DATEDIFF(DAY, so.Order_date, so.Received_date) >
                  (SELECT MAX(sp.Lead_time_days) FROM SUPPLIER_ORDER_ITEM i
                   JOIN SUPPLIER_PRODUCT sp ON sp.Product_id = i.Product_id AND sp.Supplier_id = so.Supplier_id
                   WHERE i.Order_id = so.Order_id)) x
    WHERE  @nSup > 0;

    INSERT INTO @r (Item, Expected, Actual, Pass)
    SELECT N'Orders on the way that are past their expected date', N'at least 1', CAST(x.v AS NVARCHAR(60)), CASE WHEN x.v >= 1 THEN 1 ELSE 0 END
    FROM  (SELECT COUNT(*) AS v
           FROM   SUPPLIER_ORDER so
           WHERE  so.Order_id IN (SELECT Order_id FROM #an_so) AND so.Status = 'Ordered'
             AND  DATEDIFF(DAY, so.Order_date, @today) >
                  (SELECT MAX(sp.Lead_time_days) FROM SUPPLIER_ORDER_ITEM i
                   JOIN SUPPLIER_PRODUCT sp ON sp.Product_id = i.Product_id AND sp.Supplier_id = so.Supplier_id
                   WHERE i.Order_id = so.Order_id)) x
    WHERE  @nSup > 0 AND @fast IS NOT NULL;

    -- a few totals to eyeball (no pass or fail)
    INSERT INTO @r (Item, Expected, Actual, Pass)
    VALUES (N'Info: revenue (sum of Total) of the new sales', N'-',
                (SELECT CONVERT(NVARCHAR(40), SUM(s.Total)) FROM SALES_TRANSACTION s WHERE s.Transaction_id IN (SELECT Tx_id FROM #an_sale)), NULL),
           (N'Info: oldest and newest new sale', N'-',
                (SELECT CONCAT(MIN(CAST(s.Transaction_date AS DATE)), N' to ', MAX(CAST(s.Transaction_date AS DATE))) FROM SALES_TRANSACTION s WHERE s.Transaction_id IN (SELECT Tx_id FROM #an_sale)), NULL),
           (N'Info: in-store sales (with an employee)', N'-',
                (SELECT CONVERT(NVARCHAR(40), COUNT(*)) FROM SALES_TRANSACTION s WHERE s.Employee_id IS NOT NULL AND s.Transaction_id IN (SELECT Tx_id FROM #an_sale)), NULL),
           (N'Info: customers with 2 or more new sales', N'-',
                (SELECT CONVERT(NVARCHAR(40), COUNT(*)) FROM (SELECT Customer_id FROM #an_sale GROUP BY Customer_id HAVING COUNT(*) >= 2) z), NULL),
           (N'Info: customers with no sale at all', N'-',
                (SELECT CONVERT(NVARCHAR(40), COUNT(*)) FROM #an_cust c WHERE NOT EXISTS (SELECT 1 FROM #an_sale s WHERE s.Cust_seq = c.Seq)), NULL),
           (N'Info: customers in a reward tier', N'-',
                (SELECT CONVERT(NVARCHAR(40), COUNT(*)) FROM CUSTOMER c WHERE c.Customer_id IN (SELECT Customer_id FROM #an_cust) AND c.Tier_id IS NOT NULL), NULL),
           (N'Info: fast seller (SKU)', N'-',
                (SELECT ISNULL(MAX(SKU), N'none') FROM #an_prod WHERE Product_id = @fast), NULL),
           (N'Info: most returned product (SKU)', N'-',
                (SELECT ISNULL(MAX(SKU), N'none') FROM #an_prod WHERE Product_id = @problem), NULL),
           (N'Info: supplier that is always late', N'-',
                (SELECT ISNULL(MAX(Supplier_name), N'none') FROM #an_sup WHERE Role = 'L'), NULL);

    IF @dry = 1 ROLLBACK TRAN ELSE COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;   -- re-raise the original error; nothing was saved
END CATCH;

SELECT CASE WHEN @dry = 1 THEN N'REHEARSAL: everything below was rolled back, nothing was saved.'
            ELSE N'Done: the analytics demo data is saved.' END AS Outcome;

SELECT Item, Expected, Actual,
       CASE WHEN Pass IS NULL THEN 'info' WHEN Pass = 1 THEN 'PASS' ELSE 'FAIL' END AS Result
FROM   @r
ORDER BY Seq;

-- Logins created (password for every account: Password123!). Examples:
--   a heavy buyer and a light buyer: look at CUSTOMER where Email LIKE '%@analytics.posstore.test'
