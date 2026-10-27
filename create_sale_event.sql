USE pos_store
GO

CREATE OR ALTER PROCEDURE dbo.CreateSaleEvent
    @Event_name NVARCHAR(200),
    @Description NVARCHAR(500),
    @Start_date DATE,
    @End_date DATE
AS
BEGIN
    SET NOCOUNT ON;

    IF @Start_date > @End_date
    BEGIN
        THROW 50061, 'Start date cannot be after end date.', 1;
    END;

    INSERT INTO SALE_EVENT (Event_name, Description, Start_date, End_date)
    VALUES (@Event_name, @Description, @Start_date, @End_date);
END;
GO