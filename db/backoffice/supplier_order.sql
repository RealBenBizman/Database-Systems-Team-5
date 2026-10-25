USE pos_store;
GO

-- CREATE SUPPLIER ORDER from a low-stock alert
DECLARE @alertId    INT = (SELECT TOP 1 Alert_id FROM LOW_STOCK_ALERT
                           WHERE Resolved_at IS NULL AND Order_id IS NULL AND Marked_for_deletion = 0
                           ORDER BY Alert_id);
DECLARE @supplierId INT = (SELECT TOP 1 Supplier_id FROM SUPPLIER WHERE Marked_for_deletion = 0 ORDER BY Supplier_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @quantity   INT = 10;
DECLARE @testMode   BIT = 1;   -- 1 = undo at the end, 0 = keep the change

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @productId INT, @unitCost DECIMAL(10,2), @orderId INT;

    SELECT @productId = a.Product_id, @unitCost = p.Cost_price
    FROM   LOW_STOCK_ALERT a
    JOIN   PRODUCT p ON p.Product_id = a.Product_id
    WHERE  a.Alert_id = @alertId AND a.Resolved_at IS NULL AND a.Order_id IS NULL;

    IF @productId IS NULL  THROW 50044, 'Alert not found, already resolved, or already has an order.', 1;
    IF @supplierId IS NULL THROW 50045, 'Supplier not found.', 1;
    IF @quantity <= 0      THROW 50046, 'Quantity must be more than 0.', 1;

    INSERT INTO SUPPLIER_ORDER (Supplier_id, Employee_id, Order_date, Status)
    VALUES (@supplierId, @employeeId, CAST(SYSDATETIME() AS DATE), 'Pending');
    SET @orderId = SCOPE_IDENTITY();

    INSERT INTO SUPPLIER_ORDER_ITEM (Order_id, Product_id, Quantity, Unit_cost)
    VALUES (@orderId, @productId, @quantity, @unitCost);

    UPDATE LOW_STOCK_ALERT
    SET    Order_id = @orderId
    WHERE  Alert_id = @alertId;

    SELECT o.Order_id, o.Status, i.Product_id, i.Quantity, i.Unit_cost, a.Alert_id, a.Order_id AS Alert_order_id
    FROM   SUPPLIER_ORDER o
    JOIN   SUPPLIER_ORDER_ITEM i ON i.Order_id = o.Order_id
    JOIN   LOW_STOCK_ALERT a ON a.Order_id = o.Order_id
    WHERE  o.Order_id = @orderId;

    IF @testMode = 1 ROLLBACK TRANSACTION; ELSE COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;