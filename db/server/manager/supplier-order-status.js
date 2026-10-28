// POST /api/manager/supplier-order-status  body: { orderId, status }  (managers only)
// Allowed: Pending -> Ordered, Ordered -> Received, Pending/Ordered -> Cancelled.
// When it becomes Received, the database trigger adds the stock and closes the alert
// if the stock is back above the threshold. If it is still at or below it, the alert
// stays open and we unlink the finished order so a new order can be placed for it.
const { route, HttpError, readBody } = require('../../lib/http');
const { withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');

const NEXT = {
  Pending: ['Ordered', 'Cancelled'],
  Ordered: ['Received', 'Cancelled'],
};

module.exports = route({
  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const orderId = validate.integer(body.orderId, 'Order');
    const status = validate.text(body.status, 'Status', { max: 20 });

    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Status FROM SUPPLIER_ORDER WHERE Order_id = @orderId AND Marked_for_deletion = 0',
        { orderId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Order not found.');
      const current = found.recordset[0].Status;

      if (!(NEXT[current] || []).includes(status)) {
        throw new HttpError(409, `An order that is ${current} cannot be changed to ${status}.`, 'RULE_VIOLATION');
      }

      // only change it if it is still in the status we just read
      const changed = await tx.query(
        'UPDATE SUPPLIER_ORDER SET Status = @status WHERE Order_id = @orderId AND Status = @current',
        { orderId, status, current });
      if (changed.rowsAffected[0] === 0) {
        throw new HttpError(409, 'Order was changed by someone else. Reload and try again.', 'RULE_VIOLATION');
      }

      // a cancelled or received order frees its alert if the alert is still open
      // (a received order that was too small leaves it open), so it can be ordered again
      if (status === 'Cancelled' || status === 'Received') {
        await tx.query(
          'UPDATE LOW_STOCK_ALERT SET Order_id = NULL WHERE Order_id = @orderId AND Resolved_at IS NULL',
          { orderId });
      }

      const after = await tx.query(
        'SELECT Status, Received_date FROM SUPPLIER_ORDER WHERE Order_id = @orderId', { orderId });
      return { status: after.recordset[0].Status, receivedDate: after.recordset[0].Received_date };
    });
  },
});