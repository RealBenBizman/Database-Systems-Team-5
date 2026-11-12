// GET /api/manager/orders?q=text -> find orders by 7-digit order id, tracking number, customer name or email
// Managers only, read only. Without q it lists the 50 newest. The customer's own orders stay in api/orders/.
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const f = require('../../lib/fields');

const SQL = `
  SELECT TOP (50)
         s.Transaction_id AS orderId, s.Status AS status, s.Total AS total,
         s.Tracking_number AS trackingNumber,
         CONVERT(VARCHAR(16), s.Transaction_date, 120) AS orderDate,
         c.Customer_id AS customerId, CONCAT(c.First_name, N' ', c.Last_name) AS customerName,
         c.Email AS email
  FROM   SALES_TRANSACTION s
  JOIN   CUSTOMER c ON c.Customer_id = s.Customer_id AND c.Marked_for_deletion = 0
  WHERE  s.Marked_for_deletion = 0
    AND  (@like IS NULL
          OR s.Tracking_number LIKE @like OR c.Email LIKE @like
          OR CONCAT(c.First_name, N' ', c.Last_name) LIKE @like
          OR s.Transaction_id = @id)
  ORDER BY s.Transaction_date DESC, s.Transaction_id DESC`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const q = req.query && req.query.q;
    const result = await query(SQL, { like: f.likePattern(q), id: f.idFromSearch(q) });
    return { orders: result.recordset };
  },
});
