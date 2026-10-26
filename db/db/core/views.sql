USE pos_store;
GO

CREATE OR ALTER VIEW VW_SALES_REPORT AS
SELECT x.Sale_date,
       COUNT(*)                                                        AS Orders,
       SUM(x.Units)                                                    AS Units,
       CAST(SUM(x.Subtotal) AS DECIMAL(12,2))                          AS Gross_revenue,
       CAST(SUM(x.Refunded_revenue) AS DECIMAL(12,2))                  AS Refunded_revenue,
       CAST(SUM(x.Subtotal) - SUM(x.Refunded_revenue) AS DECIMAL(12,2)) AS Net_revenue,
       CAST(SUM(x.Tax_amount) AS DECIMAL(12,2))                        AS Tax_collected,
       CAST(SUM(x.Total) AS DECIMAL(12,2))                             AS Total_collected
FROM (
    SELECT CAST(s.Transaction_date AS DATE) AS Sale_date,
           s.Subtotal, s.Tax_amount, s.Total,
           ISNULL(l.Units, 0)            AS Units,
           ISNULL(l.Refunded_revenue, 0) AS Refunded_revenue
    FROM   SALES_TRANSACTION s
    OUTER APPLY (
        SELECT SUM(ti.Quantity) AS Units,
               SUM(ROUND(ti.Line_total * f.Qty / ti.Quantity, 2)) AS Refunded_revenue
        FROM   TRANSACTION_ITEM ti
        CROSS APPLY (SELECT ISNULL(SUM(ri.Quantity), 0) AS Qty
                     FROM   PRODUCT_RETURN r
                     JOIN   PRODUCT_RETURN_ITEM ri ON ri.Return_id = r.Return_id
                     WHERE  r.Transaction_id = ti.Transaction_id
                       AND  ri.Product_id    = ti.Product_id
                       AND  r.Status = 'refunded'
                       AND  r.Marked_for_deletion  = 0
                       AND  ri.Marked_for_deletion = 0) f
        WHERE  ti.Transaction_id = s.Transaction_id
          AND  ti.Marked_for_deletion = 0
    ) l
    WHERE  s.Status = 'completed'
      AND  s.Marked_for_deletion = 0
) x
GROUP BY x.Sale_date;
GO

CREATE OR ALTER VIEW VW_SALES_BY_CATEGORY AS
SELECT CAST(s.Transaction_date AS DATE) AS Sale_date,
       c.Category_id,
       c.Name AS Category_name,
       SUM(ti.Quantity) AS Units,
       CAST(SUM(ti.Line_total) AS DECIMAL(12,2)) AS Gross_revenue,
       CAST(SUM(ROUND(ti.Line_total * f.Qty / ti.Quantity, 2)) AS DECIMAL(12, 2)) AS Refunded_revenue,
       CAST(SUM(ti.Line_total) - SUM(ROUND(ti.Line_total * f.Qty / ti.Quantity, 2)) AS DECIMAL(12, 2)) AS Net_revenue
FROM   SALES_TRANSACTION s
JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id
JOIN   PRODUCT p ON p.Product_id = ti.Product_id
JOIN   CATEGORY c ON c.Category_id = p.Category_id
CROSS APPLY (SELECT ISNULL(SUM(ri.Quantity), 0) AS Qty
             FROM   PRODUCT_RETURN r
             JOIN   PRODUCT_RETURN_ITEM ri ON ri.Return_id = r.Return_id
             WHERE  r.Transaction_id = ti.Transaction_id
               AND  ri.Product_id = ti.Product_id
               AND  r.Status = 'refunded'
               AND  r.Marked_for_deletion = 0
               AND  ri.Marked_for_deletion = 0) f
WHERE s.Status = 'completed'
  AND s.Marked_for_deletion = 0
  AND ti.Marked_for_deletion = 0
  AND p.Marked_for_deletion = 0
  AND c.Marked_for_deletion = 0
GROUP BY CAST(s.Transaction_date AS DATE), c.Category_id, c.Name;
GO

CREATE OR ALTER VIEW VW_INVENTORY_REPORT AS
SELECT p.Product_id,
       p.SKU,
       p.Name                                          AS Product_name,
       c.Name                                          AS Category_name,
       p.Product_condition,
       p.Is_active,
       p.Cost_price,
       p.Sell_price,
       p.Stock_quantity,
       p.Reorder_threshold,
       CASE WHEN p.Stock_quantity = 0                   THEN 'Out of stock'
            WHEN p.Stock_quantity <= p.Reorder_threshold THEN 'Low'
            ELSE 'OK' END                              AS Stock_status,
       CAST(p.Stock_quantity * p.Cost_price AS DECIMAL(12,2)) AS Stock_value_at_cost,
       CAST(p.Stock_quantity * p.Sell_price AS DECIMAL(12,2)) AS Stock_value_at_price,
       a.Alert_id                                      AS Open_alert_id,
       a.Triggered_at                                  AS Alert_opened_at,
       a.Order_id                                      AS Alert_order_id
FROM   PRODUCT p
JOIN   CATEGORY c ON c.Category_id = p.Category_id
OUTER APPLY (SELECT TOP (1) la.Alert_id, la.Triggered_at, la.Order_id
             FROM   LOW_STOCK_ALERT la
             WHERE  la.Product_id = p.Product_id
               AND  la.Resolved_at IS NULL
               AND  la.Marked_for_deletion = 0
             ORDER BY la.Triggered_at DESC, la.Alert_id DESC) a
WHERE  p.Marked_for_deletion = 0
  AND  c.Marked_for_deletion = 0;
GO

CREATE OR ALTER VIEW VW_REWARDS_REPORT AS
SELECT cu.Customer_id,
       CONCAT(cu.First_name, N' ', cu.Last_name)       AS Customer_name,
       cu.Email,
       cu.Loyalty_points,
       ISNULL(t.Tier_name, N'No tier')                 AS Tier_name,
       ISNULL(lp.Points_earned, 0)                     AS Points_earned,
       ISNULL(lp.Points_taken_back, 0)                 AS Points_taken_back,
       ISNULL(o.Orders, 0)                             AS Orders,
       CAST(ISNULL(o.Total_spent, 0) AS DECIMAL(12,2)) AS Total_spent,
       lp.Last_activity
FROM   CUSTOMER cu
LEFT JOIN REWARD_TIER t ON t.Tier_id = cu.Tier_id
OUTER APPLY (SELECT SUM(CASE WHEN lt.Points_change > 0 THEN lt.Points_change ELSE 0 END)  AS Points_earned,
                    SUM(CASE WHEN lt.Points_change < 0 THEN -lt.Points_change ELSE 0 END) AS Points_taken_back,
                    MAX(lt.Created_at)                                                    AS Last_activity
             FROM   LOYALTY_TRANSACTION lt
             WHERE  lt.Customer_id = cu.Customer_id
               AND  lt.Marked_for_deletion = 0) lp
OUTER APPLY (SELECT COUNT(*) AS Orders, SUM(s.Subtotal) AS Total_spent
             FROM   SALES_TRANSACTION s
             WHERE  s.Customer_id = cu.Customer_id
               AND  s.Status = 'completed'
               AND  s.Marked_for_deletion = 0) o
WHERE  cu.Marked_for_deletion = 0;
GO