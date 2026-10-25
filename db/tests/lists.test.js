const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const alerts = require('../api/manager/alerts');
const products = require('../api/manager/products');

afterAll(async () => { await (await db.getPool()).close(); });

test('manager sees the alerts list', async () => {
  const res = await call(alerts, { role: 'manager' });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.body.alerts)).toBe(true);
});

test('alerts needs a login', async () => {
  const res = await call(alerts, {});
  expect(res.statusCode).toBe(401);
});

test('support sees the inventory list', async () => {
  const res = await call(products, { role: 'support' });
  expect(res.statusCode).toBe(200);
  expect(res.body.products.length).toBeGreaterThan(0);
});

test('inventory list needs a login', async () => {
  const res = await call(products, {});
  expect(res.statusCode).toBe(401);
});