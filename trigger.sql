CREATE OR ALTER TRIGGER trg_discount_event_dates
ON DISCOUNT
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    if EXISTS (
        SELECT 1
        FROM inserted AS d
        JOIN SALE_EVENT AS s 
        ON d.Sale_event_id = s.sale_event_id
        WHERE d.start_date < s.start_date OR d.end_date > s.end_date
    )
    BEGIN;
        THROW 50011, 'Discount dates must be within the associated sale event dates.', 1;
    END
END;
GO

