// Returns (Part 3).
//
// GET /api/returns
//   customer -> their own returns, newest first:  { returns: [Return] }
//   staff (support, manager) -> the returns queue: GET /api/returns?status=requested|approved|denied|refunded|all
//     (default requested; waiting returns oldest first)  ->  { returns: [Return], counts: { requested, approved, denied, refunded } }
//   Return = { id, orderId, customerId, customerName, status, reason, refundTotal, requestedAt, refundedAt, handledBy,
//              items: [{ productId, name, quantity, refundAmount }] }
//
// POST /api/returns   (customers)   body { orderId, reason, items: [{ productId, quantity }] }  ->  201 { returnId }
//   The refund amounts are worked out here from the stored order (never from the browser) with the same formula
//   as TR_PRODUCT_RETURN_ITEM_Guard: round((L + T * L / S) * q / n, 2). The guard in the database has the last word:
//   completed sale, within 30 days, not more than was bought, still requested.
const db = require('../../lib/db');
const { HttpError, readBody, route } = require('../../lib/http');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const { customer, id, keys, lockCustomer } = require('../../lib/storefront');
const { RETURN_STATUSES, eligibility, loadReturns, refundFor } = require('../../lib/returns');

const MAX_LINES = 50;

function parseItems(value) {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, 'Choose at least one item to return.', 'VALIDATION');
  if (value.length > MAX_LINES) throw new HttpError(400, `A return can have at most ${MAX_LINES} items.`, 'VALIDATION');
  const wanted = new Map();
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'Each item must have a productId and a quantity.', 'VALIDATION');
    keys(item, ['productId', 'quantity']);
    const productId = id(item.productId, 'Product');
    const quantity = validate.integer(item.quantity, 'Quantity', { min: 1, max: 1000 });
    if (wanted.has(productId)) throw new HttpError(400, 'Each product can be listed only once.', 'VALIDATION');
    wanted.set(productId, quantity);
  }
  return wanted;
}

async function queue(status) {
  if (status !== undefined && status !== 'all' && !RETURN_STATUSES.includes(status)) {
    throw new HttpError(400, `Status must be one of: ${[...RETURN_STATUSES, 'all'].join(', ')}.`, 'VALIDATION');
  }
  const wanted = status || 'requested';
  const oldestFirst = wanted === 'requested';
  const returns = await loadReturns(
    wanted === 'all' ? '1 = 1' : 'r.Status = @status',
    wanted === 'all' ? {} : { status: wanted },
    oldestFirst ? 'r.Requested_at ASC, r.Return_id ASC' : 'r.Requested_at DESC, r.Return_id DESC',
  );
  const countResult = await db.query(`SELECT r.Status AS status, COUNT(*) AS count
    FROM PRODUCT_RETURN r
    JOIN SALES_TRANSACTION s ON s.Transaction_id = r.Transaction_id AND s.Marked_for_deletion = 0
    JOIN CUSTOMER c ON c.Customer_id = s.Customer_id AND c.Marked_for_deletion = 0
    WHERE r.Marked_for_deletion = 0
    GROUP BY r.Status`);
  const counts = { requested: 0, approved: 0, denied: 0, refunded: 0 };
  for (const row of countResult.recordset) counts[row.status] = Number(row.count);
  return { returns, counts };
}

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req);
    if (user.role === 'customer') {
      await customer(req);
      return { returns: await loadReturns('s.Customer_id = @customerId', { customerId: user.id }) };
    }
    return queue((req.query || {}).status);
  },

  POST: async (req) => {
    const user = await customer(req);
    const body = readBody(req);
    keys(body, ['orderId', 'reason', 'items']);
    const orderId = id(body.orderId, 'Order');
    const reason = validate.text(body.reason, 'Reason', { max: 200 });
    const wanted = parseItems(body.items);

    const returnId = await db.withTransaction(async (tx) => {
      // one return request at a time per customer, so a double click cannot count the same units twice
      await lockCustomer(tx, user.id);

      const found = await eligibility(tx.query, orderId, user.id);
      if (!found) throw new HttpError(404, 'Order not found.');
      const { sale, lines } = found;
      if (sale.blockedReason === 'voided') throw new HttpError(409, 'Only completed orders can be returned.', 'NOT_RETURNABLE');
      if (sale.blockedReason === 'expired') throw new HttpError(409, `The 30-day return window for this order ended on ${sale.deadline}.`, 'WINDOW_CLOSED');

      const byProduct = new Map(lines.map((line) => [line.productId, line]));
      const rows = [];
      for (const [productId, quantity] of wanted) {
        const line = byProduct.get(productId);
        if (!line) throw new HttpError(400, 'One of the items is not part of this order.', 'VALIDATION');
        if (line.available === 0) throw new HttpError(409, `${line.name} has already been returned.`, 'NOTHING_LEFT');
        if (quantity > line.available) {
          throw new HttpError(409, `Only ${line.available} of ${line.name} can still be returned (you bought ${line.purchased}${line.returned ? `, ${line.returned} already on other returns` : ''}).`, 'TOO_MANY');
        }
        rows.push({ productId, quantity, refund: refundFor({ lineTotal: line.lineTotal, subtotal: sale.subtotal, tax: sale.tax, purchased: line.purchased, quantity }) });
      }
      const total = rows.reduce((sum, row) => sum + Math.round(row.refund * 100), 0) / 100;

      const created = await tx.query(`INSERT INTO PRODUCT_RETURN (Transaction_id, Reason, Refund_total)
        OUTPUT inserted.Return_id AS id VALUES (@orderId, @reason, @total)`,
      { orderId, reason, total: { type: db.sql.Decimal(10, 2), value: total } });
      const newId = created.recordset[0].id;

      for (const row of rows) {
        await tx.query(`INSERT INTO PRODUCT_RETURN_ITEM (Return_id, Product_id, Quantity, Refund_amount)
          VALUES (@returnId, @productId, @quantity, @refund)`,
        { returnId: newId, productId: row.productId, quantity: row.quantity, refund: { type: db.sql.Decimal(10, 2), value: row.refund } });
      }
      return newId;
    });

    return { status: 201, body: { returnId } };
  },
});
