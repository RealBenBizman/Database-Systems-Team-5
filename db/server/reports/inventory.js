// GET /api/reports/inventory -> stock against reorder threshold, open alerts,
// inventory value at cost, and how many supplier orders are in each status.
// Support and managers can read it (decided 2026-10-21). Built on the view
// VW_INVENTORY_REPORT (db/core/views.sql), as the instructor asked.
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

// One row per product. The view already leaves out flagged rows and gives
// Stock_status ('OK', 'Low', 'Out of stock') and the open alert, if any.
// Only active products are listed, as before; remove the WHERE line to list
// paused products too (they still hold stock, so they count toward the value).
const PRODUCTS_SQL = `
  SELECT Product_id AS productId, SKU AS sku, Product_name AS name,
         Category_name AS category, Cost_price AS costPrice, Sell_price AS sellPrice,
         Stock_quantity AS stock, Reorder_threshold AS threshold,
         Stock_status AS level, Stock_value_at_cost AS valueAtCost,
         Open_alert_id AS alertId, Alert_order_id AS alertOrderId,
         CASE WHEN Alert_opened_at IS NULL THEN NULL
              ELSE DATEDIFF(DAY, Alert_opened_at, SYSDATETIME()) END AS alertAgeDays
  FROM   VW_INVENTORY_REPORT
  WHERE  Is_active = 1
  ORDER BY (Stock_quantity - Reorder_threshold), Product_name`;

// how many supplier orders are in each status
const ORDERS_SQL = `
  SELECT Status AS status, COUNT(*) AS orders
  FROM   SUPPLIER_ORDER
  WHERE  Marked_for_deletion = 0
  GROUP BY Status`;

const STATUSES = ['Pending', 'Ordered', 'Received', 'Cancelled'];

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['support', 'manager']);

    const products = (await query(PRODUCTS_SQL)).recordset;
    const orders = (await query(ORDERS_SQL)).recordset;

    // always return all four statuses, with 0 when there are none
    const counts = {};
    STATUSES.forEach((s) => { counts[s] = 0; });
    orders.forEach((o) => { counts[o.status] = o.orders; });

    const cents = products.reduce((sum, p) => sum + Math.round((Number(p.valueAtCost) || 0) * 100), 0);

    return {
      products,
      ordersByStatus: STATUSES.map((s) => ({ status: s, orders: counts[s] })),
      totals: {
        valueAtCost: cents / 100,
        lowOrOut: products.filter((p) => p.level !== 'OK').length,
        openAlerts: products.filter((p) => p.alertId != null).length,
      },
    };
  },
});