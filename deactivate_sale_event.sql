USE pos_store;
GO

CREATE OR ALTER PROCEDURE dbo.DeactivateSaleEvent
    @Sale_event_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(
        SELECT 1
        FROM SALE_EVENT
        WHERE Sale_event_id = @Sale_event_id
        AND Marked_for_deletion = 0
    )
    BEGIN
        THROW 50065, 'Sale event does not exist or has been deleted.',1;
    END;
    
    UPDATE SALE_EVENT
    SET Is_active = 0
    WHERE Sale_event_id = @Sale_event_id
      AND Marked_for_deletion = 0;
END;
GO