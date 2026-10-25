const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const adjustments = require('../api/manager/adjustments');

let managerId, productId, startStock;

beforeAll(async () => {
  const m = await db.query("SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager'");
  managerId = m.recordset[0].Employee_id;
  const p = await db.query('SELECT TOP 1 Product_id, Stock_quantity FROM PRODUCT WHERE Marked_for_deletion = 0 ORDER BY Product_id');
  productId = p.recordset[0].Product_id;
  startStock = p.recordset[0].Stock_quantity;
});

afterAll(async () => { await (await db.getPool()).close(); });

// NOTE: the two adjustments below stay in the table as audit rows (+2, then -2).
test('manager adds stock, then takes it back', async () => {
  const up = await call(adjustments, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, quantityChange: 2, reason: 'test add' } });
  expect(up.statusCode).toBe(201);
  expect(up.body.stock).toBe(startStock + 2);

  const down = await call(adjustments, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, quantityChange: -2, reason: 'test remove' } });
  expect(down.statusCode).toBe(201);
  expect(down.body.stock).toBe(startStock);
});

test('going below 0 is refused by the trigger (409)', async () => {
  const res = await call(adjustments, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, quantityChange: -(startStock + 1), reason: 'too much' } });
  expect(res.statusCode).toBe(409);
});

test('support cannot adjust (403)', async () => {
  const res = await call(adjustments, { method: 'POST', role: 'support', id: managerId,
    body: { productId, quantityChange: 1, reason: 'nope' } });
  expect(res.statusCode).toBe(403);
});

test('missing reason is refused (400)', async () => {
  const res = await call(adjustments, { method: 'POST', role: 'manager', id: managerId,
    body: { productId, quantityChange: 1 } });
  expect(res.statusCode).toBe(400);
});

test('no login is refused (401)', async () => {
  const res = await call(adjustments, { method: 'POST', body: { productId, quantityChange: 1, reason: 'x' } });
  expect(res.statusCode).toBe(401);
});