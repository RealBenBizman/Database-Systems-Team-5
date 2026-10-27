USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.UpdateDiscount
    @Discount_id INT,
    @Discount_name NVARCHAR(255) = NULL,
    @Discount_type NVARCHAR(50) = NULL,
    @Code NVARCHAR(50) = NULL,
    @Amount DECIMAL(18, 2) = NULL,
    @Amount_type NVARCHAR(50) = NULL,
    @Start_date DATE = NULL,
    @End_date DATE = NULL,
    @Sale_event_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1
        FROM DISCOUNT
        WHERE Discount_id = @Discount_id
            AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 50073, 'Discount does not exist or has been deleted.', 1;
    END;

    IF @Amount IS NOT NULL AND @Amount <= 0
    BEGIN
        THROW 50074, 'Amount must be greater than 0.', 1;
    END;

    IF @Discount_name IS NOT NULL AND LTRIM(RTRIM(@Discount_name)) = ''
    BEGIN
        THROW 50075, 'Discount name cannot be empty.', 1;
    END;

    IF @Amount_type IS NOT NULL AND @Amount_type NOT IN ('percent', 'fixed')
    BEGIN
        THROW 50076, 'Amount type must be either ''percent'' or ''fixed''.', 1;
    END;

    IF @Discount_type IS NOT NULL AND @Discount_type NOT IN ('percent', 'fixed')
    BEGIN
        THROW 50077, 'Discount type must be either ''percent'' or ''fixed''.', 1;
    END;


    IF (
        COALESCE(@Amount_type,
            (SELECT Amount_type FROM DISCOUNT WHERE Discount_id = @Discount_id)
        ) = 'percent'
        AND
        COALESCE(@Amount,
            (SELECT Amount FROM DISCOUNT WHERE Discount_id = @Discount_id)
        ) > 100
    )
    BEGIN
        THROW 50078, 'Percentage discount cannot exceed 100.', 1;
    END;


    IF COALESCE(@Start_date,
        (SELECT Start_date FROM DISCOUNT WHERE Discount_id = @Discount_id)
    ) >
    COALESCE(@End_date,
        (SELECT End_date FROM DISCOUNT WHERE Discount_id = @Discount_id)
    )
    BEGIN
        THROW 50079, 'Start date cannot be after end date.', 1;
    END;


    IF @Sale_event_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM SALE_EVENT
        WHERE Sale_event_id = @Sale_event_id
             AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 50080, 'Sale event does not exist or has been deleted.', 1;
    END;

    UPDATE DISCOUNT
    SET
        Discount_name = COALESCE(@Discount_name, Discount_name),
        Discount_type = COALESCE(@Discount_type, Discount_type),
        Code = COALESCE(@Code, Code),
        Amount = COALESCE(@Amount, Amount),
        Amount_type = COALESCE(@Amount_type, Amount_type),
        Start_date = COALESCE(@Start_date, Start_date),
        End_date = COALESCE(@End_date, End_date),
        Sale_event_id = COALESCE(@Sale_event_id, Sale_event_id)
    WHERE Discount_id = @Discount_id AND Marked_for_deletion = 0;

END;
GO