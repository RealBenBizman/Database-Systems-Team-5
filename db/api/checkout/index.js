// GET  /api/checkout -> the signed-in customer's cart and default address (for the checkout page)
// POST /api/checkout  body: { method: 'credit' | 'debit', cardLast4: '4242' } -> places the order
// Customers only. sp_Checkout computes prices, tax and totals in the database.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, sql } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req, ['customer']);
    const cart = await query(
      `SELECT Product_id, Product_name, Sell_price, Quantity, Line_total
       FROM VW_CART WHERE Customer_id = @cid ORDER BY Added_at`, { cid: user.id });
    const addr = await query(
      `SELECT Recipient_name, Street, Apt, City, State, Zip
       FROM CUSTOMER_ADDRESS
       WHERE Customer_id = @cid AND is_default = 1 AND Marked_for_deletion = 0`, { cid: user.id });
    return { items: cart.recordset, address: addr.recordset[0] || null };
  },

  POST: async (req) => {
    const user = requireAuth(req, ['customer']);
    const body = readBody(req);

    const method = String(body.method || '').toLowerCase();
    if (!['credit', 'debit'].includes(method)) {
      throw new HttpError(400, 'Payment method must be credit or debit.', 'BAD_METHOD');
    }
    const cardLast4 = String(body.cardLast4 || '');
    if (!/^\d{4}$/.test(cardLast4)) {
      throw new HttpError(400, 'Enter the last 4 digits of the card.', 'BAD_CARD');
    }

    const r = await query(
      'EXEC sp_Checkout @Customer_id = @cid, @Method = @method, @Card_last4 = @last4',
      { cid: { type: sql.Int, value: user.id }, method, last4: cardLast4 }
    );
    return { status: 201, body: { transactionId: r.recordset[0].Transaction_id } };
  },
});