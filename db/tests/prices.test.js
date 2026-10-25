const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const prices = require('../api/manager/prices');

let managerId, productId, startPrice;

beforeAll(async () => {
  const m = await db.query("SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager'");
  managerId = m.recordset[0].Employee_id;
  const p = await db.query('SELECT TOP 1 Product_id, Sell_price FROM PRODUCT WHERE Marked_for_deletion = 0 ORDER BY Product_id');
  productId = p.recordset[0].Product_id;
  startPrice = Number(p.recordset[0].Sell_price);
});

afterAll(async () => { await (await db.getPool()).close(); });

// NOTE: this leaves two PRICE_CHANGE rows behind (price up, then back down).
test('manager changes the price and changes it back', async () => {
  const up = await call(prices, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, newPrice: startPrice + 1 } });
  expect(up.statusCode).toBe(200);
  expect(up.body.newPrice).toBe(startPrice + 1);

  const back = await call(prices, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, newPrice: startPrice } });
  expect(back.statusCode).toBe(200);
  expect(back.body.newPrice).toBe(startPrice);
});

test('negative price is refused (400)', async () => {
  const res = await call(prices, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, newPrice: -5 } });
  expect(res.statusCode).toBe(400);
});

test('support cannot change prices (403)', async () => {
  const res = await call(prices, { method: 'POST', role: 'support', id: managerId,
    body: { productId, newPrice: 5 } });
  expect(res.statusCode).toBe(403);
});

test('no login is refused (401)', async () => {
  const res = await call(prices, { method: 'POST', body: { productId, newPrice: 5 } });
  expect(res.statusCode).toBe(401);
});