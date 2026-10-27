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

CREATE OR ALTER TRIGGER TR_PAYMENT_Guard
ON PAYMENT
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM inserted i
               JOIN SALES_TRANSACTION s ON s.Transaction_id = i.Transaction_id
               WHERE s.Status <> 'open')
    OR EXISTS (SELECT 1 FROM deleted d
               JOIN SALES_TRANSACTION s ON s.Transaction_id = d.Transaction_id
               WHERE s.Status <> 'open')
        THROW 50020, 'Payments can only change while the sale is open.', 1;

    IF EXISTS (SELECT 1 FROM inserted WHERE Amount <= 0)
        THROW 50021, 'Payment amount must be more than 0.', 1;

    IF EXISTS (SELECT 1 FROM SALES_TRANSACTION s
               WHERE s.Transaction_id IN (SELECT Transaction_id FROM inserted)
                 AND (SELECT SUM(p.Amount) FROM PAYMENT p
                      WHERE p.Transaction_id = s.Transaction_id
                        AND p.Marked_for_deletion = 0) > s.Total)
        THROW 50022, 'Payments cannot add up to more than the sale total.', 1;
END;
GO

CREATE OR ALTER TRIGGER TR_SALES_TRANSACTION_PaymentCheck
ON SALES_TRANSACTION
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT UPDATE(Status) RETURN;

    IF EXISTS (SELECT 1 FROM inserted i
               JOIN deleted d ON d.Transaction_id = i.Transaction_id
               WHERE d.Status = 'open' AND i.Status = 'completed'
                 AND NOT EXISTS (SELECT 1 FROM TRANSACTION_ITEM ti
                                 WHERE ti.Transaction_id = i.Transaction_id
                                   AND ti.Marked_for_deletion = 0))
        THROW 50030, 'A sale needs at least one item to be completed.', 1;

    IF EXISTS (SELECT 1 FROM inserted i
               JOIN deleted d ON d.Transaction_id = i.Transaction_id
               WHERE d.Status = 'open' AND i.Status = 'completed'
                 AND ISNULL((SELECT SUM(p.Amount) FROM PAYMENT p
                             WHERE p.Transaction_id = i.Transaction_id
                               AND p.Marked_for_deletion = 0), 0) <> i.Total)
        THROW 50031, 'Payments must equal the sale total to complete it.', 1;
END;
GO