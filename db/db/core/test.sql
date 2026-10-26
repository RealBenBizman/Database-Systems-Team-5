USE pos_store;
SET NOCOUNT ON;

DECLARE @r TABLE (Seq INT IDENTITY(1,1), Test NVARCHAR(100), Expected NVARCHAR(40),
                  Actual NVARCHAR(40), Detail NVARCHAR(300));

DECLARE @case INT, @err INT, @msg NVARCHAR(300), @final NVARCHAR(20),
        @cust INT, @cat INT, @prod INT, @tx INT,
        @eta DATE = DATEADD(DAY, 5, CAST(SYSDATETIME() AS DATE));

INSERT INTO @r (Test, Expected, Actual)
VALUES (N'Nested triggers enabled (server setting)', '1',
        (SELECT CAST(value_in_use AS NVARCHAR(40)) FROM sys.configurations WHERE name = 'nested triggers')),
       (N'TR_SALES_TRANSACTION_StatusFlow exists and is enabled', '1',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.triggers
         WHERE name = 'TR_SALES_TRANSACTION_StatusFlow' AND is_disabled = 0)),
       (N'TR_REWARD_PROGRAM_NoOverlap exists and is enabled', '1',
        (SELECT CAST(COUNT(*) AS NVARCHAR(40)) FROM sys.triggers
         WHERE name = 'TR_REWARD_PROGRAM_NoOverlap' AND is_disabled = 0));

SET @case = 1;
WHILE @case <= 5
BEGIN
    SET @err = NULL; SET @msg = NULL; SET @final = NULL;

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
        VALUES (N'Flow', N'Test', 'statusflow.test@example.com', 'x');
        SET @cust = SCOPE_IDENTITY();

        INSERT INTO CATEGORY (Name, Description)
        VALUES (N'STATUSFLOW TEST', N'test');
        SET @cat = SCOPE_IDENTITY();

        INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity, Reorder_threshold, Product_condition, Category_id)
        VALUES ('SF-TEST-001', N'StatusFlow test product', N'test', 5.00, 20.00, 10, 3, 'New', @cat);
        SET @prod = SCOPE_IDENTITY();

        INSERT INTO SALES_TRANSACTION (Customer_id, Employee_id, Transaction_date, Subtotal, Tax_amount, Total, Status,
                                       Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip)
        VALUES (@cust, NULL, SYSDATETIME(), 20.00, 0.00, 20.00, 'open',
                'Flow Test', '1 Test St', NULL, 'Houston', 'TX', '77001');
        SET @tx = SCOPE_IDENTITY();

        INSERT INTO TRANSACTION_ITEM (Transaction_id, Product_id, Quantity, Unit_price, Discount_id, Discount_amount)
        VALUES (@tx, @prod, 1, 20.00, NULL, 0.00);

        INSERT INTO PAYMENT (Transaction_id, Method, Amount, Card_last4)
        VALUES (@tx, 'credit', 20.00, '4242');

        IF @case IN (1, 2, 4)
            UPDATE SALES_TRANSACTION
            SET    Status = 'completed', Tracking_number = 'SF-TRK-1', Estimated_arrival = @eta
            WHERE  Transaction_id = @tx;

        IF @case IN (3, 5)
            UPDATE SALES_TRANSACTION SET Status = 'voided' WHERE Transaction_id = @tx;

        IF @case IN (4, 5)
            SET @final = (SELECT Status FROM SALES_TRANSACTION WHERE Transaction_id = @tx);

        IF @case = 1
            UPDATE SALES_TRANSACTION SET Status = 'open' WHERE Transaction_id = @tx;
        IF @case = 2
            UPDATE SALES_TRANSACTION SET Status = 'voided' WHERE Transaction_id = @tx;
        IF @case = 3
            UPDATE SALES_TRANSACTION
            SET    Status = 'completed', Tracking_number = 'SF-TRK-3', Estimated_arrival = @eta
            WHERE  Transaction_id = @tx;
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        SET @msg = LEFT(ERROR_MESSAGE(), 300);
    END CATCH;

    IF XACT_STATE() <> 0 ROLLBACK TRAN;

    IF @case IN (1, 2, 3)
        INSERT INTO @r (Test, Expected, Actual, Detail)
        VALUES (CASE @case WHEN 1 THEN N'StatusFlow: completed -> open is rejected'
                           WHEN 2 THEN N'StatusFlow: completed -> voided is rejected'
                           ELSE        N'StatusFlow: voided -> completed is rejected' END,
                '50003', ISNULL(CAST(@err AS NVARCHAR(40)), 'no error'), @msg);
    ELSE
        INSERT INTO @r (Test, Expected, Actual, Detail)
        VALUES (CASE @case WHEN 4 THEN N'StatusFlow: open -> completed still works'
                           ELSE        N'StatusFlow: open -> voided still works' END,
                CASE @case WHEN 4 THEN 'completed' ELSE 'voided' END,
                CASE WHEN @err IS NOT NULL THEN CONCAT('error ', @err) ELSE ISNULL(@final, 'none') END,
                @msg);

    SET @case += 1;
END;

SET @case = 1;
WHILE @case <= 4
BEGIN
    SET @err = NULL; SET @msg = NULL;

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
        VALUES (N'OVERLAP TEST A', 1, 0.01, '1990-01-01', '1990-12-31');

        IF @case = 1
            INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
            VALUES (N'OVERLAP TEST B', 1, 0.01, '1990-06-01', '1991-06-01');

        IF @case = 2
            INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
            VALUES (N'OVERLAP TEST B', 1, 0.01, '1990-12-31', '1991-12-31');

        IF @case = 3
            INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
            VALUES (N'OVERLAP TEST B', 1, 0.01, '1991-01-01', '1991-12-31');

        IF @case = 4
        BEGIN
            INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
            VALUES (N'OVERLAP TEST C', 1, 0.01, '1992-01-01', '1992-12-31');

            UPDATE REWARD_PROGRAM
            SET    Effective_from = '1990-06-01'
            WHERE  Program_name = N'OVERLAP TEST C';
        END;
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        SET @msg = LEFT(ERROR_MESSAGE(), 300);
    END CATCH;

    IF XACT_STATE() <> 0 ROLLBACK TRAN;

    INSERT INTO @r (Test, Expected, Actual, Detail)
    VALUES (CASE @case WHEN 1 THEN N'NoOverlap: insert starting inside another program is rejected'
                       WHEN 2 THEN N'NoOverlap: insert starting on the other program''s last day is rejected'
                       WHEN 3 THEN N'NoOverlap: insert starting the day after another program ends is allowed'
                       ELSE        N'NoOverlap: update that moves a program into another is rejected' END,
            CASE WHEN @case = 3 THEN 'no error' ELSE '50002' END,
            ISNULL(CAST(@err AS NVARCHAR(40)), 'no error'),
            @msg);

    SET @case += 1;
END;

INSERT INTO @r (Test, Expected, Actual)
VALUES (N'Test data rolled back (leftover test rows)', '0',
        (SELECT CAST((SELECT COUNT(*) FROM CUSTOMER       WHERE Email = 'statusflow.test@example.com')
                   + (SELECT COUNT(*) FROM PRODUCT        WHERE SKU = 'SF-TEST-001')
                   + (SELECT COUNT(*) FROM CATEGORY       WHERE Name = N'STATUSFLOW TEST')
                   + (SELECT COUNT(*) FROM REWARD_PROGRAM WHERE Program_name LIKE N'OVERLAP TEST%') AS NVARCHAR(40))));

SELECT Test, Expected, Actual,
       CASE WHEN Expected = Actual THEN 'PASS' ELSE 'FAIL' END AS Result,
       Detail
FROM   @r
ORDER BY Seq;

SELECT SUM(CASE WHEN Expected = Actual THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN Expected <> Actual THEN 1 ELSE 0 END) AS failed
FROM   @r;