USE pos_store
GO

CREATE OR ALTER PROCEDURE dbo.RequestReturn
    @Transaction_ID INT,
    @Reason NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1
        FROM SALES_TRANSACTION
        WHERE Transaction_id = @Transaction_id
    )
    BEGIN
        THROW 50011, 'Transaction does not exist.',1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM SALES_TRANSACTION
        WHERE Transaction_id = @Transaction_id
            AND Status = 'completed'
    )
    BEGIN
        THROW 50012, 'Transaction has not been completed.',1;
    END;

    IF EXISTS (
        SELECT 1
        FROM SALES_TRANSACTION
        WHERE Transaction_id = @Transaction_id AND DATEADD(DAY, 30, Transaction_date) < SYSDATETIME()
    )
    BEGIN
        THROW 50013, 'The 30-day return period has expired.',1;
    END;

    INSERT INTO PRODUCT_RETURN (Transaction_ID, Reason)
    VALUES (@Transaction_id, @Reason);

    SELECT CAST(SCOPE_IDENTITY() AS INT) AS Return_id;
END;
GO
