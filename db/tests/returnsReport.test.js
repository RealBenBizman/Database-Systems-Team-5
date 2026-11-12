// Returns report (REP-4): the endpoint GET /api/reports/returns. The database is faked, so no SQL Server is needed.
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows } = require('./helpers_manager');
const returnsReport = require('../server/reports/returns');

beforeEach(() => { jest.resetAllMocks(); });

const RETURN = {
  id: 1000001, orderId: 1001001, requestedAt: '2026-10-20T15:00:00.000Z', status: 'refunded', reason: 'Defective or damaged',
  refundTotal: 27.59, refundedAt: '2026-10-23T15:00:00.000Z', customerName: 'Ava Foster', soldAt: '2026-10-15T15:00:00.000Z',
  daysSinceSale: 5, daysOpen: 3, totalCount: 2,
};
const ITEM = { returnId: 1000001, productId: 7, name: 'Forza Horizon 5 [Xbox Series X] (Used)', category: 'Video Games', quantity: 1, refundAmount: 27.59 };

// answer each query by what it asks for (the order the endpoint runs them in does not matter)
function fakeDatabase({ returns = [RETURN, { ...RETURN, id: 1000002, status: 'requested', refundedAt: null }], items = [ITEM] } = {}) {
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes('COUNT(*) OVER ()')) return rows(returns);
    if (sql.includes('OPENJSON')) return rows(items);
    if (sql.includes('GROUP BY ti.Product_id')) return rows([{ productId: 7, name: ITEM.name, category: 'Video Games', sold: 20 }]);
    if (sql.includes('AS orders')) {
      return rows([params.from === '2026-10-22' ? { orders: 40, revenue: 1500, units: 90 } : { orders: 50, revenue: 2000, units: 120 }]);
    }
    if (sql.includes('avgDaysToRefund')) return rows([{ requested: 4, units: 5, refundedCash: 80, refunded: 2, denied: 1, decided: 3, avgDaysToRefund: 4.5 }]);
    if (sql.includes('oldestDays')) return rows([{ waiting: 3, oldestDays: 9, approved: 1, approvedAmount: 30 }]);
    return rows([]);
  });
}

const get = (query = { from: '2026-10-24', to: '2026-10-25' }) => call(returnsReport, { role: 'manager', query });
const sqlOf = (needle) => db.query.mock.calls.map((c) => c[0]).filter((s) => s.includes(needle));

