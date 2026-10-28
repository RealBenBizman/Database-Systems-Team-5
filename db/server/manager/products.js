// GET /api/manager/products -> inventory list (stock against reorder threshold)
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

const SQL = `
  SELECT Product_id AS productId, SKU AS sku, Name AS name, Sell_price AS sellPrice,
         Stock_quantity AS stock, Reorder_threshold AS threshold, Is_active AS isActive
  FROM   PRODUCT
  WHERE  Marked_for_deletion = 0
  ORDER BY Name`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['support', 'manager']);
    const result = await query(SQL);
    return { products: result.recordset };
  },
});