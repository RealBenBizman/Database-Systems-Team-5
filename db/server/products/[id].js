const { query } = require('../../lib/db');
const { route, HttpError } = require('../../lib/http');
const { id, productSelect, PRODUCT_JOINS, PUBLIC_PRODUCT } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const result = await query(`${productSelect()} FROM PRODUCT p ${PRODUCT_JOINS()}
      WHERE ${PUBLIC_PRODUCT} AND p.Product_id = @productId`, { productId: id(req.query && req.query.id, 'Product') });
    if (!result.recordset.length) throw new HttpError(404, 'This product is no longer available.');
    return { product: result.recordset[0] };
  },
});
