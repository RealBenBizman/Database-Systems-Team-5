const { call } = require('./helpers_backoffice');
const db = require('../lib/db');
const suppliers = require('../api/manager/suppliers');
const orders = require('../api/manager/supplier-orders');
const orderStatus = require('../api/manager/supplier-order-status');

let managerId, supplierId, alertId, orderId;

beforeAll(async () => {
  const m = await db.query("SELECT TOP 1 Employee_id FROM EMPLOYEE WHERE Role = 'Manager'");
  managerId = m.recordset[0].Employee_id;
  const s = await db.query('SELECT TOP 1 Supplier_id FROM SUPPLIER WHERE Marked_for_deletion = 0');
  supplierId = s.recordset[0].Supplier_id;
  const a = await db.query(`SELECT TOP 1 Alert_id FROM LOW_STOCK_ALERT
    WHERE Resolved_at IS NULL AND Order_id IS NULL AND Marked_for_deletion = 0`);
  alertId = a.recordset[0].Alert_id;
});

// Undo what the test made: unlink the alert and mark the test order deleted.
afterAll(async () => {
  if (orderId) {
    await db.query('UPDATE LOW_STOCK_ALERT SET Order_id = NULL WHERE Alert_id = @alertId', { alertId });
    await db.query('UPDATE SUPPLIER_ORDER SET Marked_for_deletion = 1 WHERE Order_id = @orderId', { orderId });
  }
  await (await db.getPool()).close();
});

test('suppliers list works', async () => {
  const res = await call(suppliers, { role: 'support' });
  expect(res.statusCode).toBe(200);
  expect(res.body.suppliers.length).toBeGreaterThan(0);
});

test('manager creates an order from an alert', async () => {
  const res = await call(orders, { method: 'POST', role: 'manager', id: managerId,
    body: { alertId, supplierId, quantity: 5 } });
  expect(res.statusCode).toBe(201);
  orderId = res.body.orderId;
});

test('the same alert cannot get a second order (409)', async () => {
  const res = await call(orders, { method: 'POST', role: 'manager', id: managerId,
    body: { alertId, supplierId, quantity: 5 } });
  expect(res.statusCode).toBe(409);
});

test('support cannot create an order (403)', async () => {
  const res = await call(orders, { method: 'POST', role: 'support', id: managerId,
    body: { alertId, supplierId, quantity: 5 } });
  expect(res.statusCode).toBe(403);
});

test('the order shows up in the list as Pending', async () => {
  const res = await call(orders, { role: 'support' });
  const mine = res.body.orders.find((o) => o.orderId === orderId);
  expect(mine.status).toBe('Pending');
});

test('status moves: skipping a step is refused, valid steps work', async () => {
  const skip = await call(orderStatus, { method: 'POST', role: 'manager', id: managerId,
    body: { orderId, status: 'Received' } });
  expect(skip.statusCode).toBe(409);

  const ordered = await call(orderStatus, { method: 'POST', role: 'manager', id: managerId,
    body: { orderId, status: 'Ordered' } });
  expect(ordered.statusCode).toBe(200);
  expect(ordered.body.status).toBe('Ordered');

  const cancelled = await call(orderStatus, { method: 'POST', role: 'manager', id: managerId,
    body: { orderId, status: 'Cancelled' } });
  expect(cancelled.statusCode).toBe(200);

  const after = await call(orderStatus, { method: 'POST', role: 'manager', id: managerId,
    body: { orderId, status: 'Ordered' } });
  expect(after.statusCode).toBe(409);
});

test('support cannot change a status (403)', async () => {
  const res = await call(orderStatus, { method: 'POST', role: 'support', id: managerId,
    body: { orderId, status: 'Ordered' } });
  expect(res.statusCode).toBe(403);
});