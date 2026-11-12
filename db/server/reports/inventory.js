// GET /api/reports/inventory -> stock against reorder threshold, open alerts,
// inventory value at cost, and how many supplier orders are in each status.
// Only Managers can read it. Built on the view
// VW_INVENTORY_REPORT (db/core/views.sql), as the instructor asked.
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { orderTiming } = require('../../lib/inventoryMetrics');

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

// every supplier order with its supplier, units and cost, newest first.
// promisedDays is the longest lead time the supplier promised for the products on the order
// (SUPPLIER_PRODUCT.Lead_time_days); daysTaken runs from the order date to the received date,
// or to today while the order is still open.
const ORDER_LIST_SQL = `
  SELECT o.Order_id AS orderId, s.Supplier_name AS supplier,
         o.Order_date AS orderDate, o.Received_date AS receivedDate, o.Status AS status,
         ISNULL(SUM(i.Quantity), 0) AS units,
         ISNULL(SUM(i.Quantity * i.Unit_cost), 0) AS total,
         MAX(sp.Lead_time_days) AS promisedDays,
         DATEDIFF(DAY, o.Order_date, ISNULL(o.Received_date, SYSDATETIME())) AS daysTaken
  FROM   SUPPLIER_ORDER o
  JOIN   SUPPLIER s ON s.Supplier_id = o.Supplier_id
  LEFT JOIN SUPPLIER_ORDER_ITEM i ON i.Order_id = o.Order_id AND i.Marked_for_deletion = 0
  LEFT JOIN SUPPLIER_PRODUCT sp ON sp.Supplier_id = o.Supplier_id AND sp.Product_id = i.Product_id
                               AND sp.Marked_for_deletion = 0
  WHERE  o.Marked_for_deletion = 0
  GROUP BY o.Order_id, s.Supplier_name, o.Order_date, o.Received_date, o.Status
  ORDER BY o.Order_date DESC, o.Order_id DESC`;

// units sold per product in the last 30 and 90 days (completed sales only), and the last sale date
const SALES_SQL = `
  SELECT ti.Product_id AS productId,
         SUM(CASE WHEN CAST(s.Transaction_date AS DATE) > DATEADD(DAY, -30, CAST(SYSDATETIME() AS DATE))
                  THEN ti.Quantity ELSE 0 END) AS sold30,
         SUM(CASE WHEN CAST(s.Transaction_date AS DATE) > DATEADD(DAY, -90, CAST(SYSDATETIME() AS DATE))
                  THEN ti.Quantity ELSE 0 END) AS sold90,
         MAX(CAST(s.Transaction_date AS DATE)) AS lastSale
  FROM   TRANSACTION_ITEM ti
  JOIN   SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
  WHERE  ti.Marked_for_deletion = 0 AND s.Marked_for_deletion = 0 AND s.Status = 'completed'
  GROUP BY ti.Product_id`;

const STATUSES = ['Pending', 'Ordered', 'Received', 'Cancelled'];

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);

    const products = (await query(PRODUCTS_SQL)).recordset;
    const orders = (await query(ORDERS_SQL)).recordset;
    const orderList = (await query(ORDER_LIST_SQL)).recordset;
    const sales = (await query(SALES_SQL)).recordset;
    const soldBy = {};
    sales.forEach((r) => { soldBy[r.productId] = r; });

    // always return all four statuses, with 0 when there are none
    const counts = {};
    STATUSES.forEach((s) => { counts[s] = 0; });
    orders.forEach((o) => { counts[o.status] = o.orders; });

    const cents = products.reduce((sum, p) => sum + Math.round((Number(p.valueAtCost) || 0) * 100), 0);

    return {
      products: products.map((p) => {
        const s = soldBy[p.productId] || {};
        return { ...p, sold30: s.sold30 || 0, sold90: s.sold90 || 0, lastSale: s.lastSale || null };
      }),
      orders: orderList.map((o) => ({ ...o, ...orderTiming(o) })),
      ordersByStatus: STATUSES.map((s) => ({ status: s, orders: counts[s] })),
      totals: {
        valueAtCost: cents / 100,
        lowOrOut: products.filter((p) => p.level !== 'OK').length,
        openAlerts: products.filter((p) => p.alertId != null).length,
      },
    };
  },
});
