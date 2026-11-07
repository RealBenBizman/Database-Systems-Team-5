/*
   test.sql - tests for the loyalty tier reward (db/loyalty/tier_reward_view.sql, tier_reward_triggers.sql + sp_Checkout)

     TR_CUSTOMER_TierReward            cases  1-10  issuing the reward, and VW_TIER_REWARD
     TR_TRANSACTION_ITEM_RewardGuard   cases 11-20  using the reward (error 50011)
     sp_Checkout                       cases 21-26  the reward on a real checkout

   Run it as a SINGLE batch (there are no GO separators on purpose), after schema.sql,
   triggers.sql, views.sql, db/loyalty/tier_reward_view.sql, db/loyalty/tier_reward_triggers.sql and
   db/checkout/sp_checkout.sql.
   Every case builds its own small world inside a transaction and ROLLS IT BACK, so no
   test data is left. It works on an empty database and on a seeded one.
   Expected result: every row says PASS (2 setup checks + 26 cases + 2 clean-up checks).

   The world of every case
     Customer A (and customer B), a category with a 8.25% TX tax rate and these products:
       P1 $20.00, BIG1 $4000.00, BIG2 $3000.00, BIG3 $3000.00 (all with stock 10)
     Two test tiers in the active reward program, far above any real tier:
       T1 Min_points 987650, T2 Min_points 987660
     The customer's tier is set directly (the trigger only looks at CUSTOMER.Tier_id), so no
     purchases are needed to "earn" a tier.
     The reward program: if one is already active it is used, otherwise a test program is
     created inside the transaction (and rolled back with it).

   Numbers used: 15% off, at most $500 per order, valid 90 days.
*/
USE pos_store;
SET NOCOUNT ON;

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Test NVARCHAR(120), Expected NVARCHAR(80),
                  Actual NVARCHAR(80), Detail NVARCHAR(300));

DECLARE @cases TABLE (Id INT PRIMARY KEY, Name NVARCHAR(120), Expected NVARCHAR(80));

INSERT INTO @cases (Id, Name, Expected)
VALUES
 ( 1, N'Issue: first tier (from none) gives 1 reward, 1 message, valid 90 days',   '1|1|90'),
 ( 2, N'Issue: moving up to a higher tier gives the reward of THAT tier',          '1|t2'),
 ( 3, N'Issue: saving the same tier again gives nothing',                          '0'),
 ( 4, N'Issue: moving down a tier gives nothing',                                  '0'),
 ( 5, N'Issue: up, down and up again gives only ONE reward for that tier',         '1'),
 ( 6, N'Issue: customer who turned offers off gets the reward but no message',     '1|0'),
 ( 7, N'Issue: two customers moving up in one statement get one reward each',      '2'),
 ( 8, N'View: after losing the tier the reward is hidden',                         '0'),
 ( 9, N'View: shows the reward right after earning it (15%)',                      '1|15.00'),
 (10, N'View: shows the reward of the highest tier held',                          't2'),
 (11, N'Use: another customer''s reward is rejected',                              '50011'),
 (12, N'Use: a reward that was already used (inactive) is rejected',               '50011'),
 (13, N'Use: an expired reward is rejected',                                       '50011'),
 (14, N'Use: saving 3.01 on a 20.00 line (more than 15%) is rejected',             '50011'),
 (15, N'Use: saving exactly 3.00 on a 20.00 line works',                           'ok'),
 (16, N'Use: saving 500.01 on one order is rejected',                              '50011'),
 (17, N'Use: saving exactly 500.00 on one order works',                            'ok'),
 (18, N'Use: two lines of 300.00 and 250.00 (550.00 in total) is rejected',        '50011'),
 (19, N'Use: an ordinary product discount is not touched by the reward guard',     'ok'),
 (20, N'Use: a reward for a tier the customer lost is rejected',                   '50011'),
 (21, N'Checkout: 15% of 3 x 20.00 = 9.00 and the reward is used up',              '9.00|reward|0|51.00'),
 (22, N'Checkout: the next order gets no reward discount',                         '0.00|none'),
 (23, N'Checkout: a bigger product discount (25%) wins; reward stays active',      '15.00|product|1'),
 (24, N'Checkout: a 4000.00 item saves 500.00 (not 600.00)',                       '500.00|3500.00|0'),
 (25, N'Checkout: the cap runs out on the second line (450.00 then 50.00)',        '450.00|50.00'),
 (26, N'Checkout: a reward for a lost tier is not applied',                        '0.00|none');

