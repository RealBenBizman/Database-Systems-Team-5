/*
   test_guards.sql - tests for the seven guard triggers (db/core)

     TR_REVIEW_Guard                     cases  1- 6   (error 50004)
     TR_TRANSACTION_ITEM_Guard           cases  7-12   (error 50005)
     TR_PAYMENT_Guard                    cases 13-16   (error 50006)
     TR_SALES_TRANSACTION_PaymentCheck   cases 17-20   (error 50007)
     TR_PRODUCT_RETURN_ITEM_Guard        cases 21-33   (error 50008)
     TR_PRODUCT_RETURN_Refunded          cases 34-39   (errors 50009 and 50001)
     TR_INVENTORY_ADJUSTMENT_Apply       cases 40-45   (error 50010)

   Every case builds its own small world inside a transaction and ROLLS IT BACK,
   so no test data is left. It works on an empty database and on a seeded one.
   Run it as a single batch (there are no GO separators on purpose), after
   schema.sql and triggers.sql. Expected result: 47 checks, all PASS.

   The standard sale used by most cases (customer A):
       P1  2 x 20.00 = 40.00       P2  3 x 20.00 = 60.00
       Subtotal 100.00, Tax 8.25, Total 108.25, paid by one card payment
   Every product starts with stock 10 and reorder threshold 1. P3 is never in the sale.
   Refund of 1 of the 2 P1 units: (40.00 + 8.25 * 40 / 100) / 2 = 21.65.

   The reward program: if one is already active it is used, otherwise a test
   program is created inside the transaction (and rolled back with it). Point
   amounts are therefore computed from whatever Points_per_dollar is active.
*/
USE pos_store;
SET NOCOUNT ON;

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Test NVARCHAR(120), Expected NVARCHAR(80),
                  Actual NVARCHAR(80), Detail NVARCHAR(300));

DECLARE @cases TABLE (Id INT PRIMARY KEY, Name NVARCHAR(120), Expected NVARCHAR(80));

INSERT INTO @cases (Id, Name, Expected)
VALUES
 ( 1, N'Review: linked to another customer''s sale is rejected',            '50004'),
 ( 2, N'Review: linked to a sale that is still open is rejected',           '50004'),
 ( 3, N'Review: product that is not in that sale is rejected',              '50004'),
 ( 4, N'Review: own completed sale and a product from it works',            'ok'),
 ( 5, N'Review: with no sale at all works',                                 'ok'),
 ( 6, N'Review: updating it to a product not in the sale is rejected',      '50004'),
 ( 7, N'Item: adding to a completed sale is rejected',                      '50005'),
 ( 8, N'Item: removing from a completed sale is rejected',                  '50005'),
 ( 9, N'Item: changing the quantity on a completed sale is rejected',       '50005'),
 (10, N'Item: quantity above the stock on an open sale is rejected',        '50005'),
 (11, N'Item: quantity equal to the stock on an open sale works',           'ok'),
 (12, N'Item: raising a quantity within stock on an open sale works',       'ok'),
 (13, N'Payment: on a completed sale is rejected',                          '50006'),
 (14, N'Payment: a new one that pushes the sum above the total is rejected','50006'),
 (15, N'Payment: raising an amount above the total is rejected',            '50006'),
 (16, N'Payment: two payments that add up to the total work',               'ok'),
 (17, N'Complete: payments short of the total is rejected',                 '50007'),
 (18, N'Complete: with no payments is rejected',                            '50007'),
 (19, N'Complete: with no items is rejected',                               '50007'),
 (20, N'Complete: with payments equal to the total works',                  'completed'),
 (21, N'Return item: 1 of 2 units at exactly 21.65 works',                  'ok'),
 (22, N'Return item: 21.66 (one cent too high) is rejected',                '50008'),
 (23, N'Return item: product that is not in the sale is rejected',          '50008'),
 (24, N'Return item: sale that is not completed is rejected',               '50008'),
 (25, N'Return item: 3 units when 2 were bought is rejected',               '50008'),
 (26, N'Return item: second return that goes over what was bought is rejected','50008'),
 (27, N'Return item: units of a DENIED return do not count',                'ok'),
 (28, N'Return item: requested exactly 30 days after the sale works',       'ok'),
 (29, N'Return item: requested 30 days and 1 second after is rejected',     '50008'),
 (30, N'Return item: adding an item after approval is rejected',            '50008'),
 (31, N'Return item: changing an item after approval is rejected',          '50008'),
 (32, N'Return item: whole sale, two lines in one statement works',         'ok'),
 (33, N'Return item: two lines in one statement, one too high, rejected',   '50008'),
 (34, N'Refund: approved -> refunded restocks and takes back points',       'x'),
 (35, N'Refund: two items restock both and take back one summed points row','x'),
 (36, N'Refund: requested -> refunded is rejected',                         '50009'),
 (37, N'Refund: denied -> refunded is rejected',                            '50009'),
 (38, N'Refund: saving a refunded return again changes nothing',            'x'),
 (39, N'Refund: customer without enough points is rejected',                'x'),
 (40, N'Adjustment: +5 adds to the stock',                                  'stock 15'),
 (41, N'Adjustment: -3 subtracts from the stock',                           'stock 7'),
 (42, N'Adjustment: -11 with stock 10 is rejected',                         '50010'),
 (43, N'Adjustment: +4 and -2 in one statement net +2',                     'stock 12'),
 (44, N'Adjustment: down to 0 works and opens a low-stock alert',           'stock 0; alerts 1'),
 (45, N'Adjustment: one bad product in a multi-row insert is rejected',     '50010');

