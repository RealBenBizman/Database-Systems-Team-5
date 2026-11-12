/*
   test_views.sql - tests for the four report views (db/core/views.sql)

     VW_SALES_REPORT, VW_SALES_BY_CATEGORY, VW_INVENTORY_REPORT, VW_REWARDS_REPORT

   It builds a small world inside ONE transaction, reads the views, and ROLLS
   EVERYTHING BACK, so no test data is left. Run it as a single batch (no GO),
   after schema.sql, triggers.sql and views.sql. It works on an empty database
   and on a seeded one. Expected result: 20 checks, all PASS.

   The world (all names contain "VIEWS TEST" or "VW-TEST"):
     Sales day 2001-06-15 (a day with no other data), customer A:
       sale A  completed  P1 x2 + P2 x3, Subtotal 100.00, Tax 8.25, Total 108.25
               then 1 of the 2 P1 units is refunded (pre-tax 20.00)
       sale D  completed, then flagged Marked_for_deletion = 1   -> must be left out
       sale F  open                                              -> must be left out
       sale G  voided                                            -> must be left out
     Today, customer B:
       sale E  completed, P3 x1 at 20.00, fully refunded -> points earned, then taken back
     Products: P1, P2, P3 in category "VIEWS TEST" and a flagged P4 (left out).
     Customer C is flagged (left out).
   The active reward program is used, or a test one is created in the transaction.
*/
USE pos_store;
SET NOCOUNT ON;

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Test NVARCHAR(120), Expected NVARCHAR(80),
                  Actual NVARCHAR(80), Detail NVARCHAR(300));

DECLARE @day   DATE      = '2001-06-15',
        @saleA DATETIME2 = '2001-06-15T10:00:00',
        @today DATE      = CAST(SYSDATETIME() AS DATE),
        @custA INT, @custB INT, @custC INT, @emp INT, @cat INT,
        @p1 INT, @p2 INT, @p3 INT, @txA INT, @txD INT, @txE INT, @ret INT,
        @ppd DECIMAL(6,2), @pts INT;

