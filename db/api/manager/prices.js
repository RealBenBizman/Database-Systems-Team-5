// POST /api/manager/prices  body: { productId, newPrice }   (managers only)
// One transaction: read the old price, write a PRICE_CHANGE row, update the price.
const { route, HttpError, readBody } = require('../../lib/http');
const { withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');

module.exports = route({
  POST: async (req) => {
    const user = requireAuth(req, ['manager']);
    const body = readBody(req);
    const productId = validate.integer(body.productId, 'Product');
    const newPrice = Math.round(Number(body.newPrice) * 100) / 100;
    if (body.newPrice === '' || body.newPrice == null || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > 99999999) {
      throw new HttpError(400, 'Price must be a number, 0 or more.', 'VALIDATION');
    }

    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Sell_price FROM PRODUCT WHERE Product_id = @productId AND Marked_for_deletion = 0',
        { productId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Product not found.');
      const oldPrice = found.recordset[0].Sell_price;

      await tx.query(
        `INSERT INTO PRICE_CHANGE (Product_id, Employee_id, Old_price, New_price)
         VALUES (@productId, @employeeId, @oldPrice, @newPrice)`,
        { productId, employeeId: user.id, oldPrice, newPrice });
      await tx.query(
        'UPDATE PRODUCT SET Sell_price = @newPrice WHERE Product_id = @productId',
        { productId, newPrice });

      return { oldPrice, newPrice };
    });
  },
});