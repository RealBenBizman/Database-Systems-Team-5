USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.CreateDiscount
    @Discount_name NVARCHAR(200),
    @Discount_type VARCHAR(50),
    @Code VARCHAR(50),
    @Amount DECIMAL(10,2),
    @Amount_type VARCHAR(50),
    @Start_date DATE,
    @End_date DATE,
    @Sale_event_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Start_date IS NULL OR @End_date IS NULL OR @Start_date > @End_date
    BEGIN
        THROW 50066, 'Invalid discount dates.',1;
    END;

    IF @Amount IS NULL OR @Amount <= 0
    BEGIN
        THROW 50067, 'Discount amount must be greater than zero.',1;
    END;

    IF @Discount_name IS NULL OR LTRIM(RTRIM(@Discount_name)) = ''
    BEGIN
        THROW 50068, 'Discount name cannot be empty or NULL.',1;
    END;

    IF @Amount_type IS NULL OR @Amount_type NOT IN ('percent', 'fixed')
    BEGIN
        THROW 50069, 'Invalid amount type. Must be either ''percent'' or ''fixed''.',1;
    END;
    
    IF @Amount_type = 'percent' AND @Amount > 100
    BEGIN
        THROW 50070, 'Percentage discount cannot exceed 100.',1;
    END;

    IF @Discount_type IS NULL OR @Discount_type NOT IN ('fixed','percent')
    BEGIN
        THROW 50072, 'Invalid discount type. Must be either ''fixed'' or ''percent''.',1;
    END;

    IF @Sale_event_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM SALE_EVENT
        WHERE Sale_event_id = @Sale_event_id
            AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 50071, 'Sale event does not exist or has been marked for deletion.',1;
    END;

    INSERT INTO DISCOUNT (
        Discount_name,
        Discount_type,
        Code,
        Amount,
        Amount_type,
        Start_date,
        End_date,
        Sale_event_id
    )
    VALUES (
        @Discount_name,
        @Discount_type,
        @Code,
        @Amount,
        @Amount_type,
        @Start_date,
        @End_date,
        @Sale_event_id
    );

END;
GO