-- Setup checks
INSERT INTO @r (Test, Expected, Actual)
VALUES (N'Nested triggers enabled (server setting)', '1',
        (SELECT CAST(value_in_use AS NVARCHAR(40)) FROM sys.configurations WHERE name = 'nested triggers')),
       (N'The 2 reward triggers and the view exist and are enabled', '3',
        (SELECT CAST((SELECT COUNT(*) FROM sys.triggers
                      WHERE is_disabled = 0
                        AND name IN ('TR_CUSTOMER_TierReward', 'TR_TRANSACTION_ITEM_RewardGuard'))
                   + (SELECT COUNT(*) FROM sys.views WHERE name = 'VW_TIER_REWARD') AS NVARCHAR(40))));

DECLARE @case INT = 1,
        @name NVARCHAR(120), @expected NVARCHAR(80),
        @err INT, @msg NVARCHAR(300), @result NVARCHAR(80),
        @today DATE = CAST(SYSDATETIME() AS DATE),
        @startTier INT,                        -- 0 = none, 1 = T1, 2 = T2 (per case)
        @prog INT, @t1 INT, @t2 INT,
        @custA INT, @custB INT, @cat INT, @p1 INT, @big1 INT, @big2 INT, @big3 INT,
        @tx INT, @order INT, @order2 INT, @dRew INT, @dOther INT;
DECLARE @tid TABLE (Transaction_id INT);

