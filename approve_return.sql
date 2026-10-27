USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.ApproveReturn
    @Return_id INT,
    @Employee_id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1
        FROM PRODUCT_RETURN
        WHERE Return_id = @Return_id
    )
    BEGIN
        THROW 50031, 'Return does not exist.',1;
    END;
    
    IF NOT EXISTS (
        SELECT 1
        FROM PRODUCT_RETURN
        WHERE Return_id = @Return_id
          AND Status = 'requested'
    )
    BEGIN
        THROW 50032, 'Only requested returns can be approved.',1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM PRODUCT_RETURN_ITEM
        WHERE Return_id = @Return_id
    )
    BEGIN
        THROW 50033, 'Return must have at least one item.',1;
    END;

    DECLARE @Refund_total DECIMAL(10,2);

    SELECT @Refund_total = SUM(Refund_amount)
    FROM PRODUCT_RETURN_ITEM
    WHERE Return_id = @Return_id;

    UPDATE PRODUCT_RETURN
    SET Status = 'approved',
        Employee_id = @Employee_id,
        Refund_total = @Refund_total
    WHERE Return_id = @Return_id;

    SELECT
        Return_id,
        Transaction_id,
        Reason,
        Status,
        Refund_total
    FROM PRODUCT_RETURN
    WHERE Return_id = @Return_id;
END;
GO