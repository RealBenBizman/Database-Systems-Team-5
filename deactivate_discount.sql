USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.DeactivateDiscount
    @Discount_id INT
AS
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM DISCOUNT
        WHERE Discount_id = @Discount_id
             AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 50081, 'Discount does not exist or has already been deleted.', 1;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM DISCOUNT
        WHERE Discount_id = @Discount_id
             AND Is_active = 1
             AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 50082, 'Discount is already deactivated or has been deleted.', 1;
    END;

    UPDATE DISCOUNT
    SET Is_active = 0
    WHERE Discount_id = @Discount_id
      AND Marked_for_deletion = 0;
END;
GO