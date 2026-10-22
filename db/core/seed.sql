/*
   seed.sql - demo and test data for the POS database (db/core)

   WHEN TO RUN
     Once, on an EMPTY database that already has the schema and the triggers:
       drop.sql -> schema.sql -> triggers.sql -> (test_triggers.sql, optional) -> seed.sql
     test_triggers.sql needs a database with NO active reward program, so run it
     BEFORE this file. This file stops with a clear message if the database
     already has data, or if a required trigger is missing or disabled.
     Run it as one piece (the part after the first GO is a single batch).

   WHAT IT CREATES
     3 employees       1 manager + 2 support (supervised by the manager)
     7 customers       4 with sales history, 2 with a cart, 1 with no address
     1 reward program  1 point per dollar, tiers Bronze 100 / Silver 500 / Gold 1000
     6 categories, 24 products (one inactive, one out of stock, some low stock)
     1 sale event + 6 discounts (active, product vs category, expired, paused, fixed)
     24 tax rates      every category x test states TX, CA, NY, FL
     8 completed sales built the way checkout builds them, so the REAL triggers
       produce the stock changes, loyalty points, tiers and low-stock alerts
     4 cart rows, 2 notifications

   LOGINS (dev and demo only)
     Every account uses the password:  Password123!
     manager@posstore.test        Manager
     support1@posstore.test       Support
     support2@posstore.test       Support
     alice.nguyen@posstore.test   customer (Gold, 3 sales, works as the "big spender")
     brandon.lee@posstore.test    customer (Silver)
     carla.mendez@posstore.test   customer (Bronze, California ship-to)
     derek.owens@posstore.test    customer (no tier, only a sale older than 30 days)
     emma.park@posstore.test      customer (cart idle 3 days -> cart reminder candidate)
     frank.silva@posstore.test    customer (cart idle 3 days, but opted out of notifications)
     gina.brooks@posstore.test    customer (new: no address, no cart, no sales)
     The password hashes are real bcrypt hashes (cost 10, $2b$). Change the
     password of the manager account before the app is shown on a public URL.

   CHOICES MADE HERE (not project decisions: Part 2 decides them for sp_Checkout)
     - Tax is rounded per line, then added up.
     - Only PERCENT discounts are attached to products and categories, because
       "fixed amount per unit or per line" is still undecided. One fixed
       discount exists, attached to nothing, so Part 4 has one to display.
     - Gift cards get an explicit 0.0000 tax rate (a row that says 0%), which is
       different from a MISSING rate row: that must fail checkout.
     - Ties between the product discount and the category discount go to the
       lower Discount_id (no tie occurs in this data).
     - Sale dates are relative to the day you run the script.
       Sales 3 to 8 are inside the 30-day return window; sales 1 and 2 are not.
*/
USE pos_store;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;


-- Guards: stop before changing anything if the database is not ready

IF EXISTS (SELECT 1 FROM EMPLOYEE) OR EXISTS (SELECT 1 FROM CUSTOMER)
   OR EXISTS (SELECT 1 FROM PRODUCT) OR EXISTS (SELECT 1 FROM CATEGORY)
   OR EXISTS (SELECT 1 FROM REWARD_PROGRAM) OR EXISTS (SELECT 1 FROM SALES_TRANSACTION)
    THROW 50900, 'Seed stopped: the database already has data. Rebuild it first (drop.sql, schema.sql, triggers.sql), then run this file once.', 1;

IF (SELECT COUNT(*) FROM sys.triggers
    WHERE parent_class = 1 AND is_disabled = 0
      AND name IN ('TR_SALES_TRANSACTION_Complete', 'TR_LOYALTY_TRANSACTION_Balance',
                   'TR_PRODUCT_LowStock', 'TR_SUPPLIER_ORDER_Received',
                   'TR_REWARD_PROGRAM_NoOverlap')) < 5
    THROW 50901, 'Seed stopped: one of the 5 built triggers is missing or disabled. Run triggers.sql first.', 1;

IF (SELECT CAST(value_in_use AS INT) FROM sys.configurations WHERE name = 'nested triggers') <> 1
    THROW 50901, 'Seed stopped: nested triggers is OFF. The trigger chain needs it ON.', 1;


