// GET /api/manager/orders/<id> -> one order: ship-to, tracking, items, payments, customer, employee, points
// Managers only, read only. Payments show the method, amount and last 4 digits only.
const { route, HttpError } = require('../../../lib/http');
const { query } = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');
const validate = require('../../../lib/validate');

const ORDER_SQL = `
  SELECT s.Transaction_id AS orderId, s.Status AS status,
         CONVERT(VARCHAR(16), s.Transaction_date, 120) AS orderDate,
         s.Subtotal AS subtotal, s.Tax_amount AS tax, s.Total AS total,
         s.Ship_name AS shipName, s.Ship_street AS shipStreet, s.Ship_apt AS shipApt,
         s.Ship_city AS shipCity, s.Ship_state AS shipState, s.Ship_zip AS shipZip,
         s.Tracking_number AS trackingNumber,
         CONVERT(VARCHAR(10), s.Estimated_arrival, 23) AS estimatedArrival,
         c.Customer_id AS customerId, CONCAT(c.First_name, N' ', c.Last_name) AS customerName, c.Email AS email,
         CONCAT(e.FirstName, N' ', e.LastName) AS employeeName
  FROM   SALES_TRANSACTION s
  JOIN   CUSTOMER c ON c.Customer_id = s.Customer_id AND c.Marked_for_deletion = 0
  LEFT JOIN EMPLOYEE e ON e.Employee_id = s.Employee_id AND e.Marked_for_deletion = 0
  WHERE  s.Transaction_id = @id AND s.Marked_for_deletion = 0`;

// The product and discount joins are NOT filtered by Marked_for_deletion on purpose: a product that was
// removed later must not erase the lines of an old order.
const ITEMS_SQL = `
  SELECT i.Product_id AS productId, p.SKU AS sku, p.Name AS name, i.Quantity AS quantity,
         i.Unit_price AS unitPrice, d.Discount_name AS discountName, i.Discount_amount AS discountAmount,
         i.Line_total AS lineTotal
  FROM   TRANSACTION_ITEM i
  JOIN   PRODUCT p ON p.Product_id = i.Product_id
  LEFT JOIN DISCOUNT d ON d.Discount_id = i.Discount_id
  WHERE  i.Transaction_id = @id AND i.Marked_for_deletion = 0
  ORDER BY p.Name`;

const PAYMENTS_SQL = `
  SELECT Payment_id AS paymentId, Method AS method, Amount AS amount, Card_last4 AS cardLast4,
         CONVERT(VARCHAR(16), Paid_at, 120) AS paidAt
  FROM   PAYMENT
  WHERE  Transaction_id = @id AND Marked_for_deletion = 0
  ORDER BY Paid_at, Payment_id`;

const POINTS_SQL = `
  SELECT ISNULL(SUM(CASE WHEN Points_change > 0 THEN Points_change ELSE 0 END), 0) AS pointsEarned,
         ISNULL(SUM(CASE WHEN Points_change < 0 THEN -Points_change ELSE 0 END), 0) AS pointsTakenBack
  FROM   LOYALTY_TRANSACTION
  WHERE  Transaction_id = @id AND Marked_for_deletion = 0`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const id = validate.integer(req.query && req.query.id, 'Order', { min: 1000000, max: 9999999 });

    const order = await query(ORDER_SQL, { id });
    if (order.recordset.length === 0) throw new HttpError(404, 'Order not found.');

    const [items, payments, points] = await Promise.all([
      query(ITEMS_SQL, { id }),
      query(PAYMENTS_SQL, { id }),
      query(POINTS_SQL, { id }),
    ]);
    return {
      order: order.recordset[0],
      items: items.recordset,
      payments: payments.recordset,
      points: points.recordset[0],
    };
  },
});