describe('GET /api/reports/returns', () => {
  test('managers only: support, customers and visitors never reach the database', async () => {
    expect((await call(returnsReport, { role: 'support' })).statusCode).toBe(403);
    expect((await call(returnsReport, { role: 'customer' })).statusCode).toBe(403);
    expect((await call(returnsReport, {})).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('only GET exists', async () => {
    const res = await call(returnsReport, { role: 'manager', method: 'POST', body: {} });
    expect(res.statusCode).toBe(405);
  });

  test('answers with the records, the sales, the previous period and the backlog', async () => {
    fakeDatabase();
    const res = await get({ from: '2026-10-24', to: '2026-10-25' });
    expect(res.statusCode).toBe(200);
    const body = res.json;
    expect(body.period).toMatchObject({ from: '2026-10-24', to: '2026-10-25', days: 2, previous: { from: '2026-10-22', to: '2026-10-23' } });
    expect(body.records.total).toBe(2);
    expect(body.records.truncated).toBe(false);
    expect(body.records.rows).toHaveLength(2);
    expect(body.records.rows[0]).toMatchObject({ id: 1000001, status: 'refunded', customerName: 'Ava Foster' });
    expect(body.records.rows[0].totalCount).toBeUndefined();
    expect(body.records.rows[0].items).toEqual([{ productId: 7, name: ITEM.name, category: 'Video Games', quantity: 1, refundAmount: 27.59 }]);
    expect(body.records.rows[1].items).toEqual([]);                 // a return with no items still comes back
    expect(body.soldByProduct).toEqual([{ productId: 7, name: ITEM.name, category: 'Video Games', sold: 20 }]);
    expect(body.sales.current).toEqual({ orders: 50, units: 120, revenue: 2000 });
    expect(body.previous.returns).toMatchObject({ requested: 4, refundedCash: 80, avgDaysToRefund: 4.5 });
    expect(body.backlog).toEqual({ waiting: 3, oldestDays: 9, approved: 1, approvedAmount: 30 });
  });

  test('the previous period is asked for with the dates before the range', async () => {
    fakeDatabase();
    await get({ from: '2026-10-24', to: '2026-10-25' });
    const previousCalls = db.query.mock.calls.filter(([, p]) => p && p.from === '2026-10-22');
    expect(previousCalls).toHaveLength(2);                           // its sales and its returns figures
    expect(previousCalls.every(([, p]) => p.to === '2026-10-23')).toBe(true);
  });

  test('compare=none does not ask for the previous period and sends none', async () => {
    fakeDatabase();
    const res = await get({ from: '2026-10-24', to: '2026-10-25', compare: 'none' });
    expect(res.json.previous).toBeNull();
    expect(res.json.sales.previous).toBeNull();
    expect(sqlOf('avgDaysToRefund')).toHaveLength(0);
    expect(res.json.period.previous).toBeNull();
  });

  test('compare=lastyear uses the same dates one year earlier', async () => {
    fakeDatabase();
    const res = await get({ from: '2026-10-24', to: '2026-10-25', compare: 'lastyear' });
    expect(res.json.period.previous).toEqual({ from: '2025-10-24', to: '2025-10-25' });
  });

  test('a long list is cut at 1000 rows and says so', async () => {
    fakeDatabase({ returns: [{ ...RETURN, totalCount: 1450 }] });
    const res = await get();
    expect(res.json.records.total).toBe(1450);
    expect(res.json.records.rows).toHaveLength(1);
    expect(res.json.records.truncated).toBe(true);
    expect(sqlOf('COUNT(*) OVER ()')[0]).toMatch(/TOP \(1000\)/);
  });

  test('no returns in the dates: no products query, empty records', async () => {
    fakeDatabase({ returns: [] });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json.records).toEqual({ rows: [], total: 0, truncated: false });
    expect(sqlOf('OPENJSON')).toHaveLength(0);
  });

  test('the products are read once for every return, not once per return', async () => {
    fakeDatabase();
    await get();
    const itemCalls = db.query.mock.calls.filter(([sql]) => sql.includes('OPENJSON'));
    expect(itemCalls).toHaveLength(1);
    expect(JSON.parse(itemCalls[0][1].ids)).toEqual([1000001, 1000002]);
  });

  test('the default range is the last 90 days', async () => {
    fakeDatabase();
    const res = await call(returnsReport, { role: 'manager', query: {} });
    expect(res.json.period.days).toBe(90);
  });

  test('a bad date is refused with 400 before any query runs', async () => {
    for (const query of [{ from: '2026-99-99', to: '2026-10-25' }, { from: '2026-10-25', to: '2026-10-01' }, { from: '2024-01-01', to: '2026-10-25' }]) {
      const res = await get(query);
      expect(res.statusCode).toBe(400);
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  test('user text never reaches the SQL: dates are parameters', async () => {
    fakeDatabase();
    await get({ from: '2026-10-24', to: '2026-10-25' });
    for (const [sql] of db.query.mock.calls) {
      expect(sql).not.toMatch(/2026-10/);
    }
    const header = db.query.mock.calls.find(([sql]) => sql.includes('COUNT(*) OVER ()'));
    expect(header[1]).toEqual({ from: '2026-10-24', to: '2026-10-25' });
  });

  test('removed rows are left out of every query, and the numbers count completed sales only', async () => {
    fakeDatabase();
    await get();
    const returnQueries = db.query.mock.calls.map(([sql]) => sql).filter((s) => /PRODUCT_RETURN r\b/.test(s));
    expect(returnQueries.length).toBeGreaterThanOrEqual(3);
    returnQueries.forEach((sql) => expect(sql).toMatch(/r\.Marked_for_deletion = 0/));
    expect(sqlOf('COUNT(*) OVER ()')[0]).toMatch(/s\.Marked_for_deletion = 0/);
    expect(sqlOf('OPENJSON')[0]).toMatch(/ri\.Marked_for_deletion = 0/);
    [...sqlOf('GROUP BY ti.Product_id'), ...sqlOf('AS orders')].forEach((sql) => {
      expect(sql).toMatch(/s\.Status = 'completed'/);
      expect(sql).toMatch(/s\.Marked_for_deletion = 0/);
    });
  });

  test('a customer who closed the account does not hide their return', async () => {
    fakeDatabase();
    await get();
    expect(sqlOf('COUNT(*) OVER ()')[0]).toMatch(/LEFT JOIN CUSTOMER c/);
    expect(sqlOf('COUNT(*) OVER ()')[0]).not.toMatch(/c\.Marked_for_deletion/);
  });

  test('never selects card digits, emails or passwords', async () => {
    fakeDatabase();
    await get();
    for (const [sql] of db.query.mock.calls) expect(sql).not.toMatch(/Card_last4|Email|Password/i);
  });
});
