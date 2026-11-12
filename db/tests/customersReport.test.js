jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows } = require('./helpers_manager');
const customers = require('../server/reports/customers');
const { customerType, rewardStatus, numberOrders, rollUp } = require('../lib/customerMetrics');

beforeEach(() => { jest.resetAllMocks(); });

describe('customerType', () => {
  test('first order inside the period is New', () => {
    expect(customerType({ orders: 2, ordersBefore: 0 })).toBe('New');
  });
  test('ordered before and during the period is Returning', () => {
    expect(customerType({ orders: 1, ordersBefore: 3 })).toBe('Returning');
  });
  test('ordered before but not during the period is Did not return', () => {
    expect(customerType({ orders: 0, ordersBefore: 1 })).toBe('Did not return');
  });
  test('never ordered', () => {
    expect(customerType({ orders: 0, ordersBefore: 0 })).toBe('No orders yet');
  });
});

describe('rewardStatus', () => {
  test('used wins over the end date', () => {
    expect(rewardStatus({ usedOn: '2026-10-02', expires: '2026-10-01' }, '2026-11-12')).toBe('Used');
  });
  test('unused and past the end date is Expired', () => {
    expect(rewardStatus({ usedOn: null, expires: '2026-11-11' }, '2026-11-12')).toBe('Expired');
  });
  test('unused and still in date is Available (the last day counts)', () => {
    expect(rewardStatus({ usedOn: null, expires: '2026-11-12' }, '2026-11-12')).toBe('Available');
  });
});

describe('numberOrders and rollUp', () => {
  const people = [
    { customerId: 1, name: 'Ana', ordersBefore: 2, lastBefore: '2026-07-01' },
    { customerId: 2, name: 'Bo', ordersBefore: 0, lastBefore: null },
    { customerId: 3, name: 'Cy', ordersBefore: 1, lastBefore: '2026-06-15' },
  ];
  const orders = [
    { orderId: 10, customerId: 2, saleDate: '2026-09-01', units: 1, total: 19.99 },
    { orderId: 11, customerId: 1, saleDate: '2026-09-03', units: 2, total: 0.1 },
    { orderId: 12, customerId: 2, saleDate: '2026-09-20', units: 3, total: 0.2 },
  ];

  test('order numbers carry on from the orders before the period', () => {
    expect(numberOrders(orders, people).map((o) => o.orderNo)).toEqual([1, 3, 2]);
  });

  test('each customer gets period totals, a type and a favorite category', () => {
    const cats = [
      { customerId: 2, category: 'Games', revenue: 5 },
      { customerId: 2, category: 'Consoles', revenue: 15.19 },
    ];
    const out = rollUp(people, orders, null, cats);
    expect(out[0]).toMatchObject({ orders: 1, spent: 0.1, type: 'Returning', lastOrder: '2026-09-03', prevOrders: null });
    expect(out[1]).toMatchObject({ orders: 2, units: 4, spent: 20.19, type: 'New', favorite: 'Consoles', lastOrder: '2026-09-20' });
    expect(out[2]).toMatchObject({ orders: 0, spent: 0, type: 'Did not return', favorite: null, lastOrder: '2026-06-15' });
  });

  test('the comparison period fills prevOrders and prevSpent, 0 when the customer did not buy', () => {
    const out = rollUp(people, orders, [{ orderId: 5, customerId: 3, saleDate: '2026-06-15', units: 1, total: 40 }], []);
    expect(out[2]).toMatchObject({ prevOrders: 1, prevSpent: 40 });
    expect(out[0]).toMatchObject({ prevOrders: 0, prevSpent: 0 });
  });
});

