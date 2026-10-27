USE pos_store;
GO  

CREATE OR ALTER PROCEDURE dbo.DenyReturn
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
          AND Status = 'requested'
    )
    BEGIN
        THROW 50044, 'Only requested returns can be denied.',1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM EMPLOYEE
        WHERE Employee_id = @Employee_id
    )
    BEGIN
        THROW 50045, 'Employee does not exist.',1;
    END;

    UPDATE PRODUCT_RETURN
    SET Status = 'denied',
        Employee_id = @Employee_id
    WHERE Return_id = @Return_id;

    SELECT
        Return_id,
        Transaction_id,
        Employee_id,
        Reason,
        Status
    FROM PRODUCT_RETURN
    WHERE Return_id = @Return_id;
END;
GO