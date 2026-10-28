// GET /api/manager/suppliers -> supplier list for the order form
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['support', 'manager']);
    const result = await query(`
      SELECT Supplier_id AS supplierId, Supplier_name AS name
      FROM   SUPPLIER
      WHERE  Marked_for_deletion = 0
      ORDER BY Supplier_name`);
    return { suppliers: result.recordset };
  },
});