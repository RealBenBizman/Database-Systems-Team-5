USE pos_store;
GO

CREATE OR ALTER TRIGGER TR_TRANSACTION_ITEM_Guard
ON TRANSACTION_ITEM
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM inserted i
              JOIN SALES_TRANSACTION s ON s.Transaction_id = i.Transaction_id
              WHERE s.Status <> 'open')
    OR EXISTS(SELECT 1 FROM deleted d
              JOIN SALES_TRANSACTION s ON s.Transaction_id = d.Transaction_id
              WHERE s.Status <> 'open') 
        THROW 50010, 'Items can only change while the sale is open.', 1;

    -- Check 2: quantity can't be more than stock
    IF EXISTS (SELECT 1 FROM inserted i
               JOIN PRODUCT p ON p.Product_id = i.Product_id
               WHERE i.Quantity > p.Stock_quantity)
        THROW 50011, 'Quantity is more than the stock on hand.', 1;


END;
GO