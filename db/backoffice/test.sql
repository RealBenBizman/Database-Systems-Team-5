   USE pos_store;
   GO

   -- TEST 1: a positive adjustment adds to stock
DECLARE @productId  INT = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 ORDER BY Product_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @before INT, @after INT;

BEGIN TRANSACTION;
    SELECT @before = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason, Adjusted_at)
    VALUES (@productId, @employeeId, 10, N'test: add 10', SYSDATETIME());

    SELECT @after = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    IF @after = @before + 10
        PRINT 'PASS: +10 was added to stock';
    ELSE
        PRINT 'FAIL: expected ' + CAST(@before + 10 AS VARCHAR(20)) + ' but got ' + CAST(@after AS VARCHAR(20));
ROLLBACK TRANSACTION;
GO

-- TEST 2: a negative change that stays at or above 0 is allowed
DECLARE @productId  INT = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 AND Stock_quantity >= 5 ORDER BY Product_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @before INT, @after INT;

BEGIN TRANSACTION;
    SELECT @before = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason, Adjusted_at)
    VALUES (@productId, @employeeId, -3, N'test: remove 3', SYSDATETIME());

    SELECT @after = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    IF @after = @before - 3
        PRINT 'PASS: -3 was removed from stock';
    ELSE
        PRINT 'FAIL: expected ' + CAST(@before - 3 AS VARCHAR(20)) + ' but got ' + CAST(@after AS VARCHAR(20));
ROLLBACK TRANSACTION;
GO

-- TEST 3: going below 0 is rejected
DECLARE @productId  INT = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 ORDER BY Product_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @before     INT = (SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @productId);
DECLARE @tooMuch    INT = -(@before + 1);

BEGIN TRANSACTION;
BEGIN TRY
    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason, Adjusted_at)
    VALUES (@productId, @employeeId, @tooMuch, N'test: too much', SYSDATETIME());
    PRINT 'FAIL: negative stock was accepted';
END TRY
BEGIN CATCH
    PRINT 'PASS: rejected - ' + ERROR_MESSAGE();
END CATCH;
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO

-- TEST 4: Quantity_change = 0 is rejected by the CHECK constraint
DECLARE @productId  INT = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 ORDER BY Product_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');

BEGIN TRANSACTION;
BEGIN TRY
    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason, Adjusted_at)
    VALUES (@productId, @employeeId, 0, N'test: zero', SYSDATETIME());
    PRINT 'FAIL: a change of 0 was accepted';
END TRY
BEGIN CATCH
    PRINT 'PASS: rejected - ' + ERROR_MESSAGE();
END CATCH;
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO

-- TEST 5: two rows in one INSERT are added together before the check
DECLARE @productId  INT = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 AND Stock_quantity >= 1 ORDER BY Product_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @each       INT = -(SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @productId);

BEGIN TRANSACTION;
BEGIN TRY
    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason, Adjusted_at)
    VALUES (@productId, @employeeId, @each, N'test: row 1', SYSDATETIME()),
           (@productId, @employeeId, @each, N'test: row 2', SYSDATETIME());
    PRINT 'FAIL: two rows that go below 0 together were accepted';
END TRY
BEGIN CATCH
    PRINT 'PASS: rejected - ' + ERROR_MESSAGE();
END CATCH;
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO

-- TEST 6: two rows in one INSERT are both applied
DECLARE @productId  INT = (SELECT TOP 1 Product_id FROM PRODUCT WHERE Is_active = 1 ORDER BY Product_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @before INT, @after INT;

BEGIN TRANSACTION;
    SELECT @before = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason, Adjusted_at)
    VALUES (@productId, @employeeId, 2, N'test: row 1', SYSDATETIME()),
           (@productId, @employeeId, 3, N'test: row 2', SYSDATETIME());

    SELECT @after = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    IF @after = @before + 5
        PRINT 'PASS: +2 and +3 were both applied';
    ELSE
        PRINT 'FAIL: expected ' + CAST(@before + 5 AS VARCHAR(20)) + ' but got ' + CAST(@after AS VARCHAR(20));
ROLLBACK TRANSACTION;
GO