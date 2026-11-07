// Discounts and sale events (DEL-2): create, edit, pause, link, unlink, remove.
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const discounts = require('../server/manager/discounts');
const events = require('../server/manager/sale-events');

let txQuery;
beforeEach(() => {
  jest.resetAllMocks();
  txQuery = fakeTransaction(db);
});

const DISCOUNT = { name: 'Back to school 10%', type: 'category sale', amount: 10, amountType: 'percent', startDate: '2026-11-01', endDate: '2026-11-30', saleEventId: '' };
const sqls = () => txQuery.mock.calls.map((c) => c[0]).join('\n');

describe.each([['discounts', discounts], ['sale-events', events]])('%s: who may use it', (_n, handler) => {
  test.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('%s refuses support, customers and visitors without touching the database', async (method) => {
    if (method === 'PATCH' && handler === events) return;   // sale events have no PATCH
    const options = { method, body: DISCOUNT, query: { id: '1000004' } };
    expect((await call(handler, { ...options, role: 'support' })).statusCode).toBe(403);
    expect((await call(handler, { ...options, role: 'customer' })).statusCode).toBe(403);
    expect((await call(handler, options)).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});

describe('discounts: list', () => {
  test('returns the discounts and what uses them, and leaves tier rewards out', async () => {
    db.query
      .mockResolvedValueOnce(rows([{ discountId: 1000001, name: 'Autumn', status: 'Active' }]))
      .mockResolvedValueOnce(rows([{ discountId: 1000001, kind: 'category', targetId: 1000002, name: 'Games' }]));
    const res = await call(discounts, { method: 'GET', role: 'manager' });
    expect(res.statusCode).toBe(200);
    expect(res.json.discounts).toHaveLength(1);
    expect(res.json.links).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toMatch(/Discount_type <> 'tier reward'/);
    expect(db.query.mock.calls[0][0]).toMatch(/Marked_for_deletion = 0/);
  });
});

describe('discounts: create', () => {
  test('without a target it only inserts the discount (no promo code column)', async () => {
    txQuery.mockResolvedValueOnce(rows([{ discountId: 1000050 }]));
    const res = await call(discounts, { method: 'POST', role: 'manager', body: DISCOUNT });
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ discountId: 1000050 });
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(sqls()).not.toMatch(/\bCode\b/);
  });

  test('with a category target it links it in the same transaction', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ discountId: 1000050 }]))
      .mockResolvedValueOnce(rows([{ name: 'Games', discountId: null }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await call(discounts, { method: 'POST', role: 'manager', body: { ...DISCOUNT, targetKind: 'category', targetId: 1000002 } });
    expect(res.statusCode).toBe(201);
    expect(txQuery.mock.calls[2][0]).toMatch(/UPDATE CATEGORY SET Discount_id = @discountId/);
    expect(txQuery.mock.calls[2][1]).toEqual({ discountId: 1000050, targetId: 1000002 });
  });

  test('a target that already has another discount is 409 (Unlink that one first)', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ discountId: 1000050 }]))
      .mockResolvedValueOnce(rows([{ name: 'Games', discountId: 1000001 }]));
    const res = await call(discounts, { method: 'POST', role: 'manager', body: { ...DISCOUNT, targetKind: 'category', targetId: 1000002 } });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/Unlink that one first/);
    expect(sqls()).not.toMatch(/UPDATE/);
  });

  test.each([
    ['a percent above 100', { amount: 150 }],
    ['an amount of 0', { amount: 0 }],
    ['an end date before the start date', { endDate: '2026-10-01' }],
    ['a made-up date', { startDate: '2026-02-31' }],
    ['an unknown type', { type: 'free money' }],
    ['an unknown amount type', { amountType: 'bogus' }],
    ['no name', { name: ' ' }],
    ['an unknown target kind', { targetKind: 'customer', targetId: 5 }],
  ])('%s is 400 and nothing is written', async (_label, change) => {
    const res = await call(discounts, { method: 'POST', role: 'manager', body: { ...DISCOUNT, ...change } });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('a fixed amount may be above 100 (it is dollars, once per line)', async () => {
    txQuery.mockResolvedValueOnce(rows([{ discountId: 1 }]));
    const res = await call(discounts, { method: 'POST', role: 'manager', body: { ...DISCOUNT, type: 'fixed amount', amountType: 'fixed', amount: 150 } });
    expect(res.statusCode).toBe(201);
  });

  test('a sale event that does not exist is 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    const res = await call(discounts, { method: 'POST', role: 'manager', body: { ...DISCOUNT, saleEventId: 1000099 } });
    expect(res.statusCode).toBe(400);
  });
});

describe('discounts: edit and pause', () => {
  test('PUT updates the discount, and never touches tier rewards', async () => {
    txQuery.mockResolvedValueOnce(rows([], 1));
    const res = await call(discounts, { method: 'PUT', role: 'manager', body: { ...DISCOUNT, discountId: 1000001, isActive: false } });
    expect(res.statusCode).toBe(200);
    expect(txQuery.mock.calls[0][0]).toMatch(/Discount_type <> 'tier reward'/);
    expect(txQuery.mock.calls[0][1]).toMatchObject({ isActive: false, discountId: 1000001 });
  });

  test('an unknown discount is 404 and a non-boolean Active is 400', async () => {
    txQuery.mockResolvedValueOnce(rows([], 0));
    expect((await call(discounts, { method: 'PUT', role: 'manager', body: { ...DISCOUNT, discountId: 1, isActive: true } })).statusCode).toBe(404);
    expect((await call(discounts, { method: 'PUT', role: 'manager', body: { ...DISCOUNT, discountId: 1, isActive: 'yes' } })).statusCode).toBe(400);
  });
});

describe('discounts: link and unlink', () => {
  const patch = (body) => call(discounts, { method: 'PATCH', role: 'manager', body });

  test('link sets the product discount', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Discount_id: 1000001 }]))
      .mockResolvedValueOnce(rows([{ name: 'Embers', discountId: null }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await patch({ discountId: 1000001, action: 'link', targetKind: 'product', targetId: 1000007 });
    expect(res.statusCode).toBe(200);
    expect(txQuery.mock.calls[2][0]).toMatch(/UPDATE PRODUCT SET Discount_id = @discountId/);
  });

  test('unlink clears only the link of that discount', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Discount_id: 1000001 }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await patch({ discountId: 1000001, action: 'unlink', targetKind: 'category', targetId: 1000002 });
    expect(res.statusCode).toBe(200);
    expect(txQuery.mock.calls[1][0]).toMatch(/UPDATE CATEGORY SET Discount_id = NULL WHERE Category_id = @targetId AND Discount_id = @discountId/);
  });

  test('unlink of something that was not linked is 404', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Discount_id: 1 }])).mockResolvedValueOnce(rows([], 0));
    expect((await patch({ discountId: 1, action: 'unlink', targetKind: 'product', targetId: 5 })).statusCode).toBe(404);
  });

  test('bad action, bad target kind, unknown discount', async () => {
    expect((await patch({ discountId: 1, action: 'zap', targetKind: 'product', targetId: 5 })).statusCode).toBe(400);
    expect((await patch({ discountId: 1, action: 'link', targetKind: 'PRODUCT; DROP TABLE X', targetId: 5 })).statusCode).toBe(400);
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await patch({ discountId: 1, action: 'link', targetKind: 'product', targetId: 5 })).statusCode).toBe(404);
  });
});

describe('discounts: remove', () => {
  const remove = (id = '1000001') => call(discounts, { method: 'DELETE', role: 'manager', query: { id } });

  test('unused: flagged, never deleted', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Discount_id: 1000001 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await remove();
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE DISCOUNT SET Marked_for_deletion = 1/);
    expect(sqls()).not.toMatch(/DELETE\s+FROM/i);
  });

  test('still used by a product or category: 409 "Unlink it first" with the names, nothing changed', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Discount_id: 1000001 }]))
      .mockResolvedValueOnce(rows([{ kind: 'category', name: 'Games' }, { kind: 'product', name: 'Embers' }]));
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toBe('Unlink it first. It is still used by: Games, Embers.');
    expect(sqls()).not.toMatch(/UPDATE/);
    expect(txQuery.mock.calls[1][0]).toMatch(/Marked_for_deletion = 0/);   // removed products do not block
  });

  test('with more than 5 users the message is shortened', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: 'P' + i }));
    txQuery.mockResolvedValueOnce(rows([{ Discount_id: 1 }])).mockResolvedValueOnce(rows(many));
    expect((await remove()).json.error).toMatch(/P0, P1, P2, P3, P4 and 3 more/);
  });

  test('unknown discount is 404, bad id is 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await remove()).statusCode).toBe(404);
    expect((await remove('x')).statusCode).toBe(400);
  });
});

describe('sale events', () => {
  const EVENT = { name: 'Black Friday', description: '', startDate: '2026-11-27', endDate: '2026-11-30' };

  test('list, create, edit', async () => {
    db.query.mockResolvedValueOnce(rows([{ saleEventId: 1, name: 'Autumn Sale', discountCount: 3 }]));
    expect((await call(events, { method: 'GET', role: 'manager' })).json.saleEvents).toHaveLength(1);
    db.query.mockResolvedValueOnce(rows([{ saleEventId: 1000009 }]));
    const made = await call(events, { method: 'POST', role: 'manager', body: EVENT });
    expect(made.statusCode).toBe(201);
    expect(db.query.mock.calls[1][1]).toMatchObject({ description: null });
    db.query.mockResolvedValueOnce(rows([], 1));
    expect((await call(events, { method: 'PUT', role: 'manager', body: { ...EVENT, saleEventId: 1000009, isActive: false } })).statusCode).toBe(200);
    db.query.mockResolvedValueOnce(rows([], 0));
    expect((await call(events, { method: 'PUT', role: 'manager', body: { ...EVENT, saleEventId: 1, isActive: true } })).statusCode).toBe(404);
    expect((await call(events, { method: 'POST', role: 'manager', body: { ...EVENT, endDate: '2026-11-01' } })).statusCode).toBe(400);
  });

  test('remove is refused while discounts belong to it, and names them', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Sale_event_id: 1 }]))
      .mockResolvedValueOnce(rows([{ name: 'Autumn Games 15% off' }]));
    const res = await call(events, { method: 'DELETE', role: 'manager', query: { id: '1000001' } });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/still has discounts: Autumn Games 15% off/);
    expect(sqls()).not.toMatch(/UPDATE/);
    expect(txQuery.mock.calls[1][0]).toMatch(/Marked_for_deletion = 0/);
  });

  test('remove with no visible discounts flags it; unknown is 404', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Sale_event_id: 1 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const ok = await call(events, { method: 'DELETE', role: 'manager', query: { id: '1000001' } });
    expect(ok.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE SALE_EVENT SET Marked_for_deletion = 1/);
    txQuery.mockReset();
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await call(events, { method: 'DELETE', role: 'manager', query: { id: '1000001' } })).statusCode).toBe(404);
  });
});
