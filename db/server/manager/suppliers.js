// GET /api/manager/suppliers -> { suppliers, links } for the order form
//   links = which supplier sells which product (supplierId, productId, unitCost, leadTimeDays), so the form
//   can offer only the suppliers that sell the product being ordered
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(`
      SELECT Supplier_id AS supplierId, Supplier_name AS name
      FROM   SUPPLIER
      WHERE  Marked_for_deletion = 0
      ORDER BY Supplier_name`);
    const links = await query(`
      SELECT sp.Supplier_id AS supplierId, sp.Product_id AS productId,
             sp.Unit_cost AS unitCost, sp.Lead_time_days AS leadTimeDays
      FROM   SUPPLIER_PRODUCT sp
      JOIN   SUPPLIER s ON s.Supplier_id = sp.Supplier_id AND s.Marked_for_deletion = 0
      JOIN   PRODUCT p  ON p.Product_id  = sp.Product_id  AND p.Marked_for_deletion = 0
      WHERE  sp.Marked_for_deletion = 0`);
    return { suppliers: result.recordset, links: links.recordset };
  },
});