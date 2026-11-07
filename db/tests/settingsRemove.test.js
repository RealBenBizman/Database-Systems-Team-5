// Removing categories, tax rates, reward programs and reward tiers (DEL-4).
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const categories = require('../server/manager/categories');
const taxRates = require('../server/manager/tax-rates');
const programs = require('../server/manager/reward-programs');
const tiers = require('../server/manager/reward-tiers');

let txQuery;
beforeEach(() => {
  jest.resetAllMocks();
  txQuery = fakeTransaction(db);
});

const del = (handler, id = '1000004', role = 'manager') => call(handler, { method: 'DELETE', role, query: { id } });
const sqls = () => txQuery.mock.calls.map((c) => c[0]).join('\n');

describe.each([
  ['categories', categories], ['tax-rates', taxRates], ['reward-programs', programs], ['reward-tiers', tiers],
])('%s: who may remove', (_name, handler) => {
  test('401 without login, 403 for support and customers, 400 for a bad id, and the database is never touched', async () => {
    expect((await del(handler, '1000004', null)).statusCode).toBe(401);
    expect((await del(handler, '1000004', 'support')).statusCode).toBe(403);
    expect((await del(handler, '1000004', 'customer')).statusCode).toBe(403);
    expect((await del(handler, 'abc')).statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('an unknown or already removed row is 404', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await del(handler)).statusCode).toBe(404);
    expect(sqls()).not.toMatch(/UPDATE/);
  });
});

describe('category', () => {
  test('without products it is flagged, never deleted', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Category_id: 1000004 }]))
      .mockResolvedValueOnce(rows([{ n: 0 }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await del(categories);
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE CATEGORY SET Marked_for_deletion = 1/);
    expect(sqls()).not.toMatch(/DELETE\s+FROM/i);
  });

  test('with products it is 409 and says how many', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Category_id: 1000004 }]))
      .mockResolvedValueOnce(rows([{ n: 3 }]));
    const res = await del(categories);
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/still has 3 products/);
    expect(sqls()).not.toMatch(/UPDATE/);
    expect(txQuery.mock.calls[1][0]).toMatch(/Marked_for_deletion = 0/);   // removed products do not block
  });

  test('one product reads "1 product"', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Category_id: 1 }])).mockResolvedValueOnce(rows([{ n: 1 }]));
    expect((await del(categories)).json.error).toMatch(/1 product\./);
  });
});

describe('tax rate', () => {
  const found = (coversToday) => rows([{ categoryId: 1000002, state: 'TX', category: 'Games', coversToday }]);

  test('the only rate in force, with products in the category, is 409 and nothing is changed', async () => {
    txQuery
      .mockResolvedValueOnce(found(1))
      .mockResolvedValueOnce(rows([{ Product_id: 1 }]))
      .mockResolvedValueOnce(rows([]));
    const res = await del(taxRates);
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/Checkout would fail for Games products shipped to TX/);
    expect(sqls()).not.toMatch(/UPDATE/);
  });

  test('when another rate covers today, it is flagged', async () => {
    txQuery
      .mockResolvedValueOnce(found(1))
      .mockResolvedValueOnce(rows([{ Product_id: 1 }]))
      .mockResolvedValueOnce(rows([{ Tax_rate_id: 1000009 }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await del(taxRates);
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE TAX_RATE SET Marked_for_deletion = 1/);
    expect(txQuery.mock.calls[2][1]).toMatchObject({ categoryId: 1000002, state: 'TX', taxRateId: 1000004 });
  });

  test('a category with no products has nothing to break', async () => {
    txQuery
      .mockResolvedValueOnce(found(1))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    expect((await del(taxRates)).statusCode).toBe(200);
  });

  test('a rate that has ended or not started can always be removed (no other checks run)', async () => {
    txQuery.mockResolvedValueOnce(found(0)).mockResolvedValueOnce(rows([], 1));
    expect((await del(taxRates)).statusCode).toBe(200);
    expect(txQuery).toHaveBeenCalledTimes(2);
  });
});

describe('reward program', () => {
  test('with loyalty rows it is 409 HAS_HISTORY', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ coversToday: 0 }]))
      .mockResolvedValueOnce(rows([{ Loyalty_txn_id: 1000020 }]));
    const res = await del(programs);
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('HAS_HISTORY');
    expect(txQuery.mock.calls[1][0]).not.toMatch(/Marked_for_deletion/);   // flagged loyalty rows still count
    expect(sqls()).not.toMatch(/UPDATE/);
  });

  test('the program in force today with no other program is 409 IN_USE', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ coversToday: 1 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));
    const res = await del(programs);
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('IN_USE');
    expect(sqls()).not.toMatch(/UPDATE/);
  });

  test('an old program with no loyalty rows is flagged', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ coversToday: 0 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await del(programs);
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE REWARD_PROGRAM SET Marked_for_deletion = 1/);
  });
});

describe('reward tier', () => {
  test('held by customers: 409 with the count', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Tier_id: 1000004 }]))
      .mockResolvedValueOnce(rows([{ n: 2 }]));
    const res = await del(tiers);
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/2 customers hold this tier/);
    expect(sqls()).not.toMatch(/UPDATE/);
  });

  test('held by one customer reads in the singular', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Tier_id: 1 }])).mockResolvedValueOnce(rows([{ n: 1 }]));
    expect((await del(tiers)).json.error).toMatch(/1 customer holds this tier/);
  });

  test('held by nobody: flagged', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Tier_id: 1000004 }]))
      .mockResolvedValueOnce(rows([{ n: 0 }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await del(tiers);
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE REWARD_TIER SET Marked_for_deletion = 1/);
  });
});

describe('reward tier: list, add, edit', () => {
  const body = { programId: 1000001, tierName: 'Gold', minPoints: 500, perk: '' };

  test('GET lists the tiers of a program', async () => {
    db.query.mockResolvedValue(rows([{ tierId: 1, minPoints: 0, customers: 4 }]));
    const res = await call(tiers, { method: 'GET', role: 'manager', query: { programId: '1000001' } });
    expect(res.statusCode).toBe(200);
    expect(res.json.tiers).toHaveLength(1);
    expect((await call(tiers, { method: 'GET', role: 'support', query: { programId: '1' } })).statusCode).toBe(403);
    expect((await call(tiers, { method: 'GET', role: 'manager', query: {} })).statusCode).toBe(400);
  });

  test('POST creates a tier', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Program_id: 1000001 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([{ tierId: 1000030 }]));
    const res = await call(tiers, { method: 'POST', role: 'manager', body });
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ tierId: 1000030 });
    expect(txQuery.mock.calls[2][1]).toMatchObject({ tierName: 'Gold', minPoints: 500, perk: null });
  });

  test.each([
    ['negative points', { minPoints: -5 }],
    ['points with decimals', { minPoints: 10.5 }],
    ['no name', { tierName: '' }],
  ])('%s is 400', async (_label, change) => {
    expect((await call(tiers, { method: 'POST', role: 'manager', body: { ...body, ...change } })).statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('the same minimum twice is 409, and a removed tier keeps its minimum reserved', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Program_id: 1 }])).mockResolvedValueOnce(rows([{ removed: false }]));
    const a = await call(tiers, { method: 'POST', role: 'manager', body });
    expect(a.statusCode).toBe(409);
    expect(a.json.error).toMatch(/already starts/);
    txQuery.mockReset();
    txQuery.mockResolvedValueOnce(rows([{ Program_id: 1 }])).mockResolvedValueOnce(rows([{ removed: true }]));
    const b = await call(tiers, { method: 'POST', role: 'manager', body });
    expect(b.statusCode).toBe(409);
    expect(b.json.error).toMatch(/removed tier/);
  });

  test('a program that does not exist is 404', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await call(tiers, { method: 'POST', role: 'manager', body })).statusCode).toBe(404);
  });

  test('PUT edits a tier and does not clash with its own minimum', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ programId: 1000001 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await call(tiers, { method: 'PUT', role: 'manager', body: { ...body, tierId: 1000030 } });
    expect(res.statusCode).toBe(200);
    expect(txQuery.mock.calls[1][1]).toMatchObject({ programId: 1000001, minPoints: 500, selfId: 1000030 });
  });
});
