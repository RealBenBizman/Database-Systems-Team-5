const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const dashboard = require('../api/manager/dashboard');

afterAll(async () => {
  const pool = await db.getPool();
  await pool.close();
});

test('manager sees the three counts', async () => {
  const res = await call(dashboard, { role: 'manager' });
  expect(res.statusCode).toBe(200);
  expect(typeof res.body.openAlerts).toBe('number');
  expect(typeof res.body.pendingOrders).toBe('number');
  expect(typeof res.body.returnsWaiting).toBe('number');
});

test('support can read it too', async () => {
  const res = await call(dashboard, { role: 'support' });
  expect(res.statusCode).toBe(200);
});

test('no login is refused', async () => {
  const res = await call(dashboard, {});
  expect(res.statusCode).toBe(401);
});