// GET /api/orders -> the signed-in customer's finished orders, newest first
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req, ['customer']);
    const r = await query(
      `SELECT s.Transaction_id, s.Transaction_date, s.Status, s.Total,
              (SELECT SUM(ti.Quantity) FROM TRANSACTION_ITEM ti
               WHERE ti.Transaction_id = s.Transaction_id AND ti.Marked_for_deletion = 0) AS Items
       FROM SALES_TRANSACTION s
       WHERE s.Customer_id = @cid AND s.Status <> 'open' AND s.Marked_for_deletion = 0
       ORDER BY s.Transaction_date DESC`,
      { cid: user.id }
    );
    return { orders: r.recordset };
  },
});