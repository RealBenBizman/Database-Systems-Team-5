
USE GameStore;
GO

-- Create a Halloween sale event
INSERT INTO SALE_EVENT
    (Event_name, Description, Start_date, End_date)
VALUES
    ('Halloween Sale', 'Halloween promotion',
     '2026-10-25', '2026-10-31');

-- Display the sale events
SELECT * FROM SALE_EVENT;
