USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.UpdateSaleEvent
    @Sale_event_id INT,
    @Event_name NVARCHAR(200),
    @Description NVARCHAR(500),
    @Start_date DATE,
    @End_date DATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (
        SELECT 1
        FROM SALE_EVENT
        WHERE Sale_event_id = @Sale_event_id
            AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 500062, 'Sale event does not exist or has been deleted.',1;
    END;

    IF @Start_date IS NULL
        OR @End_date IS NULL
        OR @Start_date > @End_date
    BEGIN
        THROW 500063, 'Start date cannot be after end date or be NULL.',1;
    END;

    IF @Event_name IS NULL OR LTRIM(RTRIM(@Event_name)) = ''
    BEGIN
        THROW 500064, 'Event name cannot be NULL.',1;
    END;


    UPDATE SALE_EVENT
    SET Event_name = @Event_name,
        Description = @Description,
        Start_date = @Start_date,
        End_date = @End_date
    WHERE Sale_event_id = @Sale_event_id;

END;
GO