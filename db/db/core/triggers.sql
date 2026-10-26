USE pos_store;
GO

CREATE OR ALTER TRIGGER TR_SALES_TRANSACTION_Complete
ON SALES_TRANSACTION
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

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

    UPDATE p
    SET    p.Stock_quantity = p.Stock_quantity - s.Qty
    FROM   PRODUCT p
    JOIN   (SELECT ti.Product_id, SUM(ti.Quantity) AS Qty
            FROM TRANSACTION_ITEM ti
            JOIN @done d ON d.Transaction_id = ti.Transaction_id
            GROUP BY ti.Product_id) s
            ON s.Product_id = p.Product_id;

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

CREATE OR ALTER TRIGGER TR_LOYALTY_TRANSACTION_Balance
ON LOYALTY_TRANSACTION
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    UPDATE c
    SET    c.Loyalty_points = ISNULL(c.Loyalty_points, 0) + s.Pts
    FROM   CUSTOMER c
    JOIN   (SELECT Customer_id, SUM(Points_change) AS Pts
            FROM inserted
            GROUP BY Customer_id) s
            ON s.Customer_id = c.Customer_id;

    IF EXISTS (SELECT 1
               FROM CUSTOMER c
               WHERE c.Customer_id IN (SELECT Customer_id FROM inserted)
                 AND c.Loyalty_points < 0)
            THROW 50001, 'Loyalty points balance cannot be negative.', 1;

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

CREATE OR ALTER TRIGGER TR_PRODUCT_LowStock
ON PRODUCT
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT (UPDATE(Stock_quantity) OR UPDATE(Reorder_threshold)) RETURN;

    INSERT INTO LOW_STOCK_ALERT (Product_id, Triggered_at)
    SELECT i.Product_id, SYSDATETIME()
    FROM   inserted i
    WHERE  i.Stock_quantity <= i.Reorder_threshold
      AND  NOT EXISTS (SELECT 1
                       FROM LOW_STOCK_ALERT a
                       WHERE a.Product_id = i.Product_id
                         AND a.Resolved_at IS NULL);

    UPDATE a
    SET    a.Resolved_at = SYSDATETIME()
    FROM   LOW_STOCK_ALERT a
    JOIN   inserted i ON i.Product_id = a.Product_id
    WHERE  a.Resolved_at IS NULL
      AND  i.Stock_quantity > i.Reorder_threshold;
END;
GO

CREATE OR ALTER TRIGGER TR_SUPPLIER_ORDER_Received
ON SUPPLIER_ORDER
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT UPDATE(Status) RETURN;

    DECLARE @received TABLE (Order_id INT PRIMARY KEY);

    INSERT INTO @received (Order_id)
    SELECT i.Order_id
    FROM   inserted i
    JOIN   deleted d ON d.Order_id = i.Order_id
    WHERE  i.Status = 'Received'
      AND  d.Status <> 'Received';

    IF NOT EXISTS (SELECT 1 FROM @received) RETURN;

    UPDATE p
    SET    p.Stock_quantity = p.Stock_quantity + s.Qty
    FROM   PRODUCT p
    JOIN  (SELECT oi.Product_id, SUM(oi.Quantity) AS Qty
           FROM   SUPPLIER_ORDER_ITEM oi
           JOIN   @received r ON r.Order_id = oi.Order_id
           GROUP BY oi.Product_id) s
           ON s.Product_id = p.Product_id;

    UPDATE so
    SET    so.Received_date = SYSDATETIME()
    FROM   SUPPLIER_ORDER so
    JOIN   @received r ON r.Order_id = so.Order_id
    WHERE  so.Received_date IS NULL;
END;
GO

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

CREATE OR ALTER TRIGGER TR_SALES_TRANSACTION_StatusFlow
ON SALES_TRANSACTION
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT UPDATE(Status) RETURN;

    IF EXISTS (
      SELECT 1
      FROM   inserted i
      JOIN   deleted d on d.Transaction_id = i.Transaction_id
      WHERE  d.Status IN ('completed', 'voided')
        AND  i.Status <> d.Status)
      THROW 50003, 'Cannot change status of a completed or voided sale.', 1;
END;
GO

CREATE OR ALTER TRIGGER TR_REVIEW_Guard
ON REVIEW
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF NOT (UPDATE(Transaction_id) OR UPDATE(Customer_id) OR UPDATE(Product_id)) RETURN;

  IF EXISTS (SELECT 1
             FROM   inserted i
             JOIN   SALES_TRANSACTION s ON s.Transaction_id = i.Transaction_id
             WHERE  s.Customer_id <> i.Customer_id)
      THROW 50004, 'A review can only be linked to a purchase made by the same customer.', 1;

  IF EXISTS (SELECT 1
             FROM   inserted i
             JOIN   SALES_TRANSACTION s ON s.Transaction_id = i.Transaction_id
             WHERE  s.Status <> 'completed')
      THROW 50004, 'A review can only be linked to a completed purchase.', 1;

  IF EXISTS (SELECT 1
             FROM   inserted i
             JOIN   SALES_TRANSACTION s ON s.Transaction_id = i.Transaction_id
             WHERE  NOT EXISTS (SELECT 1
                                FROM   TRANSACTION_ITEM ti
                                WHERE  ti.Transaction_id = i.Transaction_id
                                  AND  ti.Product_id     = i.Product_id))
      THROW 50004, 'The reviewed product is not part of that purchase.', 1;
