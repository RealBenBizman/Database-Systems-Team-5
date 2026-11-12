// GET /api/manager/dashboard -> counts for the employee dashboard
// Support sees open alerts and returns waiting; managers also see pending supplier orders.
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

const SQL = `
  SELECT
    (SELECT COUNT(*) FROM LOW_STOCK_ALERT
     WHERE Resolved_at IS NULL AND Marked_for_deletion = 0)            AS openAlerts,
    (SELECT COUNT(*) FROM SUPPLIER_ORDER
     WHERE Status = 'Pending' AND Marked_for_deletion = 0)             AS pendingOrders,
    (SELECT COUNT(*) FROM PRODUCT_RETURN
     WHERE Status = 'requested' AND Marked_for_deletion = 0)           AS returnsWaiting`;

module.exports = route({
  GET: async (req) => {
    const user = requireAuth(req, ['support', 'manager']);
    const counts = (await query(SQL)).recordset[0];
    // supplier orders are manager business: support sees alerts and returns only
    if (user.role !== 'manager') counts.pendingOrders = null;
    return counts;
  },
});