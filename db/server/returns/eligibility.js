// GET /api/returns/eligibility?order=1000123 -> what a customer can still return from one of their orders.
// Customers only; another customer's order, an open order and a missing order are all 404.
// { order: { id, date, status, total, deadline, daysLeft, canReturn, blockedReason },
//   items: [{ productId, name, purchased, returned, available, lineTotal, refunds: [refund for 1 unit, for 2 units, ...] }] }
// blockedReason: null | 'voided' | 'expired' | 'nothing_left'.
// `refunds` is worked out with the same formula as the database guard, so the screen can show the exact refund
// before the customer sends the request (see lib/returns.js).
const { HttpError, route } = require('../../lib/http');
const { customer, id } = require('../../lib/storefront');
const { eligibility } = require('../../lib/returns');
const db = require('../../lib/db');

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const orderId = id((req.query || {}).order, 'Order');
    const found = await eligibility(db.query, orderId, user.id);
    if (!found) throw new HttpError(404, 'Order not found.');
    const { sale, lines } = found;
    return {
      order: {
        id: sale.id, date: sale.date, status: sale.status, total: sale.total,
        deadline: sale.deadline, daysLeft: Math.max(0, Number(sale.daysLeft)),
        canReturn: sale.canReturn, blockedReason: sale.blockedReason,
      },
      items: lines,
    };
  },
});