WHILE @case <= 26
BEGIN
    SELECT @name = Name, @expected = Expected FROM @cases WHERE Id = @case;
    SET @err = NULL; SET @msg = NULL; SET @result = 'no error'; SET @order = NULL; SET @order2 = NULL;
    DELETE FROM @tid;

    -- Where customer A starts (before the case does its own tier changes)
    SET @startTier = CASE WHEN @case IN (2, 3, 5, 8, 10, 20, 26) THEN 1
                          WHEN @case = 4 THEN 2
                          ELSE 0 END;

    BEGIN TRY
        BEGIN TRAN;

        -- Reward program and two test tiers -----------------------------------
        IF NOT EXISTS (SELECT 1 FROM REWARD_PROGRAM
                       WHERE Effective_to IS NULL OR Effective_to >= DATEADD(DAY, -400, @today))
            INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
            VALUES (N'TIER REWARD TEST PROGRAM', 1.00, 0.0100, DATEADD(DAY, -400, @today), NULL);

        SET @prog = NULL;
        SELECT TOP (1) @prog = Program_id
        FROM   REWARD_PROGRAM
        WHERE  @today >= Effective_from AND (Effective_to IS NULL OR @today <= Effective_to)
        ORDER BY Effective_from DESC;

        INSERT INTO REWARD_TIER (Program_id, Tier_name, Min_points) VALUES (@prog, N'TEST Tier 1', 987650);
        SET @t1 = SCOPE_IDENTITY();
        INSERT INTO REWARD_TIER (Program_id, Tier_name, Min_points) VALUES (@prog, N'TEST Tier 2', 987660);
        SET @t2 = SCOPE_IDENTITY();

        -- People ---------------------------------------------------------------
        INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash, Tier_id, Notify_offers)
        VALUES (N'Reward', N'A', 'tier.reward.a.test@example.com', 'x',
                CASE @startTier WHEN 1 THEN @t1 WHEN 2 THEN @t2 ELSE NULL END,
                CASE WHEN @case = 6 THEN 0 ELSE 1 END);
        SET @custA = SCOPE_IDENTITY();

        INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
        VALUES (N'Reward', N'B', 'tier.reward.b.test@example.com', 'x');
        SET @custB = SCOPE_IDENTITY();

        INSERT INTO CUSTOMER_ADDRESS (Customer_id, Address_type, Recipient_name, Street, Apt, City, State, Zip, is_default)
        VALUES (@custA, 'home', N'Reward A', N'1 Test St', NULL, N'Houston', 'TX', '77001', 1);

        -- Catalog and tax ------------------------------------------------------
        INSERT INTO CATEGORY (Name, Description) VALUES (N'TIER REWARD TEST', N'test');
        SET @cat = SCOPE_IDENTITY();
        INSERT INTO TAX_RATE (Category_id, Rate, Effective_from, Effective_to, State)
        VALUES (@cat, 0.0825, '2000-01-01', NULL, 'TX');

        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TR-TEST-P1', N'Tier reward test P1', N'test', 5.00, 20.00, 10, 1, 'New', @cat, 1);
        SET @p1 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TR-TEST-BIG1', N'Tier reward test BIG1', N'test', 5.00, 4000.00, 10, 1, 'New', @cat, 1);
        SET @big1 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TR-TEST-BIG2', N'Tier reward test BIG2', N'test', 5.00, 3000.00, 10, 1, 'New', @cat, 1);
        SET @big2 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TR-TEST-BIG3', N'Tier reward test BIG3', N'test', 5.00, 3000.00, 10, 1, 'New', @cat, 1);
        SET @big3 = SCOPE_IDENTITY();

        -- Cases 1-10: issuing the reward and the view
        IF @case IN (1, 6, 9)                           -- none -> T1
            UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;
        IF @case IN (2, 10)                             -- T1 -> T2
            UPDATE CUSTOMER SET Tier_id = @t2 WHERE Customer_id = @custA;
        IF @case = 3                                    -- T1 -> T1
            UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;
        IF @case = 4                                    -- T2 -> T1
            UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;
        IF @case = 5                                    -- T1 -> T2 -> T1 -> T2
        BEGIN
            UPDATE CUSTOMER SET Tier_id = @t2 WHERE Customer_id = @custA;
            UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;
            UPDATE CUSTOMER SET Tier_id = @t2 WHERE Customer_id = @custA;
        END;
        IF @case = 7                                    -- both customers, none -> T1, one statement
            UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id IN (@custA, @custB);
        IF @case = 8                                    -- T1 -> T2 -> T1
        BEGIN
            UPDATE CUSTOMER SET Tier_id = @t2 WHERE Customer_id = @custA;
            UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;
        END;

        IF @case = 1
            SET @result = CONCAT(
                (SELECT COUNT(*) FROM DISCOUNT WHERE Code = CONCAT('TIER-', @custA, '-', @t1)
                    AND Amount = 15.00 AND Amount_type = 'percent' AND Is_active = 1), '|',
                (SELECT COUNT(*) FROM NOTIFICATION WHERE Customer_id = @custA
                    AND Notification_type = 'offer' AND Discount_id IS NULL), '|',
                (SELECT MAX(DATEDIFF(DAY, Start_date, End_date)) FROM DISCOUNT
                 WHERE Code = CONCAT('TIER-', @custA, '-', @t1)));
        IF @case = 2
            SET @result = CONCAT(
                (SELECT COUNT(*) FROM DISCOUNT WHERE Code LIKE CONCAT('TIER-', @custA, '-%')), '|',
                CASE WHEN EXISTS (SELECT 1 FROM DISCOUNT WHERE Code = CONCAT('TIER-', @custA, '-', @t2))
                     THEN 't2' ELSE 'other' END);
        IF @case IN (3, 4, 5)
            SET @result = CAST((SELECT COUNT(*) FROM DISCOUNT WHERE Code LIKE CONCAT('TIER-', @custA, '-%')) AS NVARCHAR(40));
        IF @case = 6
            SET @result = CONCAT(
                (SELECT COUNT(*) FROM DISCOUNT WHERE Code LIKE CONCAT('TIER-', @custA, '-%')), '|',
                (SELECT COUNT(*) FROM NOTIFICATION WHERE Customer_id = @custA));
        IF @case = 7
            SET @result = CAST((SELECT COUNT(*) FROM DISCOUNT
                                WHERE Code IN (CONCAT('TIER-', @custA, '-', @t1), CONCAT('TIER-', @custB, '-', @t1))) AS NVARCHAR(40));
        IF @case = 8
            SET @result = CAST((SELECT COUNT(*) FROM VW_TIER_REWARD WHERE Customer_id = @custA) AS NVARCHAR(40));
        IF @case = 9
            SET @result = CONCAT((SELECT COUNT(*) FROM VW_TIER_REWARD WHERE Customer_id = @custA), '|',
                                 (SELECT MAX(CAST(Percent_off AS NVARCHAR(40))) FROM VW_TIER_REWARD WHERE Customer_id = @custA));
        IF @case = 10
            SET @result = CASE WHEN (SELECT MAX(Reward_tier_id) FROM VW_TIER_REWARD WHERE Customer_id = @custA) = @t2
                               THEN 't2' ELSE 'other' END;

        -- Cases 11-20: using the reward (guard trigger)
        IF @case BETWEEN 11 AND 20
        BEGIN
            -- A earns the T1 reward (none -> T1), except case 20 where A holds T2 rewards below
            IF @case <= 19
                UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;
            IF @case = 20
            BEGIN
                UPDATE CUSTOMER SET Tier_id = @t2 WHERE Customer_id = @custA;   -- earns the T2 reward
                UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;   -- loses the tier again
            END;

            SELECT @dRew = Discount_id FROM DISCOUNT
            WHERE Code = CONCAT('TIER-', @custA, '-', CASE WHEN @case = 20 THEN @t2 ELSE @t1 END);

            IF @case = 12 UPDATE DISCOUNT SET Is_active = 0 WHERE Discount_id = @dRew;
            IF @case = 13 UPDATE DISCOUNT SET Start_date = DATEADD(DAY, -10, @today), End_date = DATEADD(DAY, -1, @today)
                          WHERE Discount_id = @dRew;

            INSERT INTO SALES_TRANSACTION (Customer_id, Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
            VALUES (CASE WHEN @case = 11 THEN @custB ELSE @custA END,
                    N'Reward Test', N'1 Test St', NULL, N'Houston', 'TX', '77001');
            SET @tx = SCOPE_IDENTITY();

            IF @case IN (11, 12, 13, 20)
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @p1, 1, 20.00, @dRew, 3.00);
            IF @case = 14
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @p1, 1, 20.00, @dRew, 3.01);
            IF @case = 15
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @p1, 1, 20.00, @dRew, 3.00);
            IF @case = 16
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @big1, 1, 4000.00, @dRew, 500.01);
            IF @case = 17
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @big1, 1, 4000.00, @dRew, 500.00);
            IF @case = 18
            BEGIN
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @big2, 1, 3000.00, @dRew, 300.00);                  -- fine on its own
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @big3, 1, 3000.00, @dRew, 250.00);                  -- 550.00 in total
            END;
            IF @case = 19
            BEGIN
                INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Is_active)
                VALUES (N'TIER TEST product 50%', 'product sale', 50.00, 'percent', @today, DATEADD(DAY, 1, @today), 1);
                SET @dOther = SCOPE_IDENTITY();
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @p1, 1, 20.00, @dOther, 10.00);
            END;

            SET @result = 'ok';
        END;

        -- Cases 21-26: the reward on a real checkout
        IF @case BETWEEN 21 AND 26
        BEGIN
            IF @case BETWEEN 21 AND 25
                UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;      -- none -> T1: the reward
            IF @case = 26
            BEGIN
                UPDATE CUSTOMER SET Tier_id = @t2 WHERE Customer_id = @custA;      -- earns the T2 reward
                UPDATE CUSTOMER SET Tier_id = @t1 WHERE Customer_id = @custA;      -- then loses the tier
            END;

            SELECT @dRew = Discount_id FROM DISCOUNT
            WHERE Code = CONCAT('TIER-', @custA, '-', CASE WHEN @case = 26 THEN @t2 ELSE @t1 END);

            IF @case = 23
            BEGIN
                INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Is_active)
                VALUES (N'TIER TEST product 25%', 'product sale', 25.00, 'percent', @today, DATEADD(DAY, 1, @today), 1);
                SET @dOther = SCOPE_IDENTITY();
                UPDATE PRODUCT SET Discount_id = @dOther WHERE Product_id = @p1;
            END;

            IF @case IN (21, 22, 23, 26) INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@custA, @p1, 3);
            IF @case = 24 INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@custA, @big1, 1);
            IF @case = 25 INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@custA, @big2, 1), (@custA, @big3, 1);

            INSERT INTO @tid EXEC sp_Checkout @custA, 'credit', '4242';
            SELECT @order = Transaction_id FROM @tid;

            IF @case = 21
                SET @result = CONCAT(
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1), '|',
                    CASE WHEN (SELECT Discount_id FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1) = @dRew
                         THEN 'reward' ELSE 'other' END, '|',
                    (SELECT CAST(Is_active AS NVARCHAR(40)) FROM DISCOUNT WHERE Discount_id = @dRew), '|',
                    (SELECT CAST(Subtotal AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order));

            IF @case = 22
            BEGIN
                -- the second order: the reward is already used up
                DELETE FROM @tid;
                INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@custA, @p1, 1);
                INSERT INTO @tid EXEC sp_Checkout @custA, 'credit', '4242';
                SELECT @order2 = Transaction_id FROM @tid;
                SET @result = CONCAT(
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order2 AND Product_id = @p1), '|',
                    CASE WHEN (SELECT Discount_id FROM TRANSACTION_ITEM WHERE Transaction_id = @order2 AND Product_id = @p1) IS NULL
                         THEN 'none' ELSE 'used' END);
            END;

            IF @case = 23
                SET @result = CONCAT(
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1), '|',
                    CASE WHEN (SELECT Discount_id FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1) = @dOther
                         THEN 'product' ELSE 'other' END, '|',
                    (SELECT CAST(Is_active AS NVARCHAR(40)) FROM DISCOUNT WHERE Discount_id = @dRew));

            IF @case = 24
                SET @result = CONCAT(
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @big1), '|',
                    (SELECT CAST(Subtotal AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order), '|',
                    (SELECT CAST(Is_active AS NVARCHAR(40)) FROM DISCOUNT WHERE Discount_id = @dRew));

            IF @case = 25
                SET @result = CONCAT(
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @big2), '|',
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @big3));

            IF @case = 26
                SET @result = CONCAT(
                    (SELECT CAST(Discount_amount AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1), '|',
                    CASE WHEN (SELECT Discount_id FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1) IS NULL
                         THEN 'none' ELSE 'used' END);
        END;
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        SET @msg = LEFT(ERROR_MESSAGE(), 300);
    END CATCH;

    IF XACT_STATE() <> 0 ROLLBACK TRAN;   -- undo this case completely

    INSERT INTO @r (Test, Expected, Actual, Detail)
    VALUES (@name, @expected,
            CASE WHEN @err IS NOT NULL THEN CAST(@err AS NVARCHAR(40)) ELSE @result END,
            @msg);

    SET @case += 1;
END;

-- Clean-up checks
INSERT INTO @r (Test, Expected, Actual)
VALUES (N'Test data rolled back (leftover test customers)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM CUSTOMER WHERE Email LIKE 'tier.reward.%.test@example.com')),
       (N'Test data rolled back (leftover test tiers)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM REWARD_TIER WHERE Min_points IN (987650, 987660)));

-- Result
SELECT Seq, Test, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result,
       Detail
FROM   @r
ORDER BY Seq;

SELECT SUM(CASE WHEN Expected = Actual THEN 1 ELSE 0 END) AS Passed,
       SUM(CASE WHEN Expected = Actual THEN 0 ELSE 1 END) AS Failed,
       COUNT(*) AS Total
FROM   @r;