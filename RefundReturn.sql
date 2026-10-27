USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.RefundReturn
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
        THROW 50041, 'Return does not exist.',1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM PRODUCT_RETURN
        WHERE Return_id = @Return_id
          AND Status = 'approved'
    )
    BEGIN
        THROW 50042, 'Only approved returns can be refunded.',1;
    END;

    UPDATE PRODUCT_RETURN
    SET Status = 'refunded',
        Employee_id = @Employee_id,
        Refunded_at = SYSDATETIME()
    WHERE Return_id = @Return_id;

    IF NOT EXISTS (
        SELECT 1
        FROM EMPLOYEE
        WHERE Employee_id = @Employee_id
    )
    BEGIN
        THROW 50043, 'Employee does not exist.',1;
    END;

    SELECT
        Return_id,
        Transaction_id,
        Reason,
        Status,
        Refund_total,
        Refunded_at
    FROM PRODUCT_RETURN
    WHERE Return_id = @Return_id;
END;
GO