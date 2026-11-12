const { query } = require('../../lib/db');
const { route } = require('../../lib/http');
const { id, customer } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const productId = id(req.query && req.query.productId, 'Product');
    const result = await query(`SELECT s.Transaction_id AS id, s.Transaction_date AS date FROM SALES_TRANSACTION s
      WHERE s.Customer_id = @customerId AND s.Status = 'completed' AND s.Marked_for_deletion = 0
        AND EXISTS (SELECT 1 FROM TRANSACTION_ITEM ti WHERE ti.Transaction_id = s.Transaction_id
          AND ti.Product_id = @productId AND ti.Marked_for_deletion = 0)
      ORDER BY s.Transaction_date DESC, s.Transaction_id DESC`, { customerId: user.id, productId });
    return { purchases: result.recordset };
  },
});