END;
GO

CREATE OR ALTER TRIGGER TR_TRANSACTION_ITEM_Guard
ON TRANSACTION_ITEM
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF EXISTS (SELECT 1
             FROM  (SELECT Transaction_id FROM inserted
                    UNION
                    SELECT Transaction_id FROM deleted) x
             JOIN   SALES_TRANSACTION s ON s.Transaction_id = x.Transaction_id
             WHERE  s.Status <> 'open')
      THROW 50005, 'Item can only be added, changed or removed while the sale is open.', 1;

  IF EXISTS (SELECT 1
             FROM   inserted i
             JOIN   PRODUCT p ON p.Product_id = i.Product_id
             LEFT JOIN deleted d ON d.Transaction_id = i.Transaction_id
                                 AND d.Product_id = i.Product_id
             WHERE i.Quantity > p.Stock_quantity
               AND (d.Transaction_id IS NULL OR d.Quantity <> i.Quantity))
      THROW 50005, 'Not enough stock for one of the items in this sale.', 1
END;
GO

CREATE OR ALTER TRIGGER TR_PAYMENT_GUARD
ON PAYMENT
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF EXISTS (SELECT 1
              FROM (SELECT Transaction_id FROM inserted
                    UNION
                    SELECT Transaction_id FROM deleted) x
              JOIN  SALES_TRANSACTION s ON s.Transaction_id = x.Transaction_id
              WHERE s.Status <> 'open')
      THROW 50006, 'Payments can only be recorded while the sale is open.', 1;

  IF EXISTS (SELECT 1
               FROM (SELECT DISTINCT Transaction_id FROM inserted) x
               JOIN  SALES_TRANSACTION s ON s.Transaction_id = x.Transaction_id
              WHERE (SELECT SUM(p.Amount)
                     FROM PAYMENT p
                     WHERE p.Transaction_id = x.Transaction_id) > s.Total)
      THROW 50006, 'The payments for a sale cannot add up to more than its total.', 1;
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

  DECLARE @done TABLE (Transaction_id INT PRIMARY KEY, Total DECIMAL(10,2));

  INSERT INTO @done (Transaction_id, Total)
  SELECT i.Transaction_id, i.Total
  FROM inserted i
  JOIN deleted d ON d.Transaction_id = i.Transaction_id
  WHERE i.Status = 'completed'
    AND d.Status = 'open';

  IF NOT EXISTS (SELECT 1 FROM @done) RETURN;

  IF EXISTS (SELECT 1
             FROM   @done x
             WHERE  NOT EXISTS (SELECT 1
                                FROM   TRANSACTION_ITEM ti
                                WHERE  ti.Transaction_id = x.Transaction_id))
      THROW 50007, 'A sale needs at least one item before it can be completed.', 1;

  IF EXISTS (SELECT 1
             FROM   @done x
             WHERE  ISNULL((SELECT SUM(p.Amount)
                            FROM   PAYMENT p
                            WHERE  p.Transaction_id = x.Transaction_id), 0) <> x.Total)
      THROW 50007, 'The payments must add up exactly to the sale total before it can be completed.', 1;
END;
GO

CREATE OR ALTER TRIGGER TR_PRODUCT_RETURN_ITEM_Guard
ON PRODUCT_RETURN_ITEM
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @row TABLE (
    Return_id      INT,
    Product_id     INT,
    Sale_Status    VARCHAR(10),
    Return_status  VARCHAR(10),
    Sale_date      DATETIME2,
    Requested_at   DATETIME2,
    Has_line       BIT,
    Purchased_qty  DECIMAL(38,0),
    Return_qty     DECIMAL(38,0),
    Returned_total DECIMAL(38,0),
    Line_c         DECIMAL(38,0),
    Sub_c          DECIMAL(38,0),
    Tax_c          DECIMAL(38,0),
    Refund_c       DECIMAL(38,0),
    PRIMARY KEY (Return_id, Product_id));

  INSERT INTO @row
  SELECT i.Return_id, i.Product_id, s.Status, r.Status, s.Transaction_date, r.Requested_at,
         CASE WHEN ti.Product_id IS NULL THEN 0 ELSE 1 END,
         ISNULL(ti.Quantity, 0),
         i.Quantity,
         (SELECT SUM(x.Quantity)
          FROM   PRODUCT_RETURN_ITEM x
          JOIN   PRODUCT_RETURN rx ON rx.Return_id = x.Return_id
          WHERE  rx.Transaction_id = r.Transaction_id
            AND  x.Product_id = i.Product_id
            AND  rx.Status <> 'denied'),
          ROUND(ISNULL(ti.Line_total, 0) * 100, 0),
          ROUND(s.Subtotal * 100, 0),
          ROUND(s.Tax_amount * 100, 0),
          ROUND(i.Refund_amount * 100, 0)
  FROM    inserted i
  JOIN    PRODUCT_RETURN r ON r.Return_id = i.Return_id
  JOIN    SALES_TRANSACTION s ON s.Transaction_id = r.Transaction_id
  LEFT JOIN TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id
                              AND ti.Product_id = i.Product_id

  IF EXISTS(SELECT 1 FROM @row WHERE Sale_status <> 'completed')
    THROW 50008, 'Only items from a completed sale can be returned.', 1;

  IF EXISTS(SELECT 1 FROM @row WHERE Has_line = 0)
    THROW 50008, 'That product is not part of the sale.', 1;

  IF EXISTS(SELECT 1 FROM @row WHERE Return_status <> 'requested')
    THROW 50008, 'Items can only be changed while the return is still requested.', 1;

  IF EXISTS(SELECT 1 FROM @row WHERE Requested_at > DATEADD(DAY, 30, Sale_date))
    THROW 50008, 'Returns must be requested within 30 days of the sale.', 1;

  IF EXISTS(SELECT 1 FROM @row WHERE Returned_total > Purchased_qty)
    THROW 50008, 'More items are being returned than were purchased.', 1;

  IF EXISTS (SELECT 1
             FROM   @row
             WHERE  NOT (
                    (Sub_c = 0 AND
                     2 * Line_c * Return_qty + Purchased_qty >= 2 * Refund_c * Purchased_qty)
                 OR (Sub_c <> 0 AND
                     2 * Line_c * (Sub_c + Tax_c) * Return_qty + Sub_c * Purchased_qty
                       >= 2 *Refund_c * Sub_c * Purchased_qty)))
      THROW 50008, 'The refund amount is higher than the purchase allows.', 1;
