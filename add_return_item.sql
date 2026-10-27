USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.AddReturnItem
    @Return_id INT,
    @Product_id INT,
    @Quantity INT
AS
BEGIN
    SET NOCOUNT ON;

    
    IF NOT EXISTS (
        SELECT 1
        FROM PRODUCT_RETURN
        WHERE Return_id = @Return_id
    )
    BEGIN
        THROW 50021, 'Return does not exist.',1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM PRODUCT
        WHERE Product_id = @Product_id
    )
    BEGIN
        THROW 50022, 'Product does not exist.',1;
    END;

    IF @Quantity IS NULL OR @Quantity <= 0
    BEGIN
        THROW 50023, 'Quantity must be a positive number.',1;
    END;

    DECLARE @Refund_amount DECIMAL(10, 2);

    SELECT @Refund_amount = CAST (
        ROUND (
            (ti.Line_total +
            CASE
                WHEN s.Subtotal = 0 THEN 0
                ELSE s.Tax_amount * ti.Line_total / s.Subtotal
            END
        ) * @Quantity / ti.Quantity,
        2
    ) As DECIMAL(10,2)
)
    FROM PRODUCT_RETURN r
    JOIN SALES_TRANSACTION s
        ON r.Transaction_id = s.Transaction_id
    JOIN TRANSACTION_ITEM ti
        ON s.Transaction_id = ti.Transaction_id
    WHERE r.Return_id = @Return_id
      AND ti.Product_id = @Product_id;


    IF @Refund_amount IS NULL
    BEGIN
        THROW 50024, 'Product was not purchased in this transaction.',1;
    END;

    IF @Refund_amount < 0
    BEGIN
        THROW 50026, 'Refund amount must be a non-negative number.',1;
    END;

    INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount)
    VALUES (@Return_id, @Product_id, @Quantity, @Refund_amount);

    SELECT 
        Return_id,
        Product_id,
        Quantity,
        Refund_amount
    FROM PRODUCT_RETURN_ITEM
    WHERE Return_id = @Return_id
      AND Product_id = @Product_id;
END;
GO