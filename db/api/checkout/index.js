// POST /api/checkout  body: { method: 'credit' | 'debit', cardLast4: '4242' }
// Customers only. sp_Checkout computes prices, tax and totals in the database.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, sql } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({
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