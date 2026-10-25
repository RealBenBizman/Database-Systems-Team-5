/*
    views.sql - the report views

    Must be run after schema.sql (reads the table). It can be run again at any time (CREATE OR ALTER VIEW).
    A view stores data: every SELECT runs the query again, so a report is always current.

    Rules for every view:
    - Rows with Marked_for_deletion = 1 are left out (also in the joined tables)
    - Sales figures count COMPLETED sales only (not open, not voided).
    - Revenue means Subtotal: after discounts, before tax.
    - Refunds are the pre-tax part of items on returns whose Status is 'refunded':
      line total * returned quantity / purchased quantity, rounded to cents. They
      are attributed to the DAY OF THE ORIGINAL SALE, so a day's Net_revenue already has its later refunds taken off.
    - No password hashes or card details are exposed.

  The API filters and sorts, and add rows up for total (SUM) or group them (by month, by category).
  The views do not know who is asking: the endpoint checks the role
  sales and rewards => managers only, inventory => support or manager
*/
USE pos_store;
GO

-- VW_SALES_REPORT
-- Orders, Units, Gross_revenue, Refunded_revenue, Net_revenue, Tax_collected, Total_collected (Subtotal + tax, before refunds)
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

-- VW_SALES_BY_CATEGORY: one row per sale day and category
--  Units, Gross_revenue (sum of line totals), Refunded_revenue, Net_revenue.
--  Tax is stored per sale, not per line, so it is not split by category
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

-- VW_INVENTORY_REPORT
--  Stock_status: 'Out of Stock', 'Low' (at or below the reorder threshold) or 'OK'.
--  Open_alert_id / Alert_opened_at / Alert_order_id describe the product's unresolved low-stock alert
--  (NULL when there is none). Inactive products are included (Is_active shows 0); the API can filter.
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

-- VW_REWARD_REPORT: one row per customer (all time)
--  Points_earned (positive loyalty rows), Points_taken_back (returns, as a positive number),
--  Loyalty points (current balance), Tier_name ('No tier' when none), Orders and Total_spent (completed sales, Subtotal), Last_activity.
--  The API can group by Tier_name for the tier mix and sort by Points_earned for the top earners.
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