BEGIN TRY
    BEGIN TRAN;

    -- People and catalog
    INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
    VALUES (N'Views', N'A', 'views.a.test@example.com', 'x');
    SET @custA = SCOPE_IDENTITY();
    INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
    VALUES (N'Views', N'B', 'views.b.test@example.com', 'x');
    SET @custB = SCOPE_IDENTITY();
    INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash, Marked_for_deletion)
    VALUES (N'Views', N'C', 'views.c.test@example.com', 'x', 1);
    SET @custC = SCOPE_IDENTITY();

    INSERT INTO EMPLOYEE (FirstName, LastName, Email, Phone_number, Role, Hire_date, Password_hash)
    VALUES (N'Views', N'Employee', 'views.emp.test@example.com', '5550002222', 'Support', '2020-01-01', 'x');
    SET @emp = SCOPE_IDENTITY();

    INSERT INTO CATEGORY (Name, Description) VALUES (N'VIEWS TEST', N'test');
    SET @cat = SCOPE_IDENTITY();

    INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
    VALUES ('VW-TEST-001', N'Views test 1', N'test', 5.00, 20.00, 10, 1, 'New', @cat);
    SET @p1 = SCOPE_IDENTITY();
    INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
    VALUES ('VW-TEST-002', N'Views test 2', N'test', 5.00, 20.00, 10, 1, 'New', @cat);
    SET @p2 = SCOPE_IDENTITY();
    INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
    VALUES ('VW-TEST-003', N'Views test 3', N'test', 5.00, 20.00, 10, 1, 'New', @cat);
    SET @p3 = SCOPE_IDENTITY();
    INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id, Marked_for_deletion)
    VALUES ('VW-TEST-004', N'Views test 4 (flagged)', N'test', 5.00, 20.00, 10, 1, 'New', @cat, 1);

    -- Reward program: use the active one, or create a test one
    IF NOT EXISTS (SELECT 1 FROM REWARD_PROGRAM
                   WHERE Effective_to IS NULL OR Effective_to >= DATEADD(DAY, -400, @today))
        INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
        VALUES (N'VIEWS TEST PROGRAM', 1.00, 0.0100, DATEADD(DAY, -400, @today), NULL);

    SELECT TOP (1) @ppd = Points_per_dollar
    FROM   REWARD_PROGRAM
    WHERE  @today >= Effective_from AND (Effective_to IS NULL OR @today <= Effective_to)
    ORDER BY Effective_from DESC;
    SET @ppd = ISNULL(@ppd, 0);
    SET @pts = CAST(FLOOR(20 * @ppd) AS INT);     -- points sale E earns (and returns)

    -- Sale A: counted, partly refunded
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@custA, NULL, @saleA, 100.00, 8.25, 108.25, 'open', 'Views Test', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txA = SCOPE_IDENTITY();
    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txA, @p1, 2, 20.00, NULL, 0.00), (@txA, @p2, 3, 20.00, NULL, 0.00);
    INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@txA, 'credit', 108.25, '4242');
    UPDATE SALES_TRANSACTION
    SET    Status = 'completed', Tracking_number = 'VW-TRK-A', Estimated_arrival = '2001-06-20'
    WHERE  Transaction_id = @txA;

    -- Sale D: completed, then flagged
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@custA, NULL, @saleA, 20.00, 0.00, 20.00, 'open', 'Views Test', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txD = SCOPE_IDENTITY();
    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txD, @p3, 1, 20.00, NULL, 0.00);
    INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@txD, 'credit', 20.00, '4242');
    UPDATE SALES_TRANSACTION
    SET    Status = 'completed', Tracking_number = 'VW-TRK-D', Estimated_arrival = '2001-06-20'
    WHERE  Transaction_id = @txD;
    UPDATE SALES_TRANSACTION SET Marked_for_deletion = 1 WHERE Transaction_id = @txD;

    -- Sale F (open) and sale G (voided) on the same day
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status)
    VALUES (@custA, NULL, @saleA, 20.00, 0.00, 20.00, 'open');
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status)
    VALUES (@custA, NULL, @saleA, 20.00, 0.00, 20.00, 'open');
    UPDATE SALES_TRANSACTION SET Status = 'voided' WHERE Transaction_id = SCOPE_IDENTITY();

    -- Sale E: today, customer B, then fully refunded
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@custB, NULL, SYSDATETIME(), 20.00, 0.00, 20.00, 'open', 'Views Test', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txE = SCOPE_IDENTITY();
    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txE, @p3, 1, 20.00, NULL, 0.00);
    INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4) VALUES (@txE, 'debit', 20.00, '1111');
    UPDATE SALES_TRANSACTION
    SET    Status = 'completed', Tracking_number = 'VW-TRK-E', Estimated_arrival = DATEADD(DAY, 5, @today)
    WHERE  Transaction_id = @txE;

    -- Refund 1 of the 2 P1 units of sale A (pre-tax 20.00; refund 21.65 with tax)
    INSERT INTO PRODUCT_RETURN (Transaction_id, Employee_id, Requested_at, Status, Reason)
    VALUES (@txA, NULL, '2001-06-16T09:00:00', 'requested', N'Views test');
    SET @ret = SCOPE_IDENTITY();
    INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p1, 1, 21.65);
    UPDATE PRODUCT_RETURN SET Status = 'approved', Employee_id = @emp WHERE Return_id = @ret;
    UPDATE PRODUCT_RETURN SET Status = 'refunded', Refunded_at = SYSDATETIME(), Refund_total = 21.65 WHERE Return_id = @ret;

    -- Refund the whole of sale E
    INSERT INTO PRODUCT_RETURN (Transaction_id, Employee_id, Status, Reason)
    VALUES (@txE, NULL, 'requested', N'Views test');
    SET @ret = SCOPE_IDENTITY();
    INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount) VALUES (@ret, @p3, 1, 20.00);
    UPDATE PRODUCT_RETURN SET Status = 'approved', Employee_id = @emp WHERE Return_id = @ret;
    UPDATE PRODUCT_RETURN SET Status = 'refunded', Refunded_at = SYSDATETIME(), Refund_total = 20.00 WHERE Return_id = @ret;

    -- Stock states for the inventory view
    -- P1: 10 - 2 sold + 1 returned = 9 (threshold 1)        -> OK
    -- P2: 10 - 3 sold = 7, threshold raised to 7             -> Low, with an alert
    -- P3: 10 - 1 (D) - 1 (E) + 1 returned = 9, adjusted to 0 -> Out of stock
    UPDATE PRODUCT SET Reorder_threshold = 7 WHERE Product_id = @p2;
    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason)
    VALUES (@p3, @emp, -9, N'Views test');

    -- The checks
    INSERT INTO @r (Test, Expected, Actual)
    VALUES (N'The 4 report views exist', '4',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.views
             WHERE name IN ('VW_SALES_REPORT', 'VW_SALES_BY_CATEGORY', 'VW_INVENTORY_REPORT', 'VW_REWARDS_REPORT')));

    -- Sales report
    INSERT INTO @r (Test, Expected, Actual)
    VALUES (N'Sales: one row for the test day', '1',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: orders (open, voided and flagged sales are left out)', '1',
            (SELECT CAST(Orders AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: units', '5',
            (SELECT CAST(Units AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: gross revenue (Subtotal)', '100.00',
            (SELECT CAST(Gross_revenue AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: refunded revenue (pre-tax)', '20.00',
            (SELECT CAST(Refunded_revenue AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: net revenue', '80.00',
            (SELECT CAST(Net_revenue AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: tax collected', '8.25',
            (SELECT CAST(Tax_collected AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day)),
           (N'Sales: total collected', '108.25',
            (SELECT CAST(Total_collected AS NVARCHAR(40)) FROM VW_SALES_REPORT WHERE Sale_date = @day));

    -- Sales by category
    INSERT INTO @r (Test, Expected, Actual)
    VALUES (N'By category: one row for the test day and category', '1',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM VW_SALES_BY_CATEGORY
             WHERE Sale_date = @day AND Category_id = @cat)),
           (N'By category: units / gross / refunded / net', '5/100.00/20.00/80.00',
            (SELECT CONCAT(Units, '/', Gross_revenue, '/', Refunded_revenue, '/', Net_revenue)
             FROM VW_SALES_BY_CATEGORY WHERE Sale_date = @day AND Category_id = @cat));

    -- Inventory
    INSERT INTO @r (Test, Expected, Actual)
    VALUES (N'Inventory: 3 products in the test category (the flagged one is left out)', '3',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM VW_INVENTORY_REPORT WHERE Category_name = N'VIEWS TEST')),
           (N'Inventory: P1 stock, status and stock value at cost', '9; OK; 45.00',
            (SELECT CONCAT(Stock_quantity, '; ', Stock_status, '; ', Stock_value_at_cost)
             FROM VW_INVENTORY_REPORT WHERE Product_id = @p1)),
           (N'Inventory: P2 is Low and has an open alert', 'Low; alert yes',
            (SELECT CONCAT(Stock_status, '; alert ', CASE WHEN Open_alert_id IS NOT NULL THEN 'yes' ELSE 'no' END)
             FROM VW_INVENTORY_REPORT WHERE Product_id = @p2)),
           (N'Inventory: P3 is out of stock', 'Out of stock',
            (SELECT Stock_status FROM VW_INVENTORY_REPORT WHERE Product_id = @p3)),
           (N'Inventory: the flagged product is not listed', '0',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM VW_INVENTORY_REPORT WHERE SKU = 'VW-TEST-004'));

    -- Rewards
    INSERT INTO @r (Test, Expected, Actual)
    VALUES (N'Rewards: customer A orders and spent (flagged sale is left out)', '1; 100.00',
            (SELECT CONCAT(Orders, '; ', Total_spent) FROM VW_REWARDS_REPORT WHERE Customer_id = @custA)),
           (N'Rewards: customer B earned / taken back / balance / orders',
            CONCAT(@pts, '/', @pts, '/0/1'),
            (SELECT CONCAT(Points_earned, '/', Points_taken_back, '/', Loyalty_points, '/', Orders)
             FROM VW_REWARDS_REPORT WHERE Customer_id = @custB)),
           (N'Rewards: the tier name is never empty', '1',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM VW_REWARDS_REPORT
             WHERE Customer_id = @custB AND LEN(Tier_name) > 0)),
           (N'Rewards: the flagged customer is not listed', '0',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM VW_REWARDS_REPORT WHERE Customer_id = @custC));
END TRY
BEGIN CATCH
    INSERT INTO @r (Test, Expected, Actual, Detail)
    VALUES (N'The test steps ran without an error', 'none', CONCAT('error ', ERROR_NUMBER()),
            LEFT(CONCAT('Line ', ERROR_LINE(), ': ', ERROR_MESSAGE()), 300));
END CATCH;

IF XACT_STATE() <> 0 ROLLBACK TRAN;   -- undo everything the test created

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