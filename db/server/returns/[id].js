// One return (Part 3).
//
// GET   /api/returns/1000123   -> { return: Return }  the customer's own return, or any return for staff.
// (a customer asking for someone else's return gets 404, the same as a missing one)
// PATCH /api/returns/1000123   body { action: 'approve' | 'deny' | 'refund' }   support and managers only
// approve   requested -> approved   saves the handler's Employee_id (from the login, never from the body)
// deny      requested -> denied     saves the handler's Employee_id
// refund    approved  -> refunded   sets Refunded_at; the database trigger TR_PRODUCT_RETURN_Refunded then puts
// the items back in stock and takes the points back. The app does neither. -> { return: Return }
//
// Each change is one UPDATE that also checks the current status in its WHERE, so two staff members clicking at the
// same time cannot both win: the second one gets 409 "already handled".
const db = require('../../lib/db');
const { HttpError, readBody, route } = require('../../lib/http');
const { requireAuth } = require('../../lib/auth');
const { id, keys } = require('../../lib/storefront');
const { loadReturns, sqlNumber } = require('../../lib/returns');

const STAFF = ['support', 'manager'];

const ACTIONS = {
  approve: { from: 'requested', set: "Status = 'approved', Employee_id = @employeeId" },
  deny: { from: 'requested', set: "Status = 'denied', Employee_id = @employeeId" },
  refund: { from: 'approved', set: "Status = 'refunded', Refunded_at = SYSDATETIME()" },
};

// The refund trigger takes points back. If the customer no longer has them, the balance would go below zero:
// CK_CUSTOMER_Points (error 547) or the trigger's own check (error 50001) stops it and the whole refund rolls back.
function readable(err) {
  const number = sqlNumber(err);
  if (number === 50001 || (number === 547 && /CK_CUSTOMER_Points/.test(String(err.message)))) {
    return new HttpError(409, 'This refund cannot be completed: the customer no longer has enough loyalty points to take back. Nothing was changed.', 'POINTS_SPENT');
  }
  return err;
}

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req);
    const returnId = id((req.query || {}).id, 'Return');
    const own = user.role === 'customer';
    const rows = await loadReturns(
      own ? 'r.Return_id = @returnId AND s.Customer_id = @customerId' : 'r.Return_id = @returnId',
      own ? { returnId, customerId: user.id } : { returnId },
    );
    if (!rows.length) throw new HttpError(404, 'Return not found.');
    return { return: rows[0] };
  },

  PATCH: async (req) => {
    const user = requireAuth(req, STAFF);
    const returnId = id((req.query || {}).id, 'Return');
    const body = readBody(req);
    keys(body, ['action']);
    const action = ACTIONS[body.action];
    if (!action || typeof body.action !== 'string') throw new HttpError(400, 'Action must be one of: approve, deny, refund.', 'VALIDATION');

    let result;
    try {
      result = await db.query(`UPDATE PRODUCT_RETURN SET ${action.set}
        WHERE Return_id = @returnId AND Status = @from AND Marked_for_deletion = 0`,
      { returnId, from: action.from, employeeId: user.id });
    } catch (err) {
      throw readable(err);
    }

    if (!result.rowsAffected || result.rowsAffected[0] === 0) {
      const current = await db.query('SELECT Status AS status FROM PRODUCT_RETURN WHERE Return_id = @returnId AND Marked_for_deletion = 0', { returnId });
      if (!current.recordset.length) throw new HttpError(404, 'Return not found.');
      throw new HttpError(409, `This return cannot be ${body.action === 'refund' ? 'refunded' : body.action === 'approve' ? 'approved' : 'denied'}: it is already ${current.recordset[0].status}.`, 'ALREADY_HANDLED');
    }

    const rows = await loadReturns('r.Return_id = @returnId', { returnId });
    return { return: rows[0] };
  },
});