-- Setup checks
INSERT INTO @r (Test, Expected, Actual)
VALUES (N'Nested triggers enabled (server setting)', '1',
        (SELECT CAST(value_in_use AS NVARCHAR(40)) FROM sys.configurations WHERE name = 'nested triggers')),
       (N'The 7 guard triggers exist and are enabled', '7',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.triggers
         WHERE is_disabled = 0
           AND name IN ('TR_REVIEW_Guard', 'TR_TRANSACTION_ITEM_Guard', 'TR_PAYMENT_Guard',
                        'TR_SALES_TRANSACTION_PaymentCheck', 'TR_PRODUCT_RETURN_ITEM_Guard',
                        'TR_PRODUCT_RETURN_Refunded', 'TR_INVENTORY_ADJUSTMENT_Apply')));

DECLARE @case INT = 1,
        @name NVARCHAR(120), @expected NVARCHAR(80),
        @err INT, @msg NVARCHAR(300), @result NVARCHAR(80),
        @today DATE = CAST(SYSDATETIME() AS DATE),
        @eta   DATE = DATEADD(DAY, 5, CAST(SYSDATETIME() AS DATE)),
        -- fixture switches (set per case)
        @complete BIT, @noitems BIT, @nosale BIT, @pay1 DECIMAL(10,2), @pay2 DECIMAL(10,2),
        @saledate DATETIME2, @reqat DATETIME2,
        -- ids and helpers
        @custA INT, @custB INT, @emp INT, @cat INT, @p1 INT, @p2 INT, @p3 INT,
        @tx INT, @ret INT, @ret2 INT, @prog INT, @ppd DECIMAL(6,2), @bal INT;

WHILE @case <= 45
BEGIN
    SELECT @name = Name, @expected = Expected FROM @cases WHERE Id = @case;
    SET @err = NULL; SET @msg = NULL; SET @result = 'no error';

    -- Fixture switches for this case ----------------------------------------
    SET @complete = 1;                       -- complete the standard sale?
    SET @noitems  = 0;                       -- sale without items (and payments)?
    SET @nosale   = CASE WHEN @case >= 40 THEN 1 ELSE 0 END;   -- adjustment cases need no sale
    SET @pay1     = 108.25;
    SET @pay2     = NULL;
    SET @saledate = SYSDATETIME();
    SET @reqat    = SYSDATETIME();

    IF @case IN (2, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 24) SET @complete = 0;
    IF @case = 16 BEGIN SET @pay1 = 50.00; SET @pay2 = 58.25; END
    IF @case = 17 SET @pay1 = 100.00;
    IF @case = 18 SET @pay1 = NULL;
    IF @case = 19 BEGIN SET @noitems = 1; SET @pay1 = NULL; END
    IF @case IN (28, 29)
    BEGIN
        SET @saledate = DATEADD(DAY, -10, SYSDATETIME());
        SET @reqat    = DATEADD(DAY, 30, @saledate);
        IF @case = 29 SET @reqat = DATEADD(SECOND, 1, @reqat);
    END

    BEGIN TRY
        BEGIN TRAN;

        -- People, catalog -----------------------------------------------------
        INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
        VALUES (N'Guard', N'A', 'guards.a.test@example.com', 'x');
        SET @custA = SCOPE_IDENTITY();

        INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
        VALUES (N'Guard', N'B', 'guards.b.test@example.com', 'x');
        SET @custB = SCOPE_IDENTITY();

        INSERT INTO EMPLOYEE (FirstName, LastName, Email, Phone_number, Role, Hire_date, Password_hash)
        VALUES (N'Guard', N'Employee', 'guards.emp.test@example.com', '5550001111', 'Support', '2020-01-01', 'x');
        SET @emp = SCOPE_IDENTITY();

        INSERT INTO CATEGORY (Name, Description) VALUES (N'GUARDS TEST', N'test');
        SET @cat = SCOPE_IDENTITY();

        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
        VALUES ('GD-TEST-001', N'Guard test 1', N'test', 5.00, 20.00, 10, 1, 'New', @cat);
        SET @p1 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
        VALUES ('GD-TEST-002', N'Guard test 2', N'test', 5.00, 20.00, 10, 1, 'New', @cat);
        SET @p2 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
        VALUES ('GD-TEST-003', N'Guard test 3', N'test', 5.00, 20.00, 10, 1, 'New', @cat);
        SET @p3 = SCOPE_IDENTITY();

        -- Reward program: use the active one, or create a test one --------------
        -- (the test one is only created when no program is active or planned)
        IF NOT EXISTS (SELECT 1 FROM REWARD_PROGRAM
                       WHERE Effective_to IS NULL OR Effective_to >= DATEADD(DAY, -400, @today))
            INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
            VALUES (N'GUARDS TEST PROGRAM', 1.00, 0.0100, DATEADD(DAY, -400, @today), NULL);

        SET @prog = NULL; SET @ppd = NULL;
        SELECT TOP (1) @prog = Program_id, @ppd = Points_per_dollar
        FROM   REWARD_PROGRAM
        WHERE  @today >= Effective_from AND (Effective_to IS NULL OR @today <= Effective_to)
        ORDER BY Effective_from DESC;
        SET @ppd = ISNULL(@ppd, 0);

        -- The standard sale (open -> items -> payments -> optionally completed) -
        IF @nosale = 0
        BEGIN
            INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                           Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
            VALUES (@custA, NULL, @saledate,
                    CASE WHEN @noitems = 1 THEN 0.00 ELSE 100.00 END,
                    CASE WHEN @noitems = 1 THEN 0.00 ELSE 8.25 END,
                    CASE WHEN @noitems = 1 THEN 0.00 ELSE 108.25 END,
                    'open', 'Guard Test', '1 Test St', NULL, 'Houston', 'TX', '77001');
            SET @tx = SCOPE_IDENTITY();

            IF @noitems = 0
            BEGIN
                INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
                VALUES (@tx, @p1, 2, 20.00, NULL, 0.00),
                       (@tx, @p2, 3, 20.00, NULL, 0.00);
            END

            IF @pay1 IS NOT NULL
                INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@tx, 'credit', @pay1, '4242');
            IF @pay2 IS NOT NULL
                INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@tx, 'debit', @pay2, '1111');

            IF @complete = 1
                UPDATE SALES_TRANSACTION
                SET    Status = 'completed', Tracking_number = 'GD-TRK-1', Estimated_arrival = @eta
                WHERE  Transaction_id = @tx;
        END

        -- A return request, for the return and refund cases ----------------------
        IF @case BETWEEN 21 AND 39
        BEGIN
            INSERT INTO PRODUCT_RETURN (Transaction_id, Employee_id, Requested_at, Status, Reason)
            VALUES (@tx, NULL, @reqat, 'requested', N'Guard test');
            SET @ret = SCOPE_IDENTITY();
        END

        -- ======================================================================
        -- The step under test
        -- ======================================================================

        -- ---- TR_REVIEW_Guard ---------------------------------------------------
        IF @case = 1
            INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
            VALUES (5, N'x', @p1, @custB, @tx);                 -- sale belongs to A, review by B
        IF @case = 2
            INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
            VALUES (5, N'x', @p1, @custA, @tx);                 -- sale is still open
        IF @case = 3
            INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
            VALUES (5, N'x', @p3, @custA, @tx);                 -- P3 is not in the sale
        IF @case = 4
        BEGIN
            INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
            VALUES (5, N'x', @p1, @custA, @tx);
            SET @result = 'ok';
        END
        IF @case = 5
        BEGIN
            INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
            VALUES (4, N'x', @p3, @custB, NULL);
            SET @result = 'ok';
        END
        IF @case = 6
        BEGIN
            INSERT INTO REVIEW (Rating, Comment, Product_id, Customer_id, Transaction_id)
            VALUES (5, N'x', @p1, @custA, @tx);                 -- valid
            UPDATE REVIEW SET Product_id = @p3 WHERE Customer_id = @custA;   -- no longer valid
        END

        -- ---- TR_TRANSACTION_ITEM_Guard ----------------------------------------
        IF @case = 7
            INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
            VALUES (@tx, @p3, 1, 20.00, NULL, 0.00);
        IF @case = 8
            DELETE FROM TRANSACTION_ITEM WHERE Transaction_id = @tx AND Product_id = @p1;
        IF @case = 9
            UPDATE TRANSACTION_ITEM SET Quantity = 1 WHERE Transaction_id = @tx AND Product_id = @p1;
        IF @case = 10
            INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
            VALUES (@tx, @p3, 11, 20.00, NULL, 0.00);           -- stock is 10
        IF @case = 11
        BEGIN
            INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
            VALUES (@tx, @p3, 10, 20.00, NULL, 0.00);
            SET @result = 'ok';
        END
        IF @case = 12
        BEGIN
            UPDATE TRANSACTION_ITEM SET Quantity = 5 WHERE Transaction_id = @tx AND Product_id = @p1;
            SET @result = 'ok';
        END

        -- ---- TR_PAYMENT_Guard ---------------------------------------------------
        IF @case = 13
            INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@tx, 'debit', 1.00, '1111');
        IF @case = 14
            INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@tx, 'debit', 0.01, '1111');
        IF @case = 15
            UPDATE PAYMENT SET Amount = 108.26 WHERE Transaction_id = @tx;
        IF @case = 16
            SET @result = 'ok';                                  -- the fixture itself inserted 50.00 + 58.25

        -- ---- TR_SALES_TRANSACTION_PaymentCheck ----------------------------------
        IF @case BETWEEN 17 AND 20
        BEGIN
            UPDATE SALES_TRANSACTION
            SET    Status = 'completed', Tracking_number = 'GD-TRK-2', Estimated_arrival = @eta
            WHERE  Transaction_id = @tx;
            IF @case = 20
                SET @result = (SELECT Status FROM SALES_TRANSACTION WHERE Transaction_id = @tx);
        END

        -- ---- TR_PRODUCT_RETURN_ITEM_Guard -----------------------------------------
        IF @case IN (21, 28)
        BEGIN
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
            SET @result = 'ok';
        END
        IF @case IN (22, 29)
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount)
            VALUES (@ret, @p1, 1, CASE WHEN @case = 22 THEN 21.66 ELSE 21.65 END);
        IF @case = 23
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p3, 1, 0.00);
        IF @case = 24
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 0.00);
        IF @case = 25
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 3, 0.00);
        IF @case IN (26, 27)
        BEGIN
            -- first return: 1 unit of P1; in case 27 it is then denied
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
            IF @case = 27
                UPDATE PRODUCT_RETURN SET Status = 'denied', Employee_id = @emp WHERE Return_id = @ret;

            INSERT INTO PRODUCT_RETURN (Transaction_id, Employee_id, Status, Reason)
            VALUES (@tx, NULL, 'requested', N'Guard test 2');
            SET @ret2 = SCOPE_IDENTITY();

            -- second return: 2 units of P1. With the first one counted that is 3 of 2 (case 26);
            -- with the first one denied it is 2 of 2 and fits (case 27).
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret2, @p1, 2, 43.30);
            IF @case = 27 SET @result = 'ok';
        END
        IF @case IN (30, 31)
        BEGIN
            IF @case = 31
                INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
            UPDATE PRODUCT_RETURN SET Status = 'approved', Employee_id = @emp WHERE Return_id = @ret;
            IF @case = 30
                INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
            IF @case = 31
                UPDATE PRODUCT_RETURN_ITEM SET Refund_amount = 10.00 WHERE Return_id = @ret AND Product_id = @p1;
        END
        IF @case IN (32, 33)
        BEGIN
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount)
            VALUES (@ret, @p1, 2, 43.30),
                   (@ret, @p2, 3, CASE WHEN @case = 32 THEN 64.95 ELSE 64.96 END);
            IF @case = 32 SET @result = 'ok';
        END

        -- ---- TR_PRODUCT_RETURN_Refunded ----------------------------------------------
        IF @case IN (34, 35, 38, 39)
        BEGIN
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
            IF @case = 35
                INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p2, 1, 21.65);

            UPDATE PRODUCT_RETURN SET Status = 'approved', Employee_id = @emp WHERE Return_id = @ret;

            IF @case = 39
            BEGIN
                -- the customer has already spent every point
                SET @bal = (SELECT Loyalty_points FROM CUSTOMER WHERE Customer_id = @custA);
                IF @bal > 0
                    INSERT INTO LOYALTY_TRANSACTION (Customer_id, Transaction_id, Program_id, Points_change, Reason)
                    VALUES (@custA, NULL, @prog, -@bal, N'Guard test spend');
            END

            UPDATE PRODUCT_RETURN
            SET    Status = 'refunded', Refunded_at = SYSDATETIME(), Refund_total = CASE WHEN @case = 35 THEN 43.30 ELSE 21.65 END
            WHERE  Return_id = @ret;

            IF @case = 38
                UPDATE PRODUCT_RETURN SET Status = 'refunded', Reason = N'Saved again' WHERE Return_id = @ret;

            -- what happened: stock of P1 (and P2), and the points rows made by the refund
            SET @result =
                CONCAT('stock ', (SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @p1),
                       CASE WHEN @case = 35 THEN CONCAT('/', (SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @p2)) ELSE '' END,
                       '; points ', ISNULL((SELECT SUM(Points_change) FROM LOYALTY_TRANSACTION
                                            WHERE Customer_id = @custA AND Reason = N'Return refund'), 0),
                       '; rows ',   (SELECT COUNT(*) FROM LOYALTY_TRANSACTION
                                     WHERE Customer_id = @custA AND Reason = N'Return refund'));

            -- the expected text, from the active Points_per_dollar:
            --  case 34/38: 1 of 2 P1 -> stock 8+1 = 9, points -FLOOR(20 * ppd)
            --  case 35   : +1 P1 and +1 P2 -> stock 9/8, points -FLOOR((20 + 20) * ppd)
            --  case 39   : handled below (error 50001 when there are points to take back)
            IF @case IN (34, 38)
                SET @expected = CONCAT('stock 9; points ', -CAST(FLOOR(20 * @ppd) AS INT),
                                       '; rows ', CASE WHEN FLOOR(20 * @ppd) > 0 THEN 1 ELSE 0 END);
            IF @case = 35
                SET @expected = CONCAT('stock 9/8; points ', -CAST(FLOOR(40 * @ppd) AS INT),
                                       '; rows ', CASE WHEN FLOOR(40 * @ppd) > 0 THEN 1 ELSE 0 END);
        END
        IF @case IN (36, 37)
        BEGIN
            INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
            IF @case = 37
                UPDATE PRODUCT_RETURN SET Status = 'denied', Employee_id = @emp WHERE Return_id = @ret;
            UPDATE PRODUCT_RETURN
            SET    Status = 'refunded', Employee_id = @emp, Refunded_at = SYSDATETIME(), Refund_total = 21.65
            WHERE  Return_id = @ret;
        END

        -- ---- TR_INVENTORY_ADJUSTMENT_Apply ------------------------------------------------
        IF @case IN (40, 41, 42, 44)
        BEGIN
            INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason)
            VALUES (@p1, @emp, CASE @case WHEN 40 THEN 5 WHEN 41 THEN -3 WHEN 42 THEN -11 ELSE -10 END, N'Guard test');
            SET @result = CONCAT('stock ', (SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @p1));
            IF @case = 44
                SET @result = CONCAT(@result, '; alerts ',
                                     (SELECT COUNT(*) FROM LOW_STOCK_ALERT WHERE Product_id = @p1 AND Resolved_at IS NULL));
        END
        IF @case = 43
        BEGIN
            INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason)
            VALUES (@p1, @emp, 4, N'Guard test'), (@p1, @emp, -2, N'Guard test');
            SET @result = CONCAT('stock ', (SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @p1));
        END
        IF @case = 45
            INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason)
            VALUES (@p1, @emp, 5, N'Guard test'), (@p2, @emp, -11, N'Guard test');
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        SET @msg = LEFT(ERROR_MESSAGE(), 300);
    END CATCH;

    IF XACT_STATE() <> 0 ROLLBACK TRAN;   -- undo this case completely

    -- Case 39: when points exist to take back the refund must fail with 50001;
    -- when the active program gives no points there is nothing to take back.
    IF @case = 39
        SET @expected = CASE WHEN FLOOR(20 * @ppd) > 0 AND FLOOR(100 * @ppd) > 0 THEN '50001'
                             ELSE 'stock 9; points 0; rows 0' END;

    INSERT INTO @r (Test, Expected, Actual, Detail)
    VALUES (@name, @expected,
            CASE WHEN @err IS NOT NULL THEN CAST(@err AS NVARCHAR(40)) ELSE @result END,
            @msg);

    SET @case += 1;
END;

-- ===========================================================================
-- Result
-- ===========================================================================
SELECT Seq, Test, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result,
       Detail
FROM   @r
ORDER BY Seq;

SELECT SUM(CASE WHEN Expected = Actual THEN 1 ELSE 0 END) AS Passed,
       SUM(CASE WHEN Expected = Actual THEN 0 ELSE 1 END) AS Failed,
       COUNT(*) AS Total
FROM   @r;