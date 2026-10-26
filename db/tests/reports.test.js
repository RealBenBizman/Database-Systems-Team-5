const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const inventory = require('../api/reports/inventory');

afterAll(async () => { await (await db.getPool()).close(); });

test('manager gets the inventory report', async () => {
  const res = await call(inventory, { role: 'manager' });
  expect(res.statusCode).toBe(200);
  expect(res.body.products.length).toBeGreaterThan(0);
  expect(Array.isArray(res.body.ordersByStatus)).toBe(true);
  const first = res.body.products[0];
  expect(['Low', 'OK']).toContain(first.level);
});

test('support can read it too', async () => {
 const res = await call(inventory, { role: 'support' });
 expect(res.statusCode).toBe(200);
 });

test('no login is refused (401)', async () => {
  const res = await call(inventory, {});
  expect(res.statusCode).toBe(401);
});