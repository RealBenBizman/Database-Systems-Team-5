// GET /api/reports/inventory -> stock against reorder threshold, plus orders by status
// Managers only.
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

// every active product with its stock, threshold and how old its open alert is
const PRODUCTS_SQL = `
  SELECT p.Product_id AS productId, p.Name AS name,
         p.Stock_quantity AS stock, p.Reorder_threshold AS threshold,
         CASE WHEN p.Stock_quantity <= p.Reorder_threshold THEN 'Low' ELSE 'OK' END AS level,
         DATEDIFF(DAY, a.Triggered_at, SYSDATETIME()) AS alertAgeDays
  FROM   PRODUCT p
  LEFT JOIN LOW_STOCK_ALERT a
         ON a.Product_id = p.Product_id AND a.Resolved_at IS NULL AND a.Marked_for_deletion = 0
  WHERE  p.Marked_for_deletion = 0 AND p.Is_active = 1
  ORDER BY (p.Stock_quantity - p.Reorder_threshold), p.Name`;

// how many supplier orders are in each status
const ORDERS_SQL = `
  SELECT Status AS status, COUNT(*) AS orders
  FROM   SUPPLIER_ORDER
  WHERE  Marked_for_deletion = 0
  GROUP BY Status`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const products = await query(PRODUCTS_SQL);
    const orders = await query(ORDERS_SQL);
    return { products: products.recordset, ordersByStatus: orders.recordset };
  },
});