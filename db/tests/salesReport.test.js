// Sales report (Part 2, Terry's version): the endpoint GET /api/reports/sales. The database is faked, so no SQL Server is needed.
jest.mock('../lib/db', () => {
  const sql = jest.requireActual('mssql');
  return { sql, query: jest.fn(), withTransaction: jest.fn() };
});
const db = require('../lib/db');
const { call, rows } = require('./helpers_manager');
const sales = require('../server/reports/sales');

beforeEach(() => { jest.resetAllMocks(); });

const TOTALS = { orders: 10, customers: 8, units: 25, gross: 1000, refunded: 100, cost: 500, discounts: 40 };
const PREVIOUS_TOTALS = { orders: 5, customers: 5, units: 12, gross: 450, refunded: 0, cost: 250, discounts: 0 };

// answer each query by what it asks for (the order the endpoint runs them in does not matter)
function fakeDatabase() {
  db.query.mockImplementation(async (text, params) => {
    if (text.includes('FROM CATEGORY WHERE')) return rows([{ id: 1, name: 'Video Games' }]);
    if (text.includes('FROM PRODUCT WHERE')) return rows([{ id: 7, name: 'Kingdom of Embers', categoryId: 1 }]);
    if (text.includes('COUNT(DISTINCT Customer_id)')) return rows([params.from === '2026-10-01' ? TOTALS : PREVIOUS_TOTALS]);
    if (text.includes('AS bucket')) {
      return rows(params.from === '2026-10-01'
        ? [{ bucket: '2026-10-02', revenue: 300, profit: 120, orders: 3 }]
        : [{ bucket: '2026-09-29', revenue: 200, profit: 80, orders: 2 }]);
    }
    if (text.includes('AS categoryId')) return rows([{ categoryId: 1, category: 'Video Games', units: 20, revenue: 700, profit: 300 }]);
    if (text.includes('sold AS')) return rows([{ productId: 7, name: 'Kingdom of Embers', category: 'Video Games', units: 20, revenue: 700, cost: 400, profit: 300 }]);
    if (text.includes('AS orderId')) return rows([{ orderId: 1001, saleDate: '2026-10-02', customerId: 1000007, customer: 'Ava Foster', method: 'credit', units: 3, gross: 120, refunded: 20, cost: 50 }]);
    if (text.includes('AS method')) return rows([{ method: 'credit', orders: 6, revenue: 600 }, { method: 'debit', orders: 4, revenue: 300 }]);
    return rows([]);
  });
}

const get = (query = { from: '2026-10-01', to: '2026-10-03' }) => call(sales, { role: 'manager', query });
const calls = (needle) => db.query.mock.calls.filter(([text]) => text.includes(needle));

