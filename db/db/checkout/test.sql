-- Tests sp_Checkout (db/checkout/sp_checkout.sql) and prints a PASS/FAIL grid.
--
-- Run it after schema.sql, triggers.sql, views.sql and sp_checkout.sql, as a SINGLE
-- batch (there are no GO separators on purpose). It builds its own test customer,
-- categories and products, so it does not depend on the seed data, and every
-- scenario runs in a transaction that is ROLLED BACK: nothing stays in the database.
--
--   Step 1  the rules that stop a checkout (errors 50040 to 50046)
--   Step 2  a full checkout: sale, items, tax, payment, cart, stock, alert, points
--   Step 3  discounts: single largest wins; fixed = once per line; capped at the line;
--           expired or paused discounts are ignored
--   Step 4  checking out twice does not charge twice
--
-- Expected result: every row says PASS.
USE pos_store;
SET NOCOUNT ON;

DECLARE @r TABLE (
    Seq         INT IDENTITY(1,1),
    Step        NVARCHAR(10),
    Description NVARCHAR(90),
    Expected    NVARCHAR(40),
    Actual      NVARCHAR(40)
);
DECLARE @tid TABLE (Transaction_id INT);

DECLARE @case INT = 1, @cases INT = 14,
        @today DATE = CAST(SYSDATETIME() AS DATE),
        @stage NVARCHAR(10), @err INT, @err2 INT, @fatal NVARCHAR(4000) = NULL,
        @cust INT, @catA INT, @catB INT, @p1 INT, @p2 INT, @p4 INT,
        @dProd INT, @dCat INT, @order INT, @callCust INT, @method VARCHAR(10), @card CHAR(4),
        @discAmt NVARCHAR(40), @discId INT;

