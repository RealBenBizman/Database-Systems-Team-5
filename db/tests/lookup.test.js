jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows } = require('./helpers_manager');
const customers = require('../server/manager/customers');
const customer = require('../server/manager/customers/[id]');
const orders = require('../server/manager/orders');
const order = require('../server/manager/orders/[id]');

beforeEach(() => { jest.resetAllMocks(); });

const allSql = () => db.query.mock.calls.map((c) => c[0]);

describe('search lists', () => {
  test.each([['customers', customers], ['orders', orders]])('%s: manager only, read only', async (_n, handler) => {
    db.query.mockResolvedValue(rows([]));
    expect((await call(handler, { role: 'manager' })).statusCode).toBe(200);
    expect((await call(handler, { role: 'support' })).statusCode).toBe(403);
    expect((await call(handler, { role: 'customer' })).statusCode).toBe(403);
    expect((await call(handler, {})).statusCode).toBe(401);
    expect((await call(handler, { method: 'POST', role: 'manager', body: {} })).statusCode).toBe(405);
  });
  test('a 7-digit search is also tried as an id; other text is not', async () => {
    db.query.mockResolvedValue(rows([]));
    await call(customers, { role: 'manager', query: { q: '1000042' } });
    expect(db.query.mock.calls[0][1]).toEqual({ like: '%1000042%', id: 1000042 });
    await call(orders, { role: 'manager', query: { q: 'alice' } });
    expect(db.query.mock.calls[1][1]).toEqual({ like: '%alice%', id: null });
  });
  test('queries filter soft-deleted rows and never select the password', async () => {
    db.query.mockResolvedValue(rows([]));
    await call(customers, { role: 'manager' });
    await call(orders, { role: 'manager' });
    for (const sql of allSql()) {
      expect(sql).toMatch(/Marked_for_deletion = 0/);
      expect(sql).not.toMatch(/Password/i);
    }
  });
});

describe('customer detail', () => {
  test('returns the profile with addresses, phones, points history and orders', async () => {
    db.query
      .mockResolvedValueOnce(rows([{ customerId: 1000001, firstName: 'Alice' }]))
      .mockResolvedValueOnce(rows([{ addressId: 1 }]))
      .mockResolvedValueOnce(rows([{ phone: '5125550100' }]))
      .mockResolvedValueOnce(rows([{ pointsChange: 10 }]))
      .mockResolvedValueOnce(rows([{ orderId: 1000010 }]));
    const res = await call(customer, { role: 'manager', query: { id: '1000001' } });
    expect(res.statusCode).toBe(200);
    expect(res.json.customer.firstName).toBe('Alice');
    expect(res.json.phones).toEqual(['5125550100']);
    expect(res.json.orders).toHaveLength(1);
    expect(JSON.stringify(res.json)).not.toMatch(/hash/i);
    for (const sql of allSql()) { expect(sql).toMatch(/Marked_for_deletion = 0/); expect(sql).not.toMatch(/Password/i); }
  });
  test('unknown customer 404, bad id 400, support 403', async () => {
    db.query.mockResolvedValue(rows([]));
    expect((await call(customer, { role: 'manager', query: { id: '1000001' } })).statusCode).toBe(404);
    expect((await call(customer, { role: 'manager', query: { id: 'abc' } })).statusCode).toBe(400);
    expect((await call(customer, { role: 'manager', query: { id: '5' } })).statusCode).toBe(400);
    expect((await call(customer, { role: 'support', query: { id: '1000001' } })).statusCode).toBe(403);
  });
});

describe('order detail', () => {
  test('returns the order with items, payments and points', async () => {
    db.query
      .mockResolvedValueOnce(rows([{ orderId: 1000010, status: 'completed', customerName: 'Alice N' }]))
      .mockResolvedValueOnce(rows([{ name: 'Game', quantity: 2 }]))
      .mockResolvedValueOnce(rows([{ method: 'credit', amount: 40, cardLast4: '4242' }]))
      .mockResolvedValueOnce(rows([{ pointsEarned: 40, pointsTakenBack: 0 }]));
    const res = await call(order, { role: 'manager', query: { id: '1000010' } });
    expect(res.statusCode).toBe(200);
    expect(res.json.items).toHaveLength(1);
    expect(res.json.payments[0].cardLast4).toBe('4242');
    expect(res.json.points.pointsEarned).toBe(40);
    const sql = allSql().join('\n');
    expect(sql).not.toMatch(/Password/i);
    expect(sql).toMatch(/Card_last4/);
  });
  test('unknown order 404, support 403, no login 401', async () => {
    db.query.mockResolvedValue(rows([]));
    expect((await call(order, { role: 'manager', query: { id: '1000010' } })).statusCode).toBe(404);
    expect((await call(order, { role: 'support', query: { id: '1000010' } })).statusCode).toBe(403);
    expect((await call(order, { query: { id: '1000010' } })).statusCode).toBe(401);
  });
});
