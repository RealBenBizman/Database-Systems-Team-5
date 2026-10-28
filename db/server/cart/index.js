const db = require('../../lib/db');
const { route, readBody } = require('../../lib/http');
const validate = require('../../lib/validate');
const { customer, keys, id, lockCustomer, readCart, saveCartItem, removeCartItem } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => readCart((await customer(req)).id),
  POST: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['productId', 'quantity']);
    const productId = id(body.productId, 'Product');
    const quantity = validate.integer(body.quantity, 'Quantity');
    await db.withTransaction(async (tx) => { await lockCustomer(tx, user.id); await saveCartItem(tx, user.id, productId, quantity); });
    return { status: 201, body: await readCart(user.id) };
  },
  PATCH: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['productId', 'quantity']);
    const productId = id(body.productId, 'Product');
    const quantity = validate.integer(body.quantity, 'Quantity', { min: 0 });
    await db.withTransaction(async (tx) => {
      await lockCustomer(tx, user.id);
      if (quantity === 0) await removeCartItem(tx, user.id, productId);
      else await saveCartItem(tx, user.id, productId, quantity, 'set');
    });
    return readCart(user.id);
  },
  DELETE: async (req) => {
    const user = await customer(req);
    const productId = id(req.query && req.query.productId, 'Product');
    await db.withTransaction(async (tx) => { await lockCustomer(tx, user.id); await removeCartItem(tx, user.id, productId); });
    return readCart(user.id);
  },
});
