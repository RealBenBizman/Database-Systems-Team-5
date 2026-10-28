const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const inventory = require('../server/reports/inventory');

afterAll(async () => { await (await db.getPool()).close(); });

test('manager gets the inventory report', async () => {
  const res = await call(inventory, { role: 'manager' });
  expect(res.statusCode).toBe(200);
  expect(res.body.products.length).toBeGreaterThan(0);
  expect(res.body.ordersByStatus.map((o) => o.status)).toEqual(['Pending', 'Ordered', 'Received', 'Cancelled']);
  res.body.products.forEach((p) => {
    expect(['OK', 'Low', 'Out of stock']).toContain(p.level);
  });
});

test('totals add up', async () => {
  const res = await call(inventory, { role: 'manager' });
  const cents = res.body.products.reduce((s, p) => s + Math.round(Number(p.valueAtCost) * 100), 0);
  expect(res.body.totals.valueAtCost).toBe(cents / 100);
  expect(res.body.totals.lowOrOut).toBe(res.body.products.filter((p) => p.level !== 'OK').length);
});

test('support can read it too', async () => {
  const res = await call(inventory, { role: 'support' });
  expect(res.statusCode).toBe(200);
});

test('no login is refused (401)', async () => {
  const res = await call(inventory, {});
  expect(res.statusCode).toBe(401);
});