-- Variables

DECLARE @pw    VARCHAR(255) = '$2b$10$6EConWh.yGG.UumoKPOnbuhQe9qQYsvrAhe8UZhCVT/i5VKIw4jhu';  -- Password123!
DECLARE @today DATE         = CAST(SYSDATETIME() AS DATE);
DECLARE @start DATE         = DATEADD(DAY, -365, @today);   -- reward program and tax rates start here

DECLARE @mgr INT, @prog INT, @ev INT;

DECLARE @sale TABLE (Sale_key INT PRIMARY KEY, Email VARCHAR(100), Days_ago INT,
                     Method VARCHAR(10), Card_last4 CHAR(4));
DECLARE @line TABLE (Sale_key INT, SKU VARCHAR(50), Qty INT, PRIMARY KEY (Sale_key, SKU));

DECLARE @key INT, @email VARCHAR(100), @days INT, @method VARCHAR(10), @card CHAR(4),
        @cust INT, @tx INT, @when DATETIME2, @n INT;

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Item NVARCHAR(80), Expected NVARCHAR(40), Actual NVARCHAR(40));

BEGIN TRY
    BEGIN TRAN;

    -- Employees

    INSERT INTO EMPLOYEE (FirstName, LastName, Email, Phone_number, Role, Hire_date, Password_hash, Supervisor_id)
    VALUES (N'Morgan', N'Hale', 'manager@posstore.test', '5125550101', 'Manager', '2024-01-15', @pw, NULL);
    SET @mgr = SCOPE_IDENTITY();

    INSERT INTO EMPLOYEE (FirstName, LastName, Email, Phone_number, Role, Hire_date, Password_hash, Supervisor_id)
    VALUES (N'Sam',   N'Ortiz', 'support1@posstore.test', '5125550102', 'Support', '2024-06-03', @pw, @mgr),
           (N'Priya', N'Shah',  'support2@posstore.test', '5125550103', 'Support', '2025-02-10', @pw, @mgr);

    -- Reward program (exactly one) and its tiers

    INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
    VALUES (N'POS Rewards', 1, 0.0100, @start, NULL);
    SET @prog = SCOPE_IDENTITY();

    INSERT INTO REWARD_TIER (Program_id, Tier_name, Min_points, Perk_description)
    VALUES (@prog, N'Bronze',  100, N'Member pricing emails'),
           (@prog, N'Silver',  500, N'Early access to sales'),
           (@prog, N'Gold',   1000, N'Early access and free tracking updates');


    -- Customers, addresses, phones
    INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash, Created_date, Notify_offers, Notify_cart)
    VALUES (N'Alice',   N'Nguyen',  'alice.nguyen@posstore.test',  @pw, DATEADD(DAY, -120, @today), 1, 1),
           (N'Brandon', N'Lee',     'brandon.lee@posstore.test',   @pw, DATEADD(DAY,  -90, @today), 1, 1),
           (N'Carla',   N'Mendez',  'carla.mendez@posstore.test',  @pw, DATEADD(DAY,  -60, @today), 1, 1),
           (N'Derek',   N'Owens',   'derek.owens@posstore.test',   @pw, DATEADD(DAY, -100, @today), 1, 1),
           (N'Emma',    N'Park',    'emma.park@posstore.test',     @pw, DATEADD(DAY,  -30, @today), 1, 1),
           (N'Frank',   N'Silva',   'frank.silva@posstore.test',   @pw, DATEADD(DAY,  -15, @today), 0, 0),
           (N'Gina',    N'Brooks',  'gina.brooks@posstore.test',   @pw, DATEADD(DAY,   -1, @today), 1, 1);

    -- Brandon was referred by Alice
    UPDATE c
    SET    c.Referred_by_id = r.Customer_id
    FROM   CUSTOMER c
    JOIN   CUSTOMER r ON r.Email = 'alice.nguyen@posstore.test'
    WHERE  c.Email = 'brandon.lee@posstore.test';

    -- One default address each (Gina has none on purpose); Alice also has a work address in CA
    INSERT INTO CUSTOMER_ADDRESS (Customer_id, Address_type, Recipient_name, Street, Apt, City, State, Zip, is_default)
    SELECT c.Customer_id, v.Address_type, v.Recipient_name, v.Street, v.Apt, v.City, v.State, v.Zip, v.is_default
    FROM (VALUES
        ('alice.nguyen@posstore.test', 'home', N'Alice Nguyen',  N'1200 Main St',      'Apt 4B', N'Houston',     'TX', '77002', 1),
        ('alice.nguyen@posstore.test', 'work', N'Alice Nguyen',  N'500 Market St',     NULL,     N'Los Angeles', 'CA', '90012', 0),
        ('brandon.lee@posstore.test',  'home', N'Brandon Lee',   N'88 Congress Ave',   NULL,     N'Austin',      'TX', '78701', 1),
        ('carla.mendez@posstore.test', 'home', N'Carla Mendez',  N'742 Sunset Blvd',   'Unit 2', N'Los Angeles', 'CA', '90028', 1),
        ('derek.owens@posstore.test',  'home', N'Derek Owens',   N'15 Hudson St',      'Apt 9',  N'New York',    'NY', '10013', 1),
        ('emma.park@posstore.test',    'home', N'Emma Park',     N'301 Biscayne Blvd', NULL,     N'Miami',       'FL', '33132', 1),
        ('frank.silva@posstore.test',  'home', N'Frank Silva',   N'950 Elm St',        NULL,     N'Dallas',      'TX', '75201', 1)
    ) v (Email, Address_type, Recipient_name, Street, Apt, City, State, Zip, is_default)
    JOIN CUSTOMER c ON c.Email = v.Email;

    INSERT INTO CUSTOMER_PHONE (Customer_id, Phone_number)
    SELECT c.Customer_id, v.Phone_number
    FROM (VALUES ('alice.nguyen@posstore.test', '7135550111'),
                 ('alice.nguyen@posstore.test', '7135550112'),
                 ('carla.mendez@posstore.test', '3235550121')) v (Email, Phone_number)
    JOIN CUSTOMER c ON c.Email = v.Email;

    -- Sale event and discounts
    --   active + in date : Autumn Games 15% (category), Embers 25% and Turbo 5% (products)
    --   expired          : Summer Clearance 30% (ended 30 days ago)
    --   paused           : Poster promo (Is_active = 0, dates are fine)
    --   fixed, unattached: Loyalty $5 off
    INSERT INTO SALE_EVENT (Event_name, Description, Start_date, End_date, Is_active)
    VALUES (N'Autumn Sale', N'Seasonal promotion on video games.', DATEADD(DAY, -14, @today), DATEADD(DAY, 16, @today), 1);
    SET @ev = SCOPE_IDENTITY();

    INSERT INTO DISCOUNT (Discount_name, Discount_type, Code, Amount, Amount_type, Start_date, End_date, Sale_event_id, Is_active)
    VALUES (N'Autumn Games 15% off',        'category sale', NULL, 15.00, 'percent', DATEADD(DAY,  -14, @today), DATEADD(DAY,  16, @today), @ev,  1),
           (N'Embers Launch 25% off',       'product sale',  NULL, 25.00, 'percent', DATEADD(DAY,  -14, @today), DATEADD(DAY,  16, @today), @ev,  1),
           (N'Turbo Weekend 5% off',        'product sale',  NULL,  5.00, 'percent', DATEADD(DAY,  -14, @today), DATEADD(DAY,  16, @today), @ev,  1),
           (N'Summer Clearance 30% off',    'product sale',  NULL, 30.00, 'percent', DATEADD(DAY,  -90, @today), DATEADD(DAY, -30, @today), NULL, 1),
           (N'Paused Poster Promo 20% off', 'product sale',  NULL, 20.00, 'percent', DATEADD(DAY,  -14, @today), DATEADD(DAY,  16, @today), @ev,  0),
           (N'Loyalty $5 off',              'fixed amount',  NULL,  5.00, 'fixed',   @today,                     DATEADD(DAY,  30, @today), NULL, 1);

    -- Categories (Video Games carries the category discount)
    INSERT INTO CATEGORY (Name, Description, Discount_id)
    SELECT v.Name, v.Description, d.Discount_id
    FROM (VALUES
        (N'Video Games',  N'Game discs and cartridges for current consoles.', N'Autumn Games 15% off'),
        (N'Consoles',     N'Home and handheld game consoles.',                NULL),
        (N'Accessories',  N'Controllers, headsets and chargers.',             NULL),
        (N'Collectibles', N'Figures, posters, statues and trading cards.',    NULL),
        (N'Merchandise',  N'Apparel and everyday items with game branding.',  NULL),
        (N'Gift Cards',   N'Store gift cards.',                               NULL)
    ) v (Name, Description, Discount_name)
    LEFT JOIN DISCOUNT d ON d.Discount_name = v.Discount_name;


    -- Products (24). Some start at or below their reorder threshold, which
    -- opens a low-stock alert through TR_PRODUCT_LowStock.
    INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold,
                         Product_condition, Category_id, Discount_id, Is_active)
    SELECT v.SKU, v.Name, v.Description, v.Cost_price, v.Sell_price, v.Stock_quantity, v.Reorder_threshold,
           v.Product_condition, c.Category_id, d.Discount_id, v.Is_active
    FROM (VALUES
        ('GAME-STAR-PS5',   N'Starfall Odyssey [PS5]',                           N'Open-world space adventure. Factory sealed.',            38.00,  59.99,  40,  8, 'New',         N'Video Games',  NULL,                             1),
        ('GAME-EMBR-SW',    N'Kingdom of Embers [Switch]',                       N'Fantasy action RPG. Has its own 25% product discount.',   36.00,  59.99,  35,  8, 'New',         N'Video Games',  N'Embers Launch 25% off',         1),
        ('GAME-RACE-XB',    N'Turbo Circuit Racing [Xbox Series X]',             N'Arcade racing. 5% discount loses to the category 15%.', 30.00, 49.99,  25,  6, 'New',         N'Video Games',  N'Turbo Weekend 5% off',          1),
        ('GAME-RACE-XBU',   N'Turbo Circuit Racing [Xbox Series X] (Used)',      N'Used copy, tested.',                                      15.00,  29.99,  12,  4, 'Used',        N'Video Games',  NULL,                             1),
        ('GAME-PUZZ-SW',    N'Pocket Puzzle Club [Switch]',                      N'Puzzle collection. Starts below its reorder threshold.',  12.00,  19.99,   3,  5, 'New',         N'Video Games',  NULL,                             1),
        ('GAME-LEGC-PS5',   N'Legacy Quest Collection [PS5]',                    N'Three classic quests in one disc.',                       20.00,  39.99,  20,  5, 'New',         N'Video Games',  NULL,                             1),
        ('GAME-RETRO-PS4',  N'Retro Arcade Pack [PS4] (Used)',                   N'Discontinued. Inactive but still shown in old orders.',    9.00,  24.99,   5,  2, 'Used',        N'Video Games',  NULL,                             0),
        ('CONS-ARC-1TB',    N'Arcadia Console 1TB',                              N'Home console with disc drive.',                          380.00, 499.99,  15,  4, 'New',         N'Consoles',     NULL,                             1),
        ('CONS-ARC-DIG',    N'Arcadia Console Digital Edition',                  N'Home console, digital only.',                            300.00, 399.99,  10,  3, 'New',         N'Consoles',     NULL,                             1),
        ('CONS-HAND-REF',   N'Pocket Handheld Console (Refurbished)',            N'Refurbished handheld with 90-day store warranty.',       130.00, 189.99,   6,  3, 'Refurbished', N'Consoles',     NULL,                             1),
        ('ACC-CTRL-BLK',    N'Pro Controller Black',                             N'Wireless controller.',                                    35.00,  69.99,  50, 10, 'New',         N'Accessories',  NULL,                             1),
        ('ACC-HEAD-WL',     N'Wireless Headset',                                 N'Over-ear wireless headset. Its 30% discount is expired.', 45.00,  89.99,  18,  6, 'New',         N'Accessories',  N'Summer Clearance 30% off',      1),
        ('ACC-CHRG-DOC',    N'Dual Charging Dock',                               N'Charges two controllers at once.',                        12.00,  24.99,  30,  8, 'New',         N'Accessories',  NULL,                             1),
        ('ACC-CTRL-USED',   N'Pro Controller Black (Used)',                      N'Used controller, cleaned and tested.',                    18.00,  34.99,   9,  3, 'Used',        N'Accessories',  NULL,                             1),
        ('COLL-FIG-KNIGHT', N'Ember Knight Figure 12in',                         N'Collectible figure.',                                     28.00,  54.99,   6,  3, 'New',         N'Collectibles', NULL,                             1),
        ('COLL-CARD-BOOST', N'Starfall Trading Card Booster Pack',               N'Ten random cards per pack.',                               2.50,   4.99, 200, 40, 'New',         N'Collectibles', NULL,                             1),
        ('COLL-POST-LIM',   N'Limited Edition Art Poster',                       N'Numbered print. Its 20% promo is paused (inactive).',      8.00,  19.99,  25,  5, 'New',         N'Collectibles', N'Paused Poster Promo 20% off',   1),
        ('COLL-STAT-RARE',  N'Collector Statue (Rare)',                          N'Out of stock on purpose.',                                90.00, 149.99,   0,  2, 'New',         N'Collectibles', NULL,                             1),
        ('MERC-TSHIRT-M',   N'Starfall Logo T-Shirt (M)',                        N'Cotton t-shirt, medium.',                                  7.00,  19.99,  40, 10, 'New',         N'Merchandise',  NULL,                             1),
        ('MERC-HOOD-L',     N'Ember Knight Hoodie (L)',                          N'Fleece hoodie, large.',                                   22.00,  49.99,  15,  5, 'New',         N'Merchandise',  NULL,                             1),
        ('MERC-MUG',        N'Pixel Heart Coffee Mug',                           N'Ceramic mug.',                                             4.00,  12.99,  60, 12, 'New',         N'Merchandise',  NULL,                             1),
        ('GIFT-25',         N'$25 Store Gift Card',                              N'Redeemable in store and online.',                         25.00,  25.00, 500, 50, 'New',         N'Gift Cards',   NULL,                             1),
        ('GIFT-50',         N'$50 Store Gift Card',                              N'Redeemable in store and online.',                         50.00,  50.00, 500, 50, 'New',         N'Gift Cards',   NULL,                             1),
        ('GIFT-100',        N'$100 Store Gift Card',                             N'Redeemable in store and online.',                        100.00, 100.00, 500, 50, 'New',         N'Gift Cards',   NULL,                             1)
    ) v (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold,
         Product_condition, Category_name, Discount_name, Is_active)
    JOIN CATEGORY c ON c.Name = v.Category_name
    LEFT JOIN DISCOUNT d ON d.Discount_name = v.Discount_name;

    -- Tax rates: every category in every test state (gift cards: explicit 0%)
    -- Test values only, not legal rates.
    INSERT INTO TAX_RATE (Category_id, Rate, Effective_from, Effective_to, State)
    SELECT c.Category_id,
           CASE WHEN c.Name = N'Gift Cards' THEN 0.0000 ELSE s.Rate END,
           @start, NULL, s.State
    FROM   CATEGORY c
    CROSS JOIN (VALUES ('TX', 0.0825), ('CA', 0.0725), ('NY', 0.0888), ('FL', 0.0600)) s (State, Rate);


    -- Sales history (completed), built the way checkout builds them:
    --   open sale with ship-to copied -> items with price/discount snapshot
    --   -> totals -> payment -> UPDATE to 'completed'
    -- The completing UPDATE fires the real triggers (stock, points, tier, alerts).
    INSERT INTO @sale (Sale_key, Email, Days_ago, Method, Card_last4)
    VALUES (1, 'alice.nguyen@posstore.test', 45, 'credit', '4242'),
           (2, 'derek.owens@posstore.test',  45, 'debit',  '1111'),
           (3, 'alice.nguyen@posstore.test', 20, 'credit', '4242'),
           (4, 'carla.mendez@posstore.test', 20, 'debit',  '5555'),
           (5, 'brandon.lee@posstore.test',  10, 'credit', '4012'),
           (6, 'carla.mendez@posstore.test',  5, 'credit', '5555'),
           (7, 'alice.nguyen@posstore.test',  3, 'credit', '4242'),
           (8, 'brandon.lee@posstore.test',   2, 'debit',  '4012');

    INSERT INTO @line (Sale_key, SKU, Qty)
    VALUES (1, 'GAME-STAR-PS5',   1), (1, 'ACC-HEAD-WL',     1),
           (2, 'GAME-RETRO-PS4',  1), (2, 'ACC-CTRL-USED',   1),
           (3, 'GAME-LEGC-PS5',   1), (3, 'COLL-FIG-KNIGHT', 3),
           (4, 'COLL-CARD-BOOST', 10),(4, 'MERC-MUG',        2),
           (5, 'GAME-RACE-XB',    2), (5, 'MERC-TSHIRT-M',   2),
           (6, 'GAME-STAR-PS5',   1), (6, 'ACC-HEAD-WL',     1), (6, 'GIFT-50', 1),
           (7, 'CONS-ARC-1TB',    1), (7, 'GAME-EMBR-SW',    2), (7, 'ACC-CTRL-BLK', 2),
           (8, 'CONS-HAND-REF',   3);

    DECLARE sale_cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT Sale_key, Email, Days_ago, Method, Card_last4
        FROM   @sale
        ORDER BY Days_ago DESC, Sale_key;

    OPEN sale_cur;
    FETCH NEXT FROM sale_cur INTO @key, @email, @days, @method, @card;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SELECT @cust = Customer_id FROM CUSTOMER WHERE Email = @email;
        SET @when = DATEADD(DAY, -@days, SYSDATETIME());

        -- 1) open sale, ship-to copied from the customer's default address
        INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Status,
                                       Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
        SELECT @cust, NULL, @when, 'open',
               a.Recipient_name, a.Street, a.Apt, a.City, a.State, a.Zip
        FROM   CUSTOMER_ADDRESS a
        WHERE  a.Customer_id = @cust AND a.is_default = 1;
        SET @n  = @@ROWCOUNT;
        SET @tx = SCOPE_IDENTITY();
        IF @n <> 1
            THROW 50902, 'Seed error: a customer with sales has no default address.', 1;

        -- 2) items: price snapshot + the single largest percent saving among the
        --    product discount and the category discount (active and in date on the sale date)
        INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
        SELECT @tx, p.Product_id, l.Qty, p.Sell_price, d.Discount_id, ISNULL(d.Saving, 0)
        FROM   @line l
        JOIN   PRODUCT  p ON p.SKU = l.SKU
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
           <> (SELECT COUNT(*) FROM @line WHERE Sale_key = @key)
            THROW 50903, 'Seed error: a SKU in the sale list does not exist in PRODUCT.', 1;

        -- 3) every line must have exactly one tax rate (category, ship-to state, sale date)
        IF EXISTS (SELECT 1
                   FROM   TRANSACTION_ITEM ti
                   JOIN   PRODUCT p           ON p.Product_id = ti.Product_id
                   JOIN   SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
                   WHERE  ti.Transaction_id = @tx
                     AND  (SELECT COUNT(*) FROM TAX_RATE tr
                           WHERE  tr.Category_id = p.Category_id
                             AND  tr.State = s.Ship_state
                             AND  CAST(s.Transaction_date AS DATE) >= tr.Effective_from
                             AND  (tr.Effective_to IS NULL OR CAST(s.Transaction_date AS DATE) <= tr.Effective_to)) <> 1)
            THROW 50904, 'Seed error: a line has no tax rate (or more than one).', 1;

        -- 4) totals: Subtotal = SUM(Line_total), tax rounded per line, Total = Subtotal + Tax
        UPDATE s
        SET    s.Subtotal   = t.Sub,
               s.Tax_amount = t.Tax,
               s.Total      = t.Sub + t.Tax
        FROM   SALES_TRANSACTION s
        CROSS APPLY (SELECT SUM(ti.Line_total)                  AS Sub,
                            SUM(ROUND(ti.Line_total * tr.Rate, 2)) AS Tax
                     FROM   TRANSACTION_ITEM ti
                     JOIN   PRODUCT  p  ON p.Product_id = ti.Product_id
                     JOIN   TAX_RATE tr ON tr.Category_id = p.Category_id
                                       AND tr.State = s.Ship_state
                                       AND CAST(s.Transaction_date AS DATE) >= tr.Effective_from
                                       AND (tr.Effective_to IS NULL OR CAST(s.Transaction_date AS DATE) <= tr.Effective_to)
                     WHERE  ti.Transaction_id = s.Transaction_id) t
        WHERE  s.Transaction_id = @tx;

        -- 5) one card payment for the full Total, recorded while the sale is still open
        INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4, Paid_at)
        SELECT Transaction_id, @method, Total, @card, @when
        FROM   SALES_TRANSACTION
        WHERE  Transaction_id = @tx;

        -- 6) complete: fires TR_SALES_TRANSACTION_Complete -> stock, loyalty row, tier, low-stock alerts
        UPDATE SALES_TRANSACTION
        SET    Status            = 'completed',
               Tracking_number   = CONCAT('TRK-SEED-', @key),
               Estimated_arrival = DATEADD(DAY, 5, CAST(@when AS DATE))
        WHERE  Transaction_id = @tx;

        FETCH NEXT FROM sale_cur INTO @key, @email, @days, @method, @card;
    END;

    CLOSE sale_cur;
    DEALLOCATE sale_cur;

    -- Carts (no cart header table; one row per product)
    --   Emma : idle 3 days, reminders on  -> candidate for a cart reminder
    --   Frank: idle 3 days, opted out     -> must be skipped by the job
    --   Alice: added just now             -> not idle
    INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity, Added_at)
    SELECT c.Customer_id, p.Product_id, v.Qty, v.Added_at
    FROM (VALUES
        ('emma.park@posstore.test',    'GAME-STAR-PS5',   1, DATEADD(DAY, -3, SYSDATETIME())),
        ('emma.park@posstore.test',    'ACC-CTRL-BLK',    1, DATEADD(DAY, -3, SYSDATETIME())),
        ('frank.silva@posstore.test',  'GAME-EMBR-SW',    1, DATEADD(DAY, -3, SYSDATETIME())),
        ('alice.nguyen@posstore.test', 'COLL-CARD-BOOST', 5, SYSDATETIME())
    ) v (Email, SKU, Qty, Added_at)
    JOIN CUSTOMER c ON c.Email = v.Email
    JOIN PRODUCT  p ON p.SKU   = v.SKU;


    -- Notifications (in-site only): one unread, one read
    INSERT INTO NOTIFICATION (Customer_id, Notification_type, Message, Discount_id, Created_at, Sent_at, Read_at)
    SELECT c.Customer_id, 'offer',
           CONCAT('Autumn Sale: 15% off all video games until ', CONVERT(VARCHAR(10), DATEADD(DAY, 16, @today), 23), '.'),
           d.Discount_id,
           DATEADD(DAY, -1, SYSDATETIME()),
           DATEADD(DAY, -1, SYSDATETIME()),
           v.Read_at
    FROM (VALUES ('alice.nguyen@posstore.test', CAST(NULL AS DATETIME2)),
                 ('carla.mendez@posstore.test', CAST(DATEADD(HOUR, -20, SYSDATETIME()) AS DATETIME2))) v (Email, Read_at)
    JOIN CUSTOMER c ON c.Email = v.Email
    JOIN DISCOUNT d ON d.Discount_name = N'Autumn Games 15% off';


    -- Required last step: products that already started at or below their
    -- threshold get their low-stock alert (the trigger never duplicates one).
    UPDATE PRODUCT SET Stock_quantity = Stock_quantity;

    COMMIT TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    THROW;   -- re-raise the original error; nothing was saved
