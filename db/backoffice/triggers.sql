   USE pos_store;
   GO

   -- Trigger: TR_INVENTORY_ADJUSTMENT_Apply
-- When a row is added to INVENTORY_ADJUSTMENT:
--   a) reject it if the product's stock would drop below 0
--   b) otherwise add Quantity_change to PRODUCT.Stock_quantity

CREATE OR ALTER TRIGGER TR_INVENTORY_ADJUSTMENT_Apply
ON INVENTORY_ADJUSTMENT
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Check first: would any product's stock go below 0?
    IF EXISTS (
        SELECT 1
        FROM   inserted i
        JOIN   PRODUCT p ON p.Product_id = i.Product_id
        GROUP BY p.Product_id, p.Stock_quantity
        HAVING p.Stock_quantity + SUM(i.Quantity_change) < 0
    )
        THROW 50040, 'Adjustment rejected: stock cannot go below 0.', 1;

            -- Apply: add each product's total change to its stock
    UPDATE p
    SET    p.Stock_quantity = p.Stock_quantity + s.Total_change
    FROM   PRODUCT p
    JOIN   (SELECT Product_id, SUM(Quantity_change) AS Total_change
            FROM   inserted
            GROUP BY Product_id) s ON s.Product_id = p.Product_id;

END
GO