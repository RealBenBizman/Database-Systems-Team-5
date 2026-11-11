// Inventory report: the supplier order timing (promised days, days late) and the shape of the answer.
// The database is faked, so this test needs no SQL Server.
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows } = require('./helpers_manager');
const inventory = require('../server/reports/inventory');
const { orderTiming } = require('../lib/inventoryMetrics');

beforeEach(() => { jest.resetAllMocks(); });

describe('orderTiming', () => {
  test('a received order that took longer than promised is late by the difference', () => {
    expect(orderTiming({ status: 'Received', promisedDays: 7, daysTaken: 10 })).toEqual({ daysLate: 3, open: false });
  });
  test('a received order inside the promise is on time (0 days late)', () => {
    expect(orderTiming({ status: 'Received', promisedDays: 7, daysTaken: 7 })).toEqual({ daysLate: 0, open: false });
    expect(orderTiming({ status: 'Received', promisedDays: 7, daysTaken: 3 })).toEqual({ daysLate: 0, open: false });
  });
  test('an open order past its promise is overdue', () => {
    expect(orderTiming({ status: 'Pending', promisedDays: 5, daysTaken: 9 })).toEqual({ daysLate: 4, open: true });
    expect(orderTiming({ status: 'Ordered', promisedDays: 5, daysTaken: 2 })).toEqual({ daysLate: 0, open: true });
  });
  test('nothing to compare: cancelled, or no promised lead time on file', () => {
    expect(orderTiming({ status: 'Cancelled', promisedDays: 7, daysTaken: 20 })).toEqual({ daysLate: null, open: false });
    expect(orderTiming({ status: 'Received', promisedDays: null, daysTaken: 4 })).toEqual({ daysLate: null, open: false });
    expect(orderTiming({ status: 'Pending', promisedDays: undefined, daysTaken: 4 })).toEqual({ daysLate: null, open: true });
  });
});

describe('GET /api/reports/inventory', () => {
  const product = { productId: 1, name: 'Pro Controller', category: 'Accessories', valueAtCost: 36, level: 'OK', alertId: null };
  const answer = async () => {
    db.query
      .mockResolvedValueOnce(rows([product, { ...product, productId: 2, name: 'Headset', valueAtCost: 14.5 }]))   // products
      .mockResolvedValueOnce(rows([{ status: 'Received', orders: 1 }, { status: 'Pending', orders: 1 }]))        // counts
      .mockResolvedValueOnce(rows([                                                                              // order list
        { orderId: 10, supplier: 'Arcadia', status: 'Received', units: 5, total: 90, promisedDays: 7, daysTaken: 12 },
        { orderId: 11, supplier: 'Gridline', status: 'Pending', units: 2, total: 40, promisedDays: null, daysTaken: 3 },
      ]))
      .mockResolvedValueOnce(rows([{ productId: 1, sold30: 4, sold90: 6, lastSale: '2026-11-01' }]));            // sales
    return call(inventory, { role: 'manager' });
  };

  test('each supplier order carries days late and open', async () => {
    const res = await answer();
    expect(res.statusCode).toBe(200);
    expect(res.json.orders).toHaveLength(2);
    expect(res.json.orders[0]).toMatchObject({ orderId: 10, promisedDays: 7, daysLate: 5, open: false });
    expect(res.json.orders[1]).toMatchObject({ orderId: 11, promisedDays: null, daysLate: null, open: true });
  });

  test('each product carries units sold and the last sale (0 and null when it never sold)', async () => {
    const res = await answer();
    expect(res.json.products[0]).toMatchObject({ productId: 1, sold30: 4, sold90: 6, lastSale: '2026-11-01' });
    expect(res.json.products[1]).toMatchObject({ productId: 2, sold30: 0, sold90: 0, lastSale: null });
  });

  test('the old keys are still there and the totals add up', async () => {
    const res = await answer();
    expect(res.json.ordersByStatus.map((o) => o.status)).toEqual(['Pending', 'Ordered', 'Received', 'Cancelled']);
    expect(res.json.totals.valueAtCost).toBe(50.5);
  });

  test('the order query leaves out flagged rows and reads the promised lead time', async () => {
    await answer();
    const sql = db.query.mock.calls[2][0];
    expect(sql).toMatch(/o\.Marked_for_deletion = 0/);
    expect(sql).toMatch(/i\.Marked_for_deletion = 0/);
    expect(sql).toMatch(/sp\.Marked_for_deletion = 0/);
    expect(sql).toMatch(/Lead_time_days/);
  });

  test('managers only', async () => {
    expect((await call(inventory, { role: 'support' })).statusCode).toBe(403);
    expect((await call(inventory, {})).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
});
