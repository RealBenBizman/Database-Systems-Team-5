// GET  /api/manager/supplier-orders -> list of orders with totals
// POST /api/manager/supplier-orders  body: { alertId, supplierId, quantity }  (managers only)
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');

const LIST_SQL = `
  SELECT o.Order_id AS orderId, s.Supplier_name AS supplier, o.Order_date AS orderDate,
         o.Received_date AS receivedDate, o.Status AS status,
         COUNT(i.Product_id) AS itemCount,
         ISNULL(SUM(i.Quantity * i.Unit_cost), 0) AS totalCost
  FROM   SUPPLIER_ORDER o
  JOIN   SUPPLIER s ON s.Supplier_id = o.Supplier_id
  LEFT JOIN SUPPLIER_ORDER_ITEM i ON i.Order_id = o.Order_id AND i.Marked_for_deletion = 0
  WHERE  o.Marked_for_deletion = 0
  GROUP BY o.Order_id, s.Supplier_name, o.Order_date, o.Received_date, o.Status
  ORDER BY o.Order_id DESC`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['support', 'manager']);
    const result = await query(LIST_SQL);
    return { orders: result.recordset };
  },

  POST: async (req) => {
    const user = requireAuth(req, ['manager']);
    const body = readBody(req);
    const alertId = validate.integer(body.alertId, 'Alert');
    const supplierId = validate.integer(body.supplierId, 'Supplier');
    const quantity = validate.integer(body.quantity, 'Quantity', { max: 100000 });

    return withTransaction(async (tx) => {
      const alert = await tx.query(
        `SELECT a.Product_id AS productId, p.Cost_price AS unitCost
         FROM   LOW_STOCK_ALERT a
         JOIN   PRODUCT p ON p.Product_id = a.Product_id
         WHERE  a.Alert_id = @alertId AND a.Resolved_at IS NULL
                AND a.Order_id IS NULL AND a.Marked_for_deletion = 0`,
        { alertId });
      if (alert.recordset.length === 0) {
        throw new HttpError(409, 'Alert not found, already resolved, or already has an order.', 'RULE_VIOLATION');
      }
      const supplier = await tx.query(
        'SELECT Supplier_id FROM SUPPLIER WHERE Supplier_id = @supplierId AND Marked_for_deletion = 0',
        { supplierId });
      if (supplier.recordset.length === 0) throw new HttpError(404, 'Supplier not found.');

      const { productId, unitCost } = alert.recordset[0];

      const made = await tx.query(
        `INSERT INTO SUPPLIER_ORDER (Supplier_id, Employee_id, Order_date, Status)
         VALUES (@supplierId, @employeeId, CAST(SYSDATETIME() AS DATE), 'Pending');
         SELECT SCOPE_IDENTITY() AS orderId;`,
        { supplierId, employeeId: user.id });
      const orderId = made.recordset[0].orderId;

      await tx.query(
        `INSERT INTO SUPPLIER_ORDER_ITEM (Order_id, Product_id, Quantity, Unit_cost)
         VALUES (@orderId, @productId, @quantity, @unitCost)`,
        { orderId, productId, quantity, unitCost });
      await tx.query(
        'UPDATE LOW_STOCK_ALERT SET Order_id = @orderId WHERE Alert_id = @alertId',
        { orderId, alertId });

      return { status: 201, body: { orderId } };
    });
  },
});