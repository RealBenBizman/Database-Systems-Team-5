// DELETE /api/manager/product-catalog: only a never-sold product can be removed (DEL-1).
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const catalog = require('../server/manager/product-catalog');

let txQuery;
beforeEach(() => {
  jest.resetAllMocks();
  txQuery = fakeTransaction(db);
});

const remove = (options = {}) => call(catalog, { method: 'DELETE', role: 'manager', query: { id: '1000007' }, ...options });
const sqlOf = (n) => txQuery.mock.calls[n][0];

// the answers the endpoint's queries get, in order: product found, never sold, not on an open order, alerts, flag
function neverSold() {
  txQuery
    .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]))
    .mockResolvedValueOnce(rows([]))
    .mockResolvedValueOnce(rows([]))
    .mockResolvedValueOnce(rows([], 1))
    .mockResolvedValueOnce(rows([], 1));
}

describe('who may remove', () => {
  test('no login is 401, support is 403, a customer is 403, and the database is never touched', async () => {
    expect((await remove({ role: undefined })).statusCode).toBe(401);
    expect((await remove({ role: 'support' })).statusCode).toBe(403);
    expect((await remove({ role: 'customer' })).statusCode).toBe(403);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('a missing or bad id is 400', async () => {
    expect((await remove({ query: {} })).statusCode).toBe(400);
    expect((await remove({ query: { id: 'abc' } })).statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});

describe('a product that was never sold', () => {
  test('is flagged, never deleted, and its open alerts are resolved', async () => {
    neverSold();
    const res = await remove();
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ ok: true });
    const all = txQuery.mock.calls.map((c) => c[0]).join('\n');
    expect(all).toMatch(/UPDATE LOW_STOCK_ALERT SET Resolved_at/);
    expect(all).toMatch(/UPDATE PRODUCT SET Marked_for_deletion = 1/);
    expect(all).not.toMatch(/DELETE\s+FROM/i);
    const params = txQuery.mock.calls.map((c) => c[1]);
    expect(params.slice(0, 4)).toEqual(Array(4).fill({ productId: 1000007 }));
    expect(params[4]).toEqual({ id: 1000007 });   // the flag itself goes through softDelete
  });

  test('the id is passed as a parameter, not put in the SQL text', async () => {
    neverSold();
    await remove();
    for (const [sql, params] of txQuery.mock.calls) {
      expect(sql).not.toMatch(/1000007/);
      expect(params).toBeDefined();
    }
  });
});

describe('a product that was sold', () => {
  test('is refused with 409 and the Deactivate hint, and nothing is changed', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]))
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]));
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toBe('This product has sales history. Deactivate it instead.');
    expect(res.json.code).toBe('HAS_HISTORY');
    const all = txQuery.mock.calls.map((c) => c[0]).join('\n');
    expect(all).not.toMatch(/UPDATE/);
    expect(sqlOf(1)).toMatch(/FROM TRANSACTION_ITEM/);
    expect(sqlOf(1)).not.toMatch(/Marked_for_deletion/);   // flagged lines and every sale status count as history
  });
});

describe('other cases', () => {
  test('a product on a pending or ordered supplier order is refused with 409', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]));
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('ON_ORDER');
    expect(txQuery).toHaveBeenCalledTimes(3);
  });

  test('an unknown or already removed product is 404', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    const res = await remove();
    expect(res.statusCode).toBe(404);
    expect(txQuery).toHaveBeenCalledTimes(1);
  });

  test('GET, POST and PUT still work as before (the DELETE did not replace them)', async () => {
    db.query.mockResolvedValue(rows([{ productId: 1 }]));
    expect((await call(catalog, { method: 'GET', role: 'manager' })).statusCode).toBe(200);
  });
});
