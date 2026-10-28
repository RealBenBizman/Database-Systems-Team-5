// GET  /api/checkout -> the signed-in customer's cart and default address (for the checkout page)
// POST /api/checkout  body: { method: 'credit' | 'debit', cardLast4: '4242' } -> places the order
// Customers only. sp_Checkout computes prices, tax and totals in the database.
//
// Written by Terry (Part 2). Two small changes were added by the lead's team:
//   - GET reads the cart with readCart() (lib/storefront.js), the same function the cart
//     page uses, so the checkout page shows the same discounted prices as the cart.
//   - POST turns SQL error 547 (the stock changed while paying) into a readable message.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, sql } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { readCart } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req, ['customer']);
    const cart = await readCart(user.id);
    const addr = await query(
      `SELECT Recipient_name, Street, Apt, City, State, Zip
       FROM CUSTOMER_ADDRESS
       WHERE Customer_id = @cid AND is_default = 1 AND Marked_for_deletion = 0`, { cid: user.id });
    const address = addr.recordset[0] || null;
    // canCheckout is false when the cart is empty, there is no address, or an item is
    // inactive or has less stock than the cart asks for (the page disables the button).
    const canCheckout = cart.items.length > 0 && address !== null && cart.items.every((i) => i.available);
    return { items: cart.items, subtotal: cart.subtotal, address, canCheckout };
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

    let r;
    try {
      r = await query(
        'EXEC sp_Checkout @Customer_id = @cid, @Method = @method, @Card_last4 = @last4',
        { cid: { type: sql.Int, value: user.id }, method, last4: cardLast4 }
      );
    } catch (err) {
      const number = err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
      if (number === 547) {
        throw new HttpError(409, 'An item in your cart changed while you were checking out. Please review your cart and try again.', 'CHANGED');
      }
      throw err;
    }
    return { status: 201, body: { transactionId: r.recordset[0].Transaction_id } };
  },
});
