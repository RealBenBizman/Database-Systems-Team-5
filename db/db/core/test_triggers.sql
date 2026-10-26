-- Walks through the full trigger chain and prints a PASS/FAIL grid.
--
--   Sale completes -> Trigger 1 (stock down + loyalty row)
--                  -> Trigger 2 (points + tier)
--                  -> Trigger 3 (low-stock alert opens)
--   Supplier order received -> Trigger 4 (stock up)
--                           -> Trigger 3 (alert resolves)
--
-- Everything runs inside ONE transaction that is ROLLED BACK at the end,
-- so no test data stays in the database.
-- Run it as a single batch (there are no GO separators on purpose).

USE pos_store;
SET NOCOUNT ON;

-- Trigger 1 inserts one loyalty row per matching reward program, so the
-- test needs exactly one active program (the one it creates itself).
IF EXISTS (SELECT 1
           FROM   REWARD_PROGRAM
           WHERE  CAST(SYSDATETIME() AS DATE) >= Effective_from
             AND  (Effective_to IS NULL OR CAST(SYSDATETIME() AS DATE) <= Effective_to))
    THROW 50100, 'Test stopped: an active REWARD_PROGRAM already exists. This test needs to be the only active program.', 1;

DECLARE @r TABLE (
    Seq         INT IDENTITY(1,1),
    Step        NVARCHAR(10),
    Description NVARCHAR(90),
    Expected    NVARCHAR(40),
    Actual      NVARCHAR(40)
);

DECLARE @prog INT, @emp INT, @cust INT, @cat INT, @prod INT, @sup INT, @ord INT,
        @txA INT, @txB INT, @txC INT, @txD INT,
        @eta DATE = DATEADD(DAY, 5, CAST(SYSDATETIME() AS DATE)),
        @err INT = NULL,
        @fatal NVARCHAR(4000) = NULL;

