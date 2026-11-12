// GET /api/manager/alerts -> open low-stock alerts, oldest first
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

const SQL = `
  SELECT a.Alert_id AS alertId, a.Product_id AS productId, p.Name AS name,
         p.Stock_quantity AS stock, p.Reorder_threshold AS threshold,
         a.Triggered_at AS triggeredAt, a.Order_id AS orderId
  FROM   LOW_STOCK_ALERT a
  JOIN   PRODUCT p ON p.Product_id = a.Product_id
  WHERE  a.Resolved_at IS NULL AND a.Marked_for_deletion = 0
  ORDER BY a.Triggered_at`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['support', 'manager']);
    const result = await query(SQL);
    return { alerts: result.recordset };
  },
});