END CATCH;

-- Self-check grid. Expected values come from working the same rules out
-- by hand, so a FAIL means a trigger or a rule did not behave as designed.
INSERT INTO @r (Item, Expected, Actual)
VALUES (N'Employees',                                   '3',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM EMPLOYEE)),
       (N'Customers',                                   '7',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM CUSTOMER)),
       (N'Products',                                    '24', (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM PRODUCT)),
       (N'Inactive products',                           '1',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM PRODUCT WHERE Is_active = 0)),
       (N'Reward programs active today',                '1',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM REWARD_PROGRAM
                                                               WHERE Effective_from <= CAST(SYSDATETIME() AS DATE)
                                                                 AND (Effective_to IS NULL OR Effective_to >= CAST(SYSDATETIME() AS DATE)))),
       (N'Tax rates (6 categories x 4 states)',         '24', (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM TAX_RATE)),
       (N'Category x state pairs with no tax rate',     '0',  (SELECT CAST(COUNT(*) AS NVARCHAR(40))
                                                               FROM CATEGORY c
                                                               CROSS JOIN (VALUES ('TX'), ('CA'), ('NY'), ('FL')) s (State)
                                                               WHERE NOT EXISTS (SELECT 1 FROM TAX_RATE t
                                                                                 WHERE t.Category_id = c.Category_id AND t.State = s.State))),
       (N'Completed sales',                             '8',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Status = 'completed')),
       (N'Sales still open',                            '0',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Status = 'open')),
       (N'Sales where payments <> Total',               '0',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM SALES_TRANSACTION s
                                                               WHERE s.Total <> ISNULL((SELECT SUM(p.Amount) FROM PAYMENT p WHERE p.Transaction_id = s.Transaction_id), 0))),
       (N'Sales where Subtotal <> SUM(Line_total)',     '0',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM SALES_TRANSACTION s
                                                               WHERE s.Subtotal <> ISNULL((SELECT SUM(ti.Line_total) FROM TRANSACTION_ITEM ti WHERE ti.Transaction_id = s.Transaction_id), 0))),
       (N'Loyalty rows created by trigger 1',           '8',  (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOYALTY_TRANSACTION)),
       (N'Alice points (122+204+729)',                  '1055', (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Email = 'alice.nguyen@posstore.test')),
       (N'Alice tier',                                  'Gold',   (SELECT ISNULL(t.Tier_name, 'none') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Email = 'alice.nguyen@posstore.test')),
       (N'Brandon points (124+569)',                    '693',  (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Email = 'brandon.lee@posstore.test')),
       (N'Brandon tier',                                'Silver', (SELECT ISNULL(t.Tier_name, 'none') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Email = 'brandon.lee@posstore.test')),
       (N'Carla points (75+190)',                       '265',  (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Email = 'carla.mendez@posstore.test')),
       (N'Carla tier',                                  'Bronze', (SELECT ISNULL(t.Tier_name, 'none') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Email = 'carla.mendez@posstore.test')),
       (N'Derek points (59)',                           '59',   (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Email = 'derek.owens@posstore.test')),
       (N'Derek tier (below Bronze)',                   'none', (SELECT ISNULL(t.Tier_name, 'none') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Email = 'derek.owens@posstore.test')),
       (N'Customers with no sales have 0 points',       '0',    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM CUSTOMER
                                                                 WHERE Email IN ('emma.park@posstore.test', 'frank.silva@posstore.test', 'gina.brooks@posstore.test')
                                                                   AND Loyalty_points <> 0)),
       (N'Stock: Starfall Odyssey (40 - 1 - 1)',        '38',   (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE SKU = 'GAME-STAR-PS5')),
       (N'Stock: Arcadia Console 1TB (15 - 1)',         '14',   (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE SKU = 'CONS-ARC-1TB')),
       (N'Open low-stock alerts',                       '4',    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Resolved_at IS NULL)),
       (N'Alerts: puzzle, handheld, figure, statue',    '4',    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT a JOIN PRODUCT p ON p.Product_id = a.Product_id
                                                                 WHERE a.Resolved_at IS NULL
                                                                   AND p.SKU IN ('GAME-PUZZ-SW', 'CONS-HAND-REF', 'COLL-FIG-KNIGHT', 'COLL-STAT-RARE'))),
       (N'Cart rows',                                   '4',    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM CART_ITEM)),
       (N'Notifications',                               '2',    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM NOTIFICATION));

SELECT Item, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result
FROM   @r
ORDER BY Seq;

-- Logins created (password for every account: Password123!)
SELECT 'employee' AS Kind, Email, Role AS Detail FROM EMPLOYEE
UNION ALL
SELECT 'customer', Email,
       CONCAT(First_name, ' ', Last_name, ' - ', Loyalty_points, ' points') FROM CUSTOMER
ORDER BY Kind DESC, Email;