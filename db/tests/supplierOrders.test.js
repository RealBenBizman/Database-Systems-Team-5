// Supplier orders: the order form only offers suppliers that sell the product, and the server enforces it.
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const suppliers = require('../server/manager/suppliers');
const orders = require('../server/manager/supplier-orders');

let txQuery;
beforeEach(() => { jest.resetAllMocks(); txQuery = fakeTransaction(db); });

describe('supplier list for the order form', () => {
  test('returns the suppliers and which supplier sells which product', async () => {
    db.query
      .mockResolvedValueOnce(rows([{ supplierId: 1000003, name: 'Gridline Accessories Co.' }]))
      .mockResolvedValueOnce(rows([{ supplierId: 1000003, productId: 1000011, unitCost: 35, leadTimeDays: 7 }]));
    const res = await call(suppliers, { role: 'manager' });
    expect(res.statusCode).toBe(200);
    expect(res.json.suppliers).toHaveLength(1);
    expect(res.json.links).toEqual([{ supplierId: 1000003, productId: 1000011, unitCost: 35, leadTimeDays: 7 }]);
    const linkSql = db.query.mock.calls[1][0];
    expect(linkSql).toMatch(/sp.Marked_for_deletion = 0/);
    expect(linkSql).toMatch(/s.Marked_for_deletion = 0/);
    expect(linkSql).not.toMatch(/Password|Cost_price/i);
  });
  test('managers only', async () => {
    expect((await call(suppliers, { role: 'support' })).statusCode).toBe(403);
    expect((await call(suppliers, {})).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('placing a supplier order', () => {
  const order = (body = { alertId: 1000001, supplierId: 1000003, quantity: 10 }) =>
    call(orders, { method: 'POST', role: 'manager', body });
  const sqls = () => txQuery.mock.calls.map((c) => c[0]).join('\n');

  test('a supplier that sells the product is accepted and its own unit cost is used', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ productId: 1000011 }]))            // alert
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000003 }]))          // supplier exists
      .mockResolvedValueOnce(rows([{ unitCost: 33.5 }]))                // supplier sells it
      .mockResolvedValueOnce(rows([{ orderId: 1000040 }]))              // SUPPLIER_ORDER
      .mockResolvedValueOnce(rows([], 1))                               // SUPPLIER_ORDER_ITEM
      .mockResolvedValueOnce(rows([], 1));                              // alert linked
    const res = await order();
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ orderId: 1000040 });
    expect(txQuery.mock.calls[2][0]).toMatch(/FROM SUPPLIER_PRODUCT/);
    expect(txQuery.mock.calls[2][1]).toEqual({ supplierId: 1000003, productId: 1000011 });
    expect(txQuery.mock.calls[4][1]).toMatchObject({ orderId: 1000040, productId: 1000011, quantity: 10, unitCost: 33.5 });
  });

  test('a supplier that does not sell the product is 409 and no order is created', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ productId: 1000011 }]))
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([]));
    const res = await order({ alertId: 1000001, supplierId: 1000001, quantity: 10 });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toBe('That supplier does not sell this product.');
    expect(sqls()).not.toMatch(/INSERT/);
  });

  test('an unknown supplier is still 404, a used-up alert still 409', async () => {
    txQuery.mockResolvedValueOnce(rows([{ productId: 1000011 }])).mockResolvedValueOnce(rows([]));
    expect((await order()).statusCode).toBe(404);
    txQuery.mockReset();
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await order()).statusCode).toBe(409);
  });

  test('role and input checks stay in place', async () => {
    expect((await call(orders, { method: 'POST', role: 'support', body: {} })).statusCode).toBe(403);
    expect((await order({ alertId: 'x', supplierId: 1, quantity: 1 })).statusCode).toBe(400);
    expect((await order({ alertId: 1, supplierId: 1, quantity: 0 })).statusCode).toBe(400);
  });
});
