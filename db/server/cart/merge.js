const db = require('../../lib/db');
const { route, readBody, HttpError } = require('../../lib/http');
const { customer, keys, cartItems, lockCustomer, saveCartItem, readCart } = require('../../lib/storefront');

module.exports = route({
  POST: async (req) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['items']);
    const items = cartItems(body.items);
    const rejected = [];
    await db.withTransaction(async (tx) => {
      await lockCustomer(tx, user.id);
      for (const item of items) {
        try { await saveCartItem(tx, user.id, item.productId, item.quantity, 'merge'); }
        catch (err) {
          if (!(err instanceof HttpError) || err.status !== 409) throw err;
          rejected.push({ ...item, reason: err.message });
        }
      }
    });
    return { ...await readCart(user.id), rejected };
  },
});
