-- Part 2 (Terry): the SQL behind each checkout and orders screen, to run by hand in
-- VS Code. Use it to check what the pages show: each block matches one API endpoint.
-- Run after the seed. Change the email or the dates to try other cases.
USE pos_store;
DECLARE @Customer_id INT = (SELECT Customer_id FROM CUSTOMER WHERE Email = 'alice.nguyen@posstore.test');
DECLARE @Tid  INT  = (SELECT MAX(Transaction_id) FROM SALES_TRANSACTION WHERE Customer_id = @Customer_id AND Status = 'completed');
DECLARE @From DATE = '2026-10-01', @To DATE = '2026-10-31';

-- 1. Order history: a customer's finished orders, newest first   (GET /api/orders)
SELECT s.Transaction_id, s.Transaction_date, s.Status, s.Total,
       (SELECT SUM(ti.Quantity) FROM TRANSACTION_ITEM ti
        WHERE ti.Transaction_id = s.Transaction_id AND ti.Marked_for_deletion = 0) AS Items
FROM SALES_TRANSACTION s
WHERE s.Customer_id = @Customer_id AND s.Status <> 'open' AND s.Marked_for_deletion = 0
ORDER BY s.Transaction_date DESC;

-- 2a. Order detail: the order itself   (GET /api/orders/<id>)
SELECT Transaction_id, Transaction_date, Status, Subtotal, Tax_amount, Total,
       Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip,
       Tracking_number, Estimated_arrival
FROM SALES_TRANSACTION
WHERE Transaction_id = @Tid AND Customer_id = @Customer_id AND Marked_for_deletion = 0;

-- 2b. Order detail: its items
SELECT p.Name, ti.Quantity, ti.Unit_price, ti.Discount_amount, ti.Line_total
FROM TRANSACTION_ITEM ti
JOIN SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
JOIN PRODUCT p ON p.Product_id = ti.Product_id
WHERE ti.Transaction_id = @Tid AND s.Customer_id = @Customer_id AND ti.Marked_for_deletion = 0;

-- 2c. Order detail: its payments
SELECT pay.Method, pay.Amount, pay.Card_last4, pay.Paid_at
FROM PAYMENT pay
JOIN SALES_TRANSACTION s ON s.Transaction_id = pay.Transaction_id
WHERE pay.Transaction_id = @Tid AND s.Customer_id = @Customer_id AND pay.Marked_for_deletion = 0;

-- 3a. Sales report: by day (the report view)   (GET /api/reports/sales)
SELECT * FROM VW_SALES_REPORT
WHERE Sale_date BETWEEN @From AND @To ORDER BY Sale_date;

-- 3b. Sales report: top 5 products
SELECT TOP 5 p.Name, SUM(ti.Quantity) AS Units, SUM(ti.Line_total) AS Revenue
FROM TRANSACTION_ITEM ti
JOIN SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
JOIN PRODUCT p ON p.Product_id = ti.Product_id
WHERE s.Status = 'completed' AND s.Marked_for_deletion = 0 AND ti.Marked_for_deletion = 0
  AND s.Transaction_date >= @From AND s.Transaction_date < DATEADD(day, 1, @To)
GROUP BY p.Product_id, p.Name
ORDER BY Units DESC;
