USE pos_store;
GO
-- Trigger 1: TR_SALES_TRANSACTION_Complete
-- When a sale goes open -> completed:
--  a) subtract sold quantities from PRODUCT.Stock_quantity
--  b) insert a LOYALTY_TRANSACTION (points earned = FLOOR(SubTotal * Points_per_dollar))

CREATE OR ALTER TRIGGER TR_SALES_TRANSACTION_Complete
ON SALES_TRANSACTION
AFTER UPDATE
AS 
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Only the rows that just moved from 'open' to 'completed'
    DECLARE @done TABLE (
        Transaction_id   INT PRIMARY KEY,
        Customer_id      INT,
        Subtotal         DECIMAL(10,2),
        Transaction_date DATETIME2
    );

    INSERT INTO @done (Transaction_id, Customer_id, Subtotal, Transaction_date)
    SELECT i.Transaction_id, i.Customer_id, i.Subtotal, i.Transaction_date
    FROM inserted i
    JOIN deleted d ON d.Transaction_id = i.Transaction_id
    WHERE i.Status = 'completed'
        AND d.Status = 'open';

    IF NOT EXISTS (SELECT 1 FROM @done) RETURN;

    -- a) subtract sold quantities from PRODUCT.Stock_quantity
    UPDATE p
    SET    p.Stock_quantity = p.Stock_quantity - s.Qty
    FROM   PRODUCT p
    JOIN   (SELECT ti.Product_id, SUM(ti.Quantity) AS Qty
            FROM TRANSACTION_ITEM ti
            JOIN @done d ON d.Transaction_id = ti.Transaction_id
            GROUP BY ti.Product_id) s
            ON s.Product_id = p.Product_id;

    -- b) insert a LOYALTY_TRANSACTION (points earned = FLOOR(SubTotal * Points_per_dollar))
    INSERT INTO LOYALTY_TRANSACTION
    (Customer_id, Transaction_id, Program_id, Points_change, Reason, Created_at)
    SELECT d.Customer_id,
           d.Transaction_id,
           rp.Program_id,
           FLOOR(d.Subtotal * rp.Points_per_dollar),
           'Purchase',
           SYSDATETIME()
    FROM   @done d
    JOIN   REWARD_PROGRAM rp
           ON CAST(d.Transaction_date AS DATE) >= rp.Effective_from
           AND (rp.Effective_to IS NULL
                OR CAST(d.Transaction_date AS DATE) <= rp.Effective_to)
    WHERE  FLOOR(d.Subtotal * rp.Points_per_dollar) > 0;
END;
GO


-- TRIGGER 2: TR_LOYALTY_TRANSACTION_Balance
-- When a Loyalty row is inserted
--  a) add Point_change to CUSTOMER.Loyalty_points (reject a negative balance)
--  b) set CUSTOMER.Tier_id to the highest tier whose Min_points <= balance

CREATE OR ALTER TRIGGER TR_LOYALTY_TRANSACTION_Balance
ON LOYALTY_TRANSACTION
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- a) Apply the points (one update per customer, even for multi-row inserts)
    UPDATE c
    SET    c.Loyalty_points = ISNULL(c.Loyalty_points, 0) + s.Pts
    FROM   CUSTOMER c
    JOIN   (SELECT Customer_id, SUM(Points_change) AS Pts
            FROM inserted
            GROUP BY Customer_id) s
            ON s.Customer_id = c.Customer_id;

    -- Reject negative balances
    IF EXISTS (SELECT 1
               FROM CUSTOMER c
               WHERE c.Customer_id IN (SELECT Customer_id FROM inserted)
                 AND c.Loyalty_points < 0)
            THROW 50001, 'Loyalty points balance cannot be negative.', 1;
    
    -- b) Recalculate the tier form the new balance
    --  (NULL if the customer does not reach any tier yet)
    UPDATE c
    SET    c.Tier_id = t.Tier_id
    FROM   CUSTOMER c
    OUTER APPLY (SELECT TOP (1) rt.Tier_id
                 FROM REWARD_TIER rt
                 WHERE rt.Program_id IN (SELECT i.Program_id
                                         FROM inserted i
                                         WHERE i.Customer_id = c.Customer_id)
                   AND rt.Min_points <= c.Loyalty_points
                 ORDER BY rt.Min_points DESC) t
    WHERE c.Customer_id IN (SELECT Customer_id FROM inserted);
