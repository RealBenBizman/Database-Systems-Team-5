USE pos_store;
GO

-- FULL CHAIN: alert -> order -> Ordered -> Received -> stock up -> alert closed
DECLARE @alertId    INT = (SELECT TOP 1 Alert_id FROM LOW_STOCK_ALERT
                           WHERE Resolved_at IS NULL AND Order_id IS NULL AND Marked_for_deletion = 0
                           ORDER BY Alert_id);
DECLARE @supplierId INT = (SELECT TOP 1 Supplier_id FROM SUPPLIER WHERE Marked_for_deletion = 0 ORDER BY Supplier_id);
DECLARE @employeeId INT = (SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager');
DECLARE @quantity   INT = 10;
DECLARE @productId  INT, @orderId INT, @before INT, @after INT;

BEGIN TRANSACTION;

    SELECT @productId = Product_id FROM LOW_STOCK_ALERT WHERE Alert_id = @alertId;
    SELECT @before = Stock_quantity FROM PRODUCT WHERE Product_id = @productId;

    INSERT INTO SUPPLIER_ORDER (Supplier_id, Employee_id, Order_date, Status)
    VALUES (@supplierId, @employeeId, CAST(SYSDATETIME() AS DATE), 'Pending');
    SET @orderId = SCOPE_IDENTITY();

    INSERT INTO SUPPLIER_ORDER_ITEM (Order_id, Product_id, Quantity, Unit_cost)
    VALUES (@orderId, @productId, @quantity, (SELECT Cost_price FROM PRODUCT WHERE Product_id = @productId));

    UPDATE LOW_STOCK_ALERT SET Order_id = @orderId WHERE Alert_id = @alertId;

    UPDATE SUPPLIER_ORDER SET Status = 'Ordered'  WHERE Order_id = @orderId;
    UPDATE SUPPLIER_ORDER SET Status = 'Received' WHERE Order_id = @orderId;

    SELECT @before AS Stock_before, Stock_quantity AS Stock_after, Reorder_threshold
    FROM   PRODUCT WHERE Product_id = @productId;

    SELECT Alert_id, Order_id, Resolved_at FROM LOW_STOCK_ALERT WHERE Alert_id = @alertId;

    SELECT Order_id, Status, Received_date FROM SUPPLIER_ORDER WHERE Order_id = @orderId;

ROLLBACK TRANSACTION;   -- test mode: undo everything
GO