// GET /api/orders/123 -> one order with its items and payments (own orders only)
// Written by Terry (Part 2). Added by the team: the order number must be exactly 7 digits,
// and each item also returns its Product_id (used as the row key on the page).
const { route, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req, ['customer']);
    const raw = String((req.query && req.query.id) || '');
    if (!/^\d{7}$/.test(raw)) throw new HttpError(400, 'Invalid order number.');
    const id = Number(raw);
    const p = { id, cid: user.id };

    const head = await query(
      `SELECT Transaction_id, Transaction_date, Status, Subtotal, Tax_amount, Total,
              Ship_name, Ship_street, Ship_apt, Ship_city, Ship_state, Ship_zip,
              Tracking_number, Estimated_arrival
       FROM SALES_TRANSACTION
       WHERE Transaction_id = @id AND Customer_id = @cid AND Marked_for_deletion = 0`, p);
    const order = head.recordset[0];
    if (!order) throw new HttpError(404, 'Order not found.');

    const items = await query(
      `SELECT ti.Product_id, p.Name, ti.Quantity, ti.Unit_price, ti.Discount_amount, ti.Line_total
       FROM TRANSACTION_ITEM ti
       JOIN PRODUCT p ON p.Product_id = ti.Product_id
       WHERE ti.Transaction_id = @id AND ti.Marked_for_deletion = 0`, p);

    const payments = await query(
      `SELECT Method, Amount, Card_last4, Paid_at
       FROM PAYMENT
       WHERE Transaction_id = @id AND Marked_for_deletion = 0`, p);

    return { order, items: items.recordset, payments: payments.recordset };
  },
});