describe('GET /api/reports/sales', () => {
  test('managers only: support, customers and visitors never reach the database', async () => {
    expect((await call(sales, { role: 'support' })).statusCode).toBe(403);
    expect((await call(sales, { role: 'customer' })).statusCode).toBe(403);
    expect((await call(sales, {})).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('only GET exists', async () => {
    expect((await call(sales, { role: 'manager', method: 'POST', body: {} })).statusCode).toBe(405);
  });

  test('answers with the totals, the trend, the categories, the products, the payments and the orders', async () => {
    fakeDatabase();
    const res = await get();
    expect(res.statusCode).toBe(200);
    const b = res.json;
    expect(b.period).toMatchObject({ from: '2026-10-01', to: '2026-10-03', days: 3, groupBy: 'day' });
    // net = gross - refunded; profit = net - cost; margin and average order from those
    expect(b.totals).toEqual({
      orders: 10, customers: 8, units: 25, gross: 1000, refunded: 100, discounts: 40,
      net: 900, cost: 500, profit: 400, margin: 44.4, avgOrder: 90,
    });
    expect(b.previousTotals).toMatchObject({ net: 450, profit: 200, orders: 5 });
    expect(b.byCategory).toEqual([{ categoryId: 1, category: 'Video Games', units: 20, revenue: 700, profit: 300 }]);
    expect(b.products[0]).toMatchObject({ productId: 7, name: 'Kingdom of Embers', units: 20, revenue: 700, cost: 400, profit: 300 });
    expect(b.paymentMethods).toHaveLength(2);
    expect(b.orders).toEqual([{
      orderId: 1001, saleDate: '2026-10-02', customerId: 1000007, customer: 'Ava Foster', method: 'credit', units: 3,
      gross: 120, refunded: 20, cost: 50, net: 100, profit: 50,
    }]);
    expect(b.options).toEqual({ categories: [{ id: 1, name: 'Video Games' }], products: [{ id: 7, name: 'Kingdom of Embers', categoryId: 1 }] });
  });

  test('the trend has one point per day, zeros where nothing sold, and the comparison line', async () => {
    fakeDatabase();
    const { trend } = (await get()).json;
    expect(trend).toHaveLength(3);
    expect(trend.map((t) => t.label)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(trend[0]).toMatchObject({ revenue: 0, orders: 0 });
    expect(trend[1]).toMatchObject({ revenue: 300, profit: 120, orders: 3 });
    // the previous period is 2026-09-28 to 2026-09-30, lined up day by day with this one
    expect(trend.map((t) => t.prevRevenue)).toEqual([0, 200, 0]);
  });

  test('compare=none does not ask for the previous period', async () => {
    fakeDatabase();
    const res = await get({ from: '2026-10-01', to: '2026-10-03', compare: 'none' });
    expect(res.json.previousTotals).toBeNull();
    expect(res.json.period.previous).toBeNull();
    expect(res.json.trend.every((t) => t.prevRevenue === null)).toBe(true);
    expect(calls('COUNT(DISTINCT Customer_id)')).toHaveLength(1);
  });

  test('compare=lastyear uses the same dates one year earlier', async () => {
    fakeDatabase();
    const res = await get({ from: '2026-10-01', to: '2026-10-03', compare: 'lastyear' });
    expect(res.json.period.previous).toEqual({ from: '2025-10-01', to: '2025-10-03' });
    const previousCall = calls('COUNT(DISTINCT Customer_id)').find(([, p]) => p.from === '2025-10-01');
    expect(previousCall[1].to).toBe('2025-10-03');
  });

  test('the filters reach the database as typed parameters, never inside the SQL text', async () => {
    fakeDatabase();
    await get({ from: '2026-10-01', to: '2026-10-03', category: '1', product: '7', method: 'debit' });
    for (const [text] of db.query.mock.calls) {
      expect(text).not.toMatch(/2026-10|debit/);
    }
    const [, params] = calls('COUNT(DISTINCT Customer_id)')[0];
    expect(params.from).toBe('2026-10-01');
    expect(params.category.value).toBe(1);
    expect(params.product.value).toBe(7);
    expect(params.method.value).toBe('debit');
  });

  test('no filter sends NULL for the three optional parameters', async () => {
    fakeDatabase();
    await get();
    const [, params] = calls('COUNT(DISTINCT Customer_id)')[0];
    expect([params.category.value, params.product.value, params.method.value]).toEqual([null, null, null]);
  });

  test.each([
    [{ category: 'abc' }, /category/],
    [{ category: '-3' }, /category/],
    [{ product: '1.5' }, /product/],
    [{ method: 'cash' }, /credit or debit/],
  ])('a bad filter %p is refused with 400 before any query runs', async (extra, message) => {
    const res = await get({ from: '2026-10-01', to: '2026-10-03', ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.json.error).toMatch(message);
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each([
    ['2026-99-99', '2026-10-31'],
    ['2026-02-30', '2026-03-01'],
    ['10/01/2026', '2026-10-31'],
    ['2026-10-01', 'tomorrow'],
    ['2026-10-01; DROP TABLE PRODUCT', '2026-10-31'],
    ['2026-11-01', '2026-10-01'],
  ])('the dates %p to %p are refused', async (from, to) => {
    const res = await get({ from, to });
    expect(res.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('only completed sales, removed rows left out, the end date converted with CAST', async () => {
    fakeDatabase();
    await get();
    const text = calls('COUNT(DISTINCT Customer_id)')[0][0];
    expect(text).toMatch(/s\.Status = 'completed'/);
    expect(text).toMatch(/s\.Marked_for_deletion = 0/);
    expect(text).toMatch(/ti\.Marked_for_deletion = 0/);
    expect(text).toMatch(/CAST\(@to AS DATE\)/);
    expect(text).toMatch(/pr\.Status = 'refunded'/);
  });

  test('each order carries the customer id, so the report can open the customer', async () => {
    fakeDatabase();
    await get();
    const text = calls('AS orderId')[0][0];
    expect(text).toMatch(/l\.Customer_id AS customerId/);
    expect(text).toMatch(/GROUP BY l\.Transaction_id, l\.Customer_id/);
  });

  test('never selects card digits, emails or passwords', async () => {
    fakeDatabase();
    await get();
    for (const [text] of db.query.mock.calls) expect(text).not.toMatch(/Card_last4|Email|Password/i);
  });
});
