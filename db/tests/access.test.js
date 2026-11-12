// Who may open what: Support (Customer Support Representative) vs Manager (Store Manager).
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows } = require('./helpers_manager');
const suppliers = require('../server/manager/suppliers');
const supplierOrders = require('../server/manager/supplier-orders');
const dashboard = require('../server/manager/dashboard');

beforeEach(() => { jest.resetAllMocks(); });

describe('supplier data is manager only', () => {
  test.each([
    ['suppliers list', suppliers],
    ['supplier orders list', supplierOrders],
  ])('support is refused (403) on the %s and the database is never touched', async (name, handler) => {
    expect((await call(handler, { role: 'support' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each([
    ['suppliers list', suppliers],
    ['supplier orders list', supplierOrders],
  ])('no login is refused (401) on the %s', async (name, handler) => {
    expect((await call(handler, {})).statusCode).toBe(401);
  });

  test('manager gets the suppliers list', async () => {
    db.query.mockResolvedValue(rows([{ supplierId: 1, name: 'A' }]));
    expect((await call(suppliers, { role: 'manager' })).statusCode).toBe(200);
  });

  test('manager gets the supplier orders list', async () => {
    db.query.mockResolvedValue(rows([{ orderId: 1 }]));
    expect((await call(supplierOrders, { role: 'manager' })).statusCode).toBe(200);
  });

  test('support cannot create a supplier order either (403)', async () => {
    const res = await call(supplierOrders, { method: 'POST', role: 'support', body: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('dashboard', () => {
  const counts = () => rows([{ openAlerts: 2, pendingOrders: 3, returnsWaiting: 1 }]);

  test('support sees alerts and returns, but not the supplier order count', async () => {
    db.query.mockResolvedValue(counts());
    const res = await call(dashboard, { role: 'support' });
    expect(res.statusCode).toBe(200);
    expect(res.json.openAlerts).toBe(2);
    expect(res.json.returnsWaiting).toBe(1);
    expect(res.json.pendingOrders).toBeNull();
  });

  test('manager sees all three counts', async () => {
    db.query.mockResolvedValue(counts());
    const res = await call(dashboard, { role: 'manager' });
    expect(res.json.pendingOrders).toBe(3);
  });

  test('no login is refused (401)', async () => {
    expect((await call(dashboard, {})).statusCode).toBe(401);
  });
});