BEGIN TRY
    BEGIN TRAN;

    -- SETUP: reward program (2 pts per $), 3 tiers, and basic test rows
    INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
    VALUES ('TEST Program', 2, 0.01, '2000-01-01', NULL);
    SET @prog = SCOPE_IDENTITY();

    INSERT INTO REWARD_TIER (Program_id, Tier_name, Min_points, Perk_description)
    VALUES (@prog, 'Bronze',  50, 'test'),
           (@prog, 'Silver', 150, 'test'),
           (@prog, 'Gold',   500, 'test');

    INSERT INTO EMPLOYEE (FirstName, LastName, Email, Phone_number, Role, Hire_date, Password_hash)
    VALUES ('Test', 'Manager', 'test.manager@example.com', '5555550100', 'Manager', CAST(SYSDATETIME() AS DATE), 'x');
    SET @emp = SCOPE_IDENTITY();

    INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash, Loyalty_points, Created_date)
    VALUES ('Test', 'Customer', 'test.customer@example.com', 'x', 0, SYSDATETIME());
    SET @cust = SCOPE_IDENTITY();

    INSERT INTO CATEGORY (Name, Description)
    VALUES ('TEST Category', 'test');
    SET @cat = SCOPE_IDENTITY();

    -- Stock 10, reorder threshold 3
    INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
    VALUES ('TEST-SKU-001', 'TEST Product', 'test', 5.00, 20.00, 10, 3, 'New', @cat);
    SET @prod = SCOPE_IDENTITY();

    -- If this INSERT fails with "cannot insert NULL into column X"
    -- (your supplier address columns), add column X here.
    INSERT INTO SUPPLIER (Supplier_name, Supplier_email, Supplier_phone, Street_address, Apt_number, City, State, Zip_code)
    VALUES ('TEST Supplier', 'test.supplier@example.com', '5555550101','1 Test city', NULL, 'Houston', 'TX', '77001');
    SET @sup = SCOPE_IDENTITY();

    -- Trigger 1 -> 2 -> 3 is a chain, so nested triggers must be ON
    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('0', 'Nested triggers enabled (server setting)', '1',
            (SELECT CAST(value_in_use AS NVARCHAR(40)) FROM sys.configurations WHERE name = 'nested triggers'));

    -- STEP 1: Sale A  (2 units x $20 = $40 -> 80 points -> Bronze)
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@cust, NULL, SYSDATETIME(), 40.00, 0.00, 40.00, 'open',
            'Test Customer', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txA = SCOPE_IDENTITY();

    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txA, @prod, 2, 20.00, NULL, 0.00);

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('1', 'Stock unchanged while sale is still open', '10',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod));

    UPDATE SALES_TRANSACTION
    SET    Status = 'completed', Tracking_number = 'TEST-TRK-A', Estimated_arrival = @eta
    WHERE  Transaction_id = @txA;

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('1', 'Stock after sale A (10 - 2)', '8',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod)),
           ('1', 'Loyalty row created for sale A (points)', '80',
            (SELECT ISNULL(CAST(SUM(Points_change) AS NVARCHAR(40)), 'none') FROM LOYALTY_TRANSACTION WHERE Transaction_id = @txA)),
           ('1', 'Customer loyalty points', '80',
            (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Customer_id = @cust)),
           ('1', 'Customer tier', 'Bronze',
            (SELECT ISNULL(t.Tier_name, 'NULL') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Customer_id = @cust)),
           ('1', 'Open low-stock alerts (stock 8 > threshold 3)', '0',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Product_id = @prod AND Resolved_at IS NULL));

    -- STEP 2: Sale B  (5 units x $20 = $100 -> +200 = 280 points -> Silver)
    --         stock 8 - 5 = 3, which equals the threshold -> alert opens
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@cust, NULL, SYSDATETIME(), 100.00, 0.00, 100.00, 'open',
            'Test Customer', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txB = SCOPE_IDENTITY();

    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txB, @prod, 5, 20.00, NULL, 0.00);

    UPDATE SALES_TRANSACTION
    SET    Status = 'completed', Tracking_number = 'TEST-TRK-B', Estimated_arrival = @eta
    WHERE  Transaction_id = @txB;

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('2', 'Stock after sale B (8 - 5)', '3',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod)),
           ('2', 'Customer loyalty points (80 + 200)', '280',
            (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Customer_id = @cust)),
           ('2', 'Customer tier', 'Silver',
            (SELECT ISNULL(t.Tier_name, 'NULL') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Customer_id = @cust)),
           ('2', 'Open low-stock alerts (stock 3 <= threshold 3)', '1',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Product_id = @prod AND Resolved_at IS NULL));

    ------------------------------------------------------------------
    -- STEP 3: Sale C  (1 unit at a $250 snapshot price -> +500 = 780 -> Gold)
    --         stock 3 - 1 = 2, still low -> must NOT create a second alert
    ------------------------------------------------------------------
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@cust, NULL, SYSDATETIME(), 250.00, 0.00, 250.00, 'open',
            'Test Customer', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txC = SCOPE_IDENTITY();

    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txC, @prod, 1, 250.00, NULL, 0.00);

    UPDATE SALES_TRANSACTION
    SET    Status = 'completed', Tracking_number = 'TEST-TRK-C', Estimated_arrival = @eta
    WHERE  Transaction_id = @txC;

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('3', 'Stock after sale C (3 - 1)', '2',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod)),
           ('3', 'Customer loyalty points (280 + 500)', '780',
            (SELECT CAST(Loyalty_points AS NVARCHAR(40)) FROM CUSTOMER WHERE Customer_id = @cust)),
           ('3', 'Customer tier', 'Gold',
            (SELECT ISNULL(t.Tier_name, 'NULL') FROM CUSTOMER c LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id WHERE c.Customer_id = @cust)),
           ('3', 'Still exactly 1 open alert (no duplicates)', '1',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Product_id = @prod AND Resolved_at IS NULL));

    ------------------------------------------------------------------
    -- STEP 4: Staff orders 10 units, then marks the order Received
    ------------------------------------------------------------------
    INSERT INTO SUPPLIER_ORDER (Supplier_id, Employee_id, Order_date, Received_date, Status)
    VALUES (@sup, @emp, CAST(SYSDATETIME() AS DATE), NULL, 'Pending');
    SET @ord = SCOPE_IDENTITY();

    INSERT INTO SUPPLIER_ORDER_ITEM (Order_id, Product_id, Quantity, Unit_cost)
    VALUES (@ord, @prod, 10, 5.00);

    UPDATE SUPPLIER_ORDER SET Status = 'Ordered' WHERE Order_id = @ord;

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('4', 'Stock unchanged when order is only Ordered', '2',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod)),
           ('4', 'Alert still open while waiting for the shipment', '1',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Product_id = @prod AND Resolved_at IS NULL));

    UPDATE SUPPLIER_ORDER SET Status = 'Received' WHERE Order_id = @ord;

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('4', 'Stock after order received (2 + 10)', '12',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod)),
           ('4', 'Received_date was filled in', 'filled',
            (SELECT CASE WHEN Received_date IS NOT NULL THEN 'filled' ELSE 'NULL' END FROM SUPPLIER_ORDER WHERE Order_id = @ord)),
           ('4', 'Low-stock alert resolved (stock 12 > threshold 3)', '0',
            (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM LOW_STOCK_ALERT WHERE Product_id = @prod AND Resolved_at IS NULL));

    -- Re-saving an already received order must NOT add the stock twice
    UPDATE SUPPLIER_ORDER SET Status = 'Received' WHERE Order_id = @ord;

    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('4', 'Stock after re-saving Received (no double count)', '12',
            (SELECT CAST(Stock_quantity AS NVARCHAR(40)) FROM PRODUCT WHERE Product_id = @prod));

    ------------------------------------------------------------------
    -- STEP 5: Overselling (99 units, only 12 in stock) must be rejected.
    -- Keep this LAST: the error leaves the transaction unusable, so the
    -- script rolls everything back right after it.
    ------------------------------------------------------------------
    INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                   Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
    VALUES (@cust, NULL, SYSDATETIME(), 1980.00, 0.00, 1980.00, 'open',
            'Test Customer', '1 Test St', NULL, 'Houston', 'TX', '77001');
    SET @txD = SCOPE_IDENTITY();

    INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
    VALUES (@txD, @prod, 99, 20.00, NULL, 0.00);

    BEGIN TRY
        UPDATE SALES_TRANSACTION
        SET    Status = 'completed', Tracking_number = 'TEST-TRK-D', Estimated_arrival = @eta
        WHERE  Transaction_id = @txD;
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();   -- 547 = CHECK constraint violation
    END CATCH;
END TRY
BEGIN CATCH
    SET @fatal = ERROR_MESSAGE() + ' (line ' + CAST(ERROR_LINE() AS NVARCHAR(10)) + ')';
END CATCH;

-- Undo every test row
IF @@TRANCOUNT > 0 ROLLBACK TRAN;

IF @fatal IS NULL
    INSERT INTO @r (Step, Description, Expected, Actual)
    VALUES ('5', 'Oversell rejected by CHECK (error number)', '547',
            ISNULL(CAST(@err AS NVARCHAR(40)), 'no error'));

INSERT INTO @r (Step, Description, Expected, Actual)
VALUES ('6', 'Test data rolled back (leftover test products)', '0',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM PRODUCT WHERE SKU = 'TEST-SKU-001'));

-- Results
IF @fatal IS NOT NULL
    SELECT 'The test stopped early with this error' AS Problem, @fatal AS Message;

SELECT Step, Description, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result
FROM   @r
ORDER BY Seq;