END;
GO


-- TRIGGER 3: TR_PRODUCT_LowStock
-- When PRODUCT stock or reorder threshold changes:
--  a) open a LOW_STOCK_ALERT if Stock_quantity <= Reorder_threshold
--     and the product has no unresolved alert yet
--  b) resolve any open alert once Stock_quantity > Reorder_threshold

CREATE OR ALTER TRIGGER TR_PRODUCT_LowStock
ON PRODUCT
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Ignore updates that touch neither column (price edits, renames, etc.)
    IF NOT (UPDATE(Stock_quantity) OR UPDATE(Reorder_threshold)) RETURN;

    -- a) Open an alert for products at or below the threshold with no open alert
    INSERT INTO LOW_STOCK_ALERT (Product_id, Triggered_at)
    SELECT i.Product_id, SYSDATETIME()
    FROM   inserted i
    WHERE  i.Stock_quantity <= i.Reorder_threshold
      AND  NOT EXISTS (SELECT 1
                       FROM LOW_STOCK_ALERT a
                       WHERE a.Product_id = i.Product_id
                         AND a.Resolved_at IS NULL);

    -- b) Close open alerts for products that are back above the threshold
    UPDATE a
    SET    a.Resolved_at = SYSDATETIME()
    FROM   LOW_STOCK_ALERT a
    JOIN   inserted i ON i.Product_id = a.Product_id
    WHERE  a.Resolved_at IS NULL
      AND  i.Stock_quantity > i.Reorder_threshold;
END;
GO


-- TRIGGER 4: TR_SUPPLIER_ORDER_Received
-- When a supplier order moves to 'Received' (from any other status):
--  a) add each time's Quantity to PRODUCT.Stock_quantity
--  b) set Received_date if it was not filled in

CREATE OR ALTER TRIGGER TR_SUPPLIER_ORDER_Received
ON SUPPLIER_ORDER
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT UPDATE(Status) RETURN;

    -- Only orders that just became 'Received' (a re-save of an already
    -- received order must not add the stock a second time)
    DECLARE @received TABLE (Order_id INT PRIMARY KEY);

    INSERT INTO @received (Order_id)
    SELECT i.Order_id
    FROM   inserted i
    JOIN   deleted d ON d.Order_id = i.Order_id
    WHERE  i.Status = 'Received'
      AND  d.Status <> 'Received';

    IF NOT EXISTS (SELECT 1 FROM @received) RETURN;

    -- a) Increase stock by the ordered quantities
    UPDATE p
    SET    p.Stock_quantity = p.Stock_quantity + s.Qty
    FROM   PRODUCT p
    JOIN  (SELECT oi.Product_id, SUM(oi.Quantity) AS Qty
           FROM   SUPPLIER_ORDER_ITEM oi
           JOIN   @received r ON r.Order_id = oi.Order_id
           GROUP BY oi.Product_id) s
           ON s.Product_id = p.Product_id;

    -- b) Stamp the received date
    UPDATE so
    SET    so.Received_date = SYSDATETIME()
    FROM   SUPPLIER_ORDER so
    JOIN   @received r ON r.Order_id = so.Order_id
    WHERE  so.Received_date IS NULL;
END;
GO

-- TRIGGER 5: TR_REWARD_PROGRAM_NoOverlap
-- When a REWARD_PROGRAM row is inserted or updated:
--  a) reject the change if it would create an overlap with another program's dates
--  (Effective_from and Effective_to are inclusive, and Effective_to can be NULL for an open-ended program)
CREATE OR ALTER TRIGGER TR_REWARD_PROGRAM_NoOverlap
ON REWARD_PROGRAM
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT (UPDATE(Effective_from) OR UPDATE(Effective_to)) RETURN;

    IF EXISTS (
        SELECT 1
        FROM   inserted i
        JOIN   REWARD_PROGRAM rp ON rp.Program_id <> i.Program_id
        WHERE  rp.Effective_from <= ISNULL(i.Effective_to,  '9999-12-31')
          AND  i.Effective_from  <= ISNULL(rp.Effective_to, '9999-12-31'))
        THROW 50002, 'Reward programs cannot have overlapping dates.', 1;
END;
GO