USE pos_store;
GO

-- CHANGE SUPPLIER ORDER STATUS
-- Allowed moves: Pending -> Ordered, Ordered -> Received,
--                Pending -> Cancelled, Ordered -> Cancelled

-- Change these two to test different moves
DECLARE @startStatus VARCHAR(20) = 'Ordered';   -- status the test order begins with
DECLARE @newStatus   VARCHAR(20) = 'Received';   -- status we want to move it to
DECLARE @testMode    BIT = 1;                   -- 1 = undo at the end, 0 = keep the change

DECLARE @supplierId INT = (SELECT TOP 1 Supplier_id FROM SUPPLIER WHERE Marked_for_deletion = 0 ORDER BY Supplier_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');

BEGIN TRY
    BEGIN TRANSACTION;

    -- TEST SETUP ONLY: make an order to practice on (the real page picks an existing order)
    INSERT INTO SUPPLIER_ORDER (Supplier_id, Employee_id, Order_date, Status)
    VALUES (@supplierId, @employeeId, CAST(SYSDATETIME() AS DATE), @startStatus);
    DECLARE @orderId INT = SCOPE_IDENTITY();

    -- THE REAL PART starts here
    DECLARE @currentStatus VARCHAR(20) =
        (SELECT Status FROM SUPPLIER_ORDER WHERE Order_id = @orderId);

    IF @currentStatus IS NULL
        THROW 50047, 'Order not found.', 1;

    IF NOT ( (@currentStatus = 'Pending' AND @newStatus IN ('Ordered', 'Cancelled'))
          OR (@currentStatus = 'Ordered' AND @newStatus IN ('Received', 'Cancelled')) )
        THROW 50048, 'That status change is not allowed.', 1;

    -- only change it if it is still in the status we just read
    UPDATE SUPPLIER_ORDER
    SET    Status = @newStatus
    WHERE  Order_id = @orderId AND Status = @currentStatus;

    IF @@ROWCOUNT = 0
        THROW 50049, 'Order was changed by someone else. Try again.', 1;

    SELECT Order_id, Status, Received_date
    FROM   SUPPLIER_ORDER
    WHERE  Order_id = @orderId;

    IF @testMode = 1
        ROLLBACK TRANSACTION;
    ELSE
        COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH
GO