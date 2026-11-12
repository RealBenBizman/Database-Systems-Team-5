USE pos_store;
GO

-- Daily units sold for return rate calculations
CREATE OR ALTER VIEW dbo.VW_UNITS_SOLD_DAILY AS
SELECT
    CAST(s.Transaction_date AS DATE) AS Sale_date,
    ti.Product_id,
    p.Category_id,
    p.Product_condition,

    SUM(ti.Quantity) AS Units,

    CAST(
        SUM(ti.Line_total) AS DECIMAL(12,2)
    ) AS Revenue

FROM dbo.SALES_TRANSACTION s

JOIN dbo.TRANSACTION_ITEM ti
    ON ti.Transaction_id = s.Transaction_id
    AND ti.Marked_for_deletion = 0

JOIN dbo.PRODUCT p
    ON p.Product_id = ti.Product_id
    AND p.Marked_for_deletion = 0

WHERE
    s.Status = 'completed'
    AND s.Marked_for_deletion = 0

GROUP BY
    CAST(s.Transaction_date AS DATE),
    ti.Product_id,
    p.Category_id,
    p.Product_condition;
GO

CREATE OR ALTER VIEW dbo.VW_RETURNS_ANALYSIS AS
SELECT
    r.Return_id,
    r.Transaction_id,
    s.Customer_id,
    r.Employee_id,

    -- Dates
    r.Requested_at,
    CAST(r.Requested_at AS DATE) AS Request_date,
    CAST(s.Transaction_date AS DATE) AS Sale_date,

    DATEDIFF(
        DAY,
        CAST(s.Transaction_date AS DATE),
        CAST(r.Requested_at AS DATE)
    ) AS Days_after_purchase,

    -- Return information
    r.Status,
    r.Reason,
    r.Refunded_at,

    CASE
        WHEN r.Status = 'refunded'
        THEN DATEDIFF(HOUR, r.Requested_at, r.Refunded_at)
    END AS Hours_to_refund,

    CASE
        WHEN r.Status IN ('requested', 'approved')
        THEN DATEDIFF(
            DAY,
            CAST(r.Requested_at AS DATE),
            CAST(SYSDATETIME() AS DATE)
        )
    END AS Days_open,

    -- Product information
    ri.Product_id,
    p.SKU,
    p.Name AS Product_name,
    p.Product_condition,

    c.Category_id,
    c.Name AS Category_name,

    -- Quantities and money
    ri.Quantity,
    ri.Refund_amount,
    ti.Quantity AS Units_purchased,
    CAST(ti.Line_total AS DECIMAL(12,2)) AS Line_total

FROM dbo.PRODUCT_RETURN r

JOIN dbo.PRODUCT_RETURN_ITEM ri
    ON ri.Return_id = r.Return_id
    AND ri.Marked_for_deletion = 0

JOIN dbo.SALES_TRANSACTION s
    ON s.Transaction_id = r.Transaction_id
    AND s.Marked_for_deletion = 0

JOIN dbo.TRANSACTION_ITEM ti
    ON ti.Transaction_id = r.Transaction_id
    AND ti.Product_id = ri.Product_id
    AND ti.Marked_for_deletion = 0

JOIN dbo.PRODUCT p
    ON p.Product_id = ri.Product_id
    AND p.Marked_for_deletion = 0

JOIN dbo.CATEGORY c
    ON c.Category_id = p.Category_id
    AND c.Marked_for_deletion = 0

WHERE r.Marked_for_deletion = 0;
GO