describe('GET /api/reports/customers', () => {
  const query = { from: '2026-09-01', to: '2026-09-30' };
  const answer = async (extra = {}) => {
    db.query
      .mockResolvedValueOnce(rows([
        { customerId: 1, name: 'Ana Ruiz', tier: 'Gold', points: 900, ordersBefore: 2, lastBefore: new Date('2026-07-01T00:00:00Z'), pointsEarned: 30, pointsTakenBack: 0 },
        { customerId: 2, name: 'Bo Chen', tier: 'No tier', points: 20, ordersBefore: 0, lastBefore: null, pointsEarned: 20, pointsTakenBack: 0 },
      ]))
      .mockResolvedValueOnce(rows([
        { orderId: 10, customerId: 2, saleDate: new Date('2026-09-01T00:00:00Z'), units: 1, total: 19.99 },
        { orderId: 11, customerId: 1, saleDate: new Date('2026-09-03T00:00:00Z'), units: 2, total: 30.01 },
      ]))
      .mockResolvedValueOnce(rows([
        { customerId: 1, category: 'Consoles', units: 2, revenue: 30.01 },
        { customerId: 2, category: 'Games', units: 1, revenue: 19.99 },
      ]))
      .mockResolvedValueOnce(rows([
        { rewardId: 7, customerId: 1, tier: 'Gold', issued: new Date('2026-08-01T00:00:00Z'), expires: new Date('2026-10-30T00:00:00Z'), usedOn: new Date('2026-09-03T00:00:00Z'), saved: 4.5 },
      ]))
      .mockResolvedValueOnce(rows([{ tier: 'Bronze', minPoints: 100 }, { tier: 'Gold', minPoints: 800 }]))
      .mockResolvedValueOnce(rows([{ orderId: 3, customerId: 1, saleDate: new Date('2026-08-10T00:00:00Z'), units: 1, total: 12 }]));
    return call(customers, { role: 'manager', query: { ...query, ...extra } });
  };

  test('customers carry their period numbers and the totals add up', async () => {
    const res = await answer();
    expect(res.statusCode).toBe(200);
    expect(res.json.customers[0]).toMatchObject({ customerId: 1, orders: 1, spent: 30.01, type: 'Returning', favorite: 'Consoles', prevOrders: 1, prevSpent: 12 });
    expect(res.json.customers[1]).toMatchObject({ customerId: 2, orders: 1, type: 'New', prevOrders: 0 });
    expect(res.json.totals).toEqual({ customers: 2, buyers: 2, orders: 2, revenue: 50 });
    expect(res.json.tiers).toEqual(['Bronze', 'Gold']);
  });

  test('orders come back newest first, numbered, with plain dates', async () => {
    const res = await answer();
    expect(res.json.orders.map((o) => [o.orderId, o.saleDate, o.orderNo])).toEqual([[11, '2026-09-03', 3], [10, '2026-09-01', 1]]);
  });

  test('a reward that was used says so', async () => {
    const res = await answer();
    expect(res.json.rewards[0]).toMatchObject({ rewardId: 7, status: 'Used', usedOn: '2026-09-03', expires: '2026-10-30' });
  });

  test('the dates go to the queries as parameters, and the comparison uses the days just before', async () => {
    await answer();
    expect(db.query.mock.calls[1][1]).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(db.query.mock.calls[5][1]).toEqual({ from: '2026-08-02', to: '2026-08-31' });
    expect(db.query.mock.calls[1][0]).toBe(db.query.mock.calls[5][0]);
  });

  test('no comparison means one query less and no previous numbers', async () => {
    const res = await answer({ compare: 'none' });
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(res.json.customers[0].prevOrders).toBeNull();
  });

  test('the queries count completed sales only and leave out flagged rows', async () => {
    await answer();
    const [people, orders, cats, rewards] = db.query.mock.calls.map((c) => c[0]);
    expect(people).toMatch(/VW_REWARDS_REPORT/);
    for (const sql of [people, orders, cats, rewards]) {
      expect(sql).toMatch(/s\.Status = 'completed'/);
      expect(sql).toMatch(/s\.Marked_for_deletion = 0/);
    }
    expect(orders).toMatch(/ti\.Marked_for_deletion = 0/);
    expect(orders).toMatch(/cu\.Marked_for_deletion = 0/);
    expect(rewards).toMatch(/d\.Marked_for_deletion = 0/);
  });

  test('bad dates are refused', async () => {
    expect((await call(customers, { role: 'manager', query: { from: '2026-02-30', to: '2026-03-01' } })).statusCode).toBe(400);
    expect((await call(customers, { role: 'manager', query: { from: '2026-09-30', to: '2026-09-01' } })).statusCode).toBe(400);
    expect((await call(customers, { role: 'manager', query: { ...query, compare: 'always' } })).statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('managers only', async () => {
    expect((await call(customers, { role: 'support' })).statusCode).toBe(403);
    expect((await call(customers, {})).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
});