END;
GO

CREATE OR ALTER TRIGGER TR_PRODUCT_RETURN_Refunded
ON PRODUCT_RETURN
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF NOT UPDATE(Status) RETURN;

  DECLARE @refunded TABLE (Return_id INT PRIMARY KEY, Transaction_id INT, Old_status VARCHAR(10));

  INSERT INTO @refunded (Return_id, Transaction_id, Old_status)
  SELECT i.Return_id, i.Transaction_id, d.Status
  FROM   inserted i
  JOIN   deleted  d ON d.Return_id = i.Return_id
  WHERE  i.Status = 'refunded'
    AND  d.Status <> 'refunded';

  IF NOT EXISTS (SELECT 1 FROM @refunded) RETURN;

  IF EXISTS (SELECT 1 FROM @refunded WHERE Old_status <> 'approved')
      THROW 50009, 'A return must be approved before it can be refunded.', 1;

  UPDATE p
  SET    p.Stock_quantity = p.Stock_quantity + s.Qty
  FROM   PRODUCT p
  JOIN  (SELECT ri.Product_id, SUM(ri.Quantity) AS Qty
         FROM   PRODUCT_RETURN_ITEM ri
         JOIN   @refunded r ON r.Return_id = ri.Return_id
         GROUP BY ri.Product_id) s
         ON s.Product_id = p.Product_id;

  INSERT INTO LOYALTY_TRANSACTION
        (Customer_id, Transaction_id, Program_id, Points_change, Reason, Created_at)
  SELECT st.Customer_id,
         st.Transaction_id,
         rp.Program_id,
         -pts.Points,
         N'Return refund',
         SYSDATETIME()
  FROM   @refunded r
  JOIN   SALES_TRANSACTION st ON st.Transaction_id = r.Transaction_id
  JOIN   REWARD_PROGRAM rp
         ON  CAST(st.Transaction_date AS DATE) >= rp.Effective_from
         AND (rp.Effective_to IS NULL
            OR CAST(st.Transaction_date AS DATE) <= rp.Effective_to)
  CROSS APPLY (SELECT CAST(FLOOR(
                      SUM(CAST(ti.Line_total AS DECIMAL(20,8)) * ri.Quantity / ti.Quantity)
                          * rp.Points_per_dollar + 0.000001) AS INT) AS Points
               FROM   PRODUCT_RETURN_ITEM ri
               JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = r.Transaction_id
                                          AND ti.Product_id     = ri.Product_id
               WHERE  ri.Return_id = r.Return_id) pts
  WHERE  pts.Points > 0;
END;
GO

CREATE OR ALTER TRIGGER TR_INVENTORY_ADJUSTMENT_Apply
ON INVENTORY_ADJUSTMENT
AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @net TABLE (Product_id INT PRIMARY KEY, Qty INT);

  INSERT INTO @net (Product_id, Qty)
  SELECT Product_id, SUM(Quantity_Change)
  FROM   inserted
  GROUP BY Product_id;

  IF EXISTS (SELECT 1
             FROM   @net n
             JOIN   PRODUCT p ON p.Product_id = n.Product_id
             WHERE  p.Stock_quantity + n.Qty < 0)
      THROW 50010, 'This adjustment would make the stock negative', 1;

  UPDATE p
  SET    p.Stock_quantity = p.Stock_quantity + n.Qty
  FROM   PRODUCT p
  JOIN   @net n ON n.Product_id = p.Product_id;
END;
GO