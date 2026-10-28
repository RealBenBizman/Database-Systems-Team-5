// POST /api/manager/adjustments  body: { productId, quantityChange, reason }
// Managers only. We only insert the adjustment row; the trigger changes the stock.
const { route, HttpError, readBody } = require('../../lib/http');
const { withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');

module.exports = route({
  POST: async (req) => {
    const user = requireAuth(req, ['manager']);
    const body = readBody(req);
    const productId = validate.integer(body.productId, 'Product');
    const change = validate.integer(body.quantityChange, 'Quantity change', { min: -100000, max: 100000 });
    if (change === 0) throw new HttpError(400, 'Quantity change cannot be 0.', 'VALIDATION');
    const reason = validate.text(body.reason, 'Reason', { max: 200 });

    const stock = await withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Product_id FROM PRODUCT WHERE Product_id = @productId AND Marked_for_deletion = 0',
        { productId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Product not found.');

      await tx.query(
        `INSERT INTO INVENTORY_ADJUSTMENT (Product_id, Employee_id, Quantity_change, Reason)
         VALUES (@productId, @employeeId, @change, @reason)`,
        { productId, employeeId: user.id, change, reason });

      const after = await tx.query(
        'SELECT Stock_quantity FROM PRODUCT WHERE Product_id = @productId', { productId });
      return after.recordset[0].Stock_quantity;
    });

    return { status: 201, body: { stock } };
  },
});