WHILE @case <= @cases AND @fatal IS NULL
BEGIN
    SET @err = NULL; SET @err2 = NULL; SET @order = NULL; SET @stage = 'setup';
    SET @method = 'credit'; SET @card = '4242';
    DELETE FROM @tid;

    BEGIN TRY
        BEGIN TRAN;

        -- ---- common setup: a customer in TX, two categories, three products, tax rates ----
        INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash, Loyalty_points, Created_date)
        VALUES ('Test', 'Checkout', 'sp.checkout.test@example.com', 'x', 0, SYSDATETIME());
        SET @cust = SCOPE_IDENTITY();
        SET @callCust = @cust;

        IF @case <> 4   -- case 4 has no default address
            INSERT INTO CUSTOMER_ADDRESS (Customer_id, Address_type, Recipient_name, Street, Apt, City, State, Zip, is_default)
            VALUES (@cust, 'home', 'Test Checkout', '1 Test St', NULL, 'Houston', 'TX', '77001', 1);

        INSERT INTO CATEGORY (Name, Description) VALUES ('TEST CO Category A', 'test');
        SET @catA = SCOPE_IDENTITY();
        INSERT INTO CATEGORY (Name, Description) VALUES ('TEST CO Category B', 'test');
        SET @catB = SCOPE_IDENTITY();

        -- P1 $20.00 stock 10 (threshold 7), P2 inactive, P4 $9.99 stock 20 (threshold 2)
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TEST-CO-1', 'TEST CO Product 1', 'test', 5.00, 20.00, 10, 7, 'New', @catA, 1);
        SET @p1 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TEST-CO-2', 'TEST CO Product 2 (inactive)', 'test', 5.00, 20.00, 10, 2, 'New', @catA, 0);
        SET @p2 = SCOPE_IDENTITY();
        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Is_active)
        VALUES ('TEST-CO-4', 'TEST CO Product 4', 'test', 3.00, 9.99, 20, 2, 'New', @catB, 1);
        SET @p4 = SCOPE_IDENTITY();

        IF @case <> 5   -- case 5 has no tax rate for category A
            INSERT INTO TAX_RATE (Category_id, Rate, Effective_from, Effective_to, State)
            VALUES (@catA, 0.0825, '2000-01-01', NULL, 'TX');
        INSERT INTO TAX_RATE (Category_id, Rate, Effective_from, Effective_to, State)
        VALUES (@catB, 0.0825, '2000-01-01', NULL, 'TX');

        -- ---- case-specific cart and discounts ----
        IF @case = 2  INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@cust, @p2, 1);
        IF @case = 3  INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@cust, @p1, 11);
        IF @case IN (4, 5, 6, 7, 8) INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@cust, @p1, 1);
        IF @case >= 9
            INSERT INTO CART_ITEM (Customer_id, Product_id, Quantity) VALUES (@cust, @p1, 3), (@cust, @p4, 1);

        IF @case = 6 SET @method = 'cash';
        IF @case = 7 SET @card = '12a4';
        IF @case = 8 SET @callCust = 9999999;

        -- 10: product 10% ($6.00 on the $60.00 line) against category fixed $5.00 -> the product discount wins
        IF @case = 10
        BEGIN
            INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Is_active)
            VALUES ('TEST CO product 10%', 'product sale', 10.00, 'percent', @today, DATEADD(DAY, 1, @today), 1);
            SET @dProd = SCOPE_IDENTITY();
            INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Is_active)
            VALUES ('TEST CO category fixed 5', 'fixed amount', 5.00, 'fixed', @today, DATEADD(DAY, 1, @today), 1);
            SET @dCat = SCOPE_IDENTITY();
            UPDATE PRODUCT  SET Discount_id = @dProd WHERE Product_id  = @p1;
            UPDATE CATEGORY SET Discount_id = @dCat  WHERE Category_id = @catA;
        END;

        -- 11: category fixed $5.00 on 3 units: $5.00 once per line (not $15.00)
        -- 12: category fixed $500.00: the saving stops at the $60.00 line
        IF @case IN (11, 12)
        BEGIN
            INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Is_active)
            VALUES ('TEST CO category fixed', 'fixed amount', CASE WHEN @case = 11 THEN 5.00 ELSE 500.00 END, 'fixed', @today, DATEADD(DAY, 1, @today), 1);
            SET @dCat = SCOPE_IDENTITY();
            UPDATE CATEGORY SET Discount_id = @dCat WHERE Category_id = @catA;
        END;

        -- 13: the product 10% ended yesterday; 14: it is paused (Is_active = 0)
        IF @case IN (13, 14)
        BEGIN
            INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Is_active)
            VALUES ('TEST CO product 10% off', 'product sale', 10.00, 'percent',
                    DATEADD(DAY, -10, @today), CASE WHEN @case = 13 THEN DATEADD(DAY, -1, @today) ELSE DATEADD(DAY, 1, @today) END,
                    CASE WHEN @case = 14 THEN 0 ELSE 1 END);
            SET @dProd = SCOPE_IDENTITY();
            UPDATE PRODUCT SET Discount_id = @dProd WHERE Product_id = @p1;
        END;

        -- ---- run the procedure ----
        SET @stage = 'run';
        IF @case <= 8
            EXEC sp_Checkout @callCust, @method, @card;      -- must fail (it throws, so no result set)
        ELSE
        BEGIN
            INSERT INTO @tid EXEC sp_Checkout @cust, 'credit', '4242';
            SELECT @order = Transaction_id FROM @tid;
        END;
        SET @stage = 'check';

        -- ---- Step 2: a full checkout (case 9) ----
        IF @case = 9
        BEGIN
            INSERT INTO @r (Step, Description, Expected, Actual)
            VALUES ('2', 'Sale is completed', 'completed',
                    (SELECT Status FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Subtotal (3 x 20.00 + 9.99)', '69.99',
                    (SELECT CAST(Subtotal AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Tax, rounded per line (4.95 + 0.82)', '5.77',
                    (SELECT CAST(Tax_amount AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Total', '75.76',
                    (SELECT CAST(Total AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Ship-to copied from the default address', 'Test Checkout|TX|77001',
                    (SELECT CONCAT(Ship_name, '|', Ship_state, '|', Ship_zip) FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Tracking number', CONCAT('TRK', @order),
                    (SELECT Tracking_number FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Estimated arrival (today + 5 days)', CONVERT(NVARCHAR(40), DATEADD(DAY, 5, @today), 23),
                    (SELECT CONVERT(NVARCHAR(40), Estimated_arrival, 23) FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                   ('2', 'Sale lines', '2',
                    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order)),
                   ('2', 'Price snapshot of product 1', '20.00',
                    (SELECT CAST(Unit_price AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1)),
                   ('2', 'One payment', '1',
                    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM PAYMENT WHERE Transaction_id = @order)),
                   ('2', 'Payment equals the Total (credit, 4242)', '75.76|credit|4242',
                    (SELECT CONCAT(CAST(Amount AS NVARCHAR(40)), '|', Method, '|', Card_last4) FROM PAYMENT WHERE Transaction_id = @order)),
                   ('2', 'Cart is empty afterwards', '0',
                    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM CART_ITEM WHERE Customer_id = @cust AND Marked_for_deletion = 0)),
                   ('2', 'Stock of product 1 (10 - 3)', '7',
                    (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @p1)),
                   ('2', 'Stock of product 4 (20 - 1)', '19',
                    (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @p4)),
                   ('2', 'Low-stock alert opened for product 1 (7 <= 7)', '1',
                    (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Product_id = @p1 AND Resolved_at IS NULL)),
                   ('2', 'Loyalty points = floor(Subtotal x points per dollar), or 0 with no program',
                    ISNULL((SELECT CAST(CAST(FLOOR(69.99 * Points_per_dollar) AS INT) AS NVARCHAR(40))
                            FROM REWARD_PROGRAM
                            WHERE @today >= Effective_from AND (Effective_to IS NULL OR @today <= Effective_to)), '0'),
                    (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Customer_id = @cust));

            -- Step 4: the cart is empty now, so a second checkout is refused.
            BEGIN TRY
                EXEC sp_Checkout @cust, 'credit', '4242';
            END TRY
            BEGIN CATCH
                SET @err2 = ERROR_NUMBER();
            END CATCH;
            INSERT INTO @r (Step, Description, Expected, Actual)
            VALUES ('4', 'A second checkout with the emptied cart is refused (error)', '50040', ISNULL(CAST(@err2 AS NVARCHAR(40)), 'no error'));
        END;

        -- ---- Step 3: discounts (cases 10 to 14), read from product 1's sale line ----
        IF @case >= 10
        BEGIN
            SELECT @discAmt = CAST(Discount_amount AS NVARCHAR(40)), @discId = Discount_id
            FROM   TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1;

            IF @case = 10
                INSERT INTO @r (Step, Description, Expected, Actual)
                VALUES ('3', 'Product 10% ($6.00) beats category fixed $5.00', '6.00', @discAmt),
                       ('3', 'The winning discount is the one recorded', 'product', CASE WHEN @discId = @dProd THEN 'product' ELSE 'other' END);
            IF @case = 11
                INSERT INTO @r (Step, Description, Expected, Actual)
                VALUES ('3', 'Fixed $5.00 on 3 units is taken once per line', '5.00', @discAmt),
                       ('3', 'Line total after the fixed discount (60.00 - 5.00)', '55.00',
                        (SELECT CAST(Line_total AS NVARCHAR(40)) FROM TRANSACTION_ITEM WHERE Transaction_id = @order AND Product_id = @p1));
            IF @case = 12
                INSERT INTO @r (Step, Description, Expected, Actual)
                VALUES ('3', 'A $500 fixed discount stops at the $60.00 line', '60.00', @discAmt),
                       ('3', 'Subtotal is then only the other line (9.99)', '9.99',
                        (SELECT CAST(Subtotal AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order)),
                       ('3', 'Total (9.99 + 0.82 tax)', '10.81',
                        (SELECT CAST(Total AS NVARCHAR(40)) FROM SALES_TRANSACTION WHERE Transaction_id = @order));
            IF @case = 13
                INSERT INTO @r (Step, Description, Expected, Actual)
                VALUES ('3', 'An expired discount is ignored', '0.00|none', CONCAT(@discAmt, '|', CASE WHEN @discId IS NULL THEN 'none' ELSE 'used' END));
            IF @case = 14
                INSERT INTO @r (Step, Description, Expected, Actual)
                VALUES ('3', 'A paused discount is ignored', '0.00|none', CONCAT(@discAmt, '|', CASE WHEN @discId IS NULL THEN 'none' ELSE 'used' END));
        END;
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        IF @stage <> 'run'
            SET @fatal = CONCAT('Case ', @case, ' stopped in ', @stage, ': ', ERROR_MESSAGE(), ' (line ', ERROR_LINE(), ')');
    END CATCH;

    IF @@TRANCOUNT > 0 ROLLBACK TRAN;   -- undo every test row

    -- Step 1: the rules that stop a checkout. The error number is what the API turns into a 409.
    IF @case <= 8 AND @fatal IS NULL
        INSERT INTO @r (Step, Description, Expected, Actual)
        SELECT '1', v.Description, v.Expected, ISNULL(CAST(@err AS NVARCHAR(40)), 'no error')
        FROM (VALUES (1, 'Empty cart is refused (error)',                      '50040'),
                     (2, 'Item no longer for sale is refused (error)',         '50041'),
                     (3, 'More than the stock is refused (error)',             '50044'),
                     (4, 'No default shipping address is refused (error)',     '50042'),
                     (5, 'Missing tax rate is refused, not 0% (error)',        '50043'),
                     (6, 'Payment method other than credit/debit (error)',     '50046'),
                     (7, 'Card digits that are not 4 digits (error)',          '50046'),
                     (8, 'Unknown customer is refused (error)',                '50045')) v (Num, Description, Expected)
        WHERE v.Num = @case;

    -- a discount case that failed to run at all is a FAIL, not a silent skip
    IF @case >= 9 AND @fatal IS NULL AND @order IS NULL
        INSERT INTO @r (Step, Description, Expected, Actual)
        VALUES (CASE WHEN @case = 9 THEN '2' ELSE '3' END, CONCAT('Case ', @case, ': the checkout ran'), 'ok', ISNULL(CONCAT('error ', @err), 'no order'));

    SET @case += 1;
END;

INSERT INTO @r (Step, Description, Expected, Actual)
VALUES ('5', 'Test data rolled back (leftover test products)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM PRODUCT WHERE SKU LIKE 'TEST-CO-%')),
       ('5', 'Test data rolled back (leftover test customer)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM CUSTOMER WHERE Email = 'sp.checkout.test@example.com'));

-- Results
IF @fatal IS NOT NULL
    SELECT 'The test stopped early with this error' AS Problem, @fatal AS Message;

SELECT Step, Description, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result
FROM   @r
ORDER BY Seq;
