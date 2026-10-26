const db = require('../../lib/db');
const { route, readBody } = require('../../lib/http');
const { keys, cartItems, cartResult, productSelect, PRODUCT_JOINS } = require('../../lib/storefront');

module.exports = route({
  POST: async (req) => {
    const body = readBody(req); keys(body, ['items']);
    const items = cartItems(body.items);
    if (!items.length) return { items: [], subtotal: 0, itemCount: 0, missing: [] };
    const result = await db.query(`WITH items AS (
      ${productSelect('g.Quantity')}
      FROM OPENJSON(@items) WITH (Product_id INT '$.productId', Quantity INT '$.quantity') g
      JOIN PRODUCT p ON p.Product_id = g.Product_id ${PRODUCT_JOINS('g.Quantity')}
      WHERE p.Marked_for_deletion = 0
    ) SELECT *, SUM(lineTotal) OVER () AS cartSubtotal, SUM(CAST(quantity AS BIGINT)) OVER () AS cartQuantity FROM items ORDER BY name, id`,
    { items: { type: db.sql.NVarChar(db.sql.MAX), value: JSON.stringify(items) } });
    return { ...cartResult(result.recordset), missing: items.filter((item) => !result.recordset.some((row) => row.id === item.productId)) };
  },
});
