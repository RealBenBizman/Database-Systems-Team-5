// Customer self-service removals (DEL-5): delete my review, dismiss notifications, close my account.
jest.mock('../lib/db', () => {
  const sql = jest.requireActual('mssql');
  const txQuery = jest.fn();
  return { sql, query: jest.fn(), withTransaction: jest.fn((fn) => fn({ query: txQuery })), txQuery };
});

const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { signToken } = require('../lib/auth');
const { mockReq, mockRes } = require('./helpers');
const reviews = require('../server/reviews');
const notifications = require('../server/account/notifications');
const close = require('../server/account/close');
const { closeCustomer } = require('../lib/closeAccount');

const CUSTOMER = 1000001;
const result = (rows = [], affected = rows.length) => ({ recordset: rows, recordsets: [rows], rowsAffected: [affected] });

async function call(handler, { method = 'GET', body, query = {}, role = 'customer', customerId = CUSTOMER } = {}) {
  const cookie = role ? `pos_token=${signToken({ id: customerId, role, name: 'Test' })}` : '';
  const req = mockReq({ method, body, headers: { cookie } });
  req.query = query;
  const res = mockRes();
  await handler(req, res);
  return res;
}

const txSql = () => db.txQuery.mock.calls.map((c) => c[0]).join('\n');
let hash;
beforeAll(async () => { process.env.JWT_SECRET = 'self-service-tests-use-a-local-secret-32-chars'; hash = await bcrypt.hash('Correct1pass', 4); });
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset(); db.txQuery.mockReset();
  db.withTransaction.mockImplementation((fn) => fn({ query: db.txQuery }));
  db.query.mockImplementation(async (text) => {
    if (text.startsWith('SELECT Customer_id FROM CUSTOMER')) return result([{ Customer_id: CUSTOMER }]);
    throw new Error('Unexpected database query: ' + text.slice(0, 60));
  });
});

describe('delete my review', () => {
  const del = (id, options) => call(reviews, { method: 'DELETE', query: { id }, ...options });

  test('only a signed-in customer: visitors 401, staff 403', async () => {
    expect((await del('1000005', { role: null })).statusCode).toBe(401);
    expect((await del('1000005', { role: 'manager' })).statusCode).toBe(403);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('my own review is flagged, never deleted', async () => {
    db.txQuery.mockResolvedValueOnce(result([{ Review_id: 1000005 }])).mockResolvedValueOnce(result([], 1));
    const res = await del('1000005');
    expect(res.statusCode).toBe(200);
    expect(db.txQuery.mock.calls[0][1]).toEqual({ reviewId: 1000005, customerId: CUSTOMER });   // the owner check uses the signed-in id
    expect(txSql()).toMatch(/UPDATE REVIEW SET Marked_for_deletion = 1/);
    expect(txSql()).not.toMatch(/DELETE\s+FROM/i);
  });

  test('somebody else\'s review (or one already removed) is 404 and nothing changes', async () => {
    db.txQuery.mockResolvedValueOnce(result([]));
    const res = await del('1000005');
    expect(res.statusCode).toBe(404);
    expect(db.txQuery).toHaveBeenCalledTimes(1);
  });

  test('a bad id is 400', async () => {
    expect((await del('abc')).statusCode).toBe(400);
    expect((await del(undefined)).statusCode).toBe(400);
  });

  test('the list marks which reviews are mine, 0 for visitors and staff', async () => {
    db.query.mockResolvedValue(result([{ id: 1, rating: 5, mine: true, total: 1 }]));
    await call(reviews, { query: { productId: '1000002' } });
    expect(db.query.mock.calls.at(-1)[1].viewerId).toBe(CUSTOMER);
    expect(db.query.mock.calls.at(-1)[0]).toMatch(/AS mine/);
    await call(reviews, { query: { productId: '1000002' }, role: null });
    expect(db.query.mock.calls.at(-1)[1].viewerId).toBe(0);
    await call(reviews, { query: { productId: '1000002' }, role: 'manager' });
    expect(db.query.mock.calls.at(-1)[1].viewerId).toBe(0);
  });
});

describe('dismiss notifications', () => {
  const del = (query, options) => call(notifications, { method: 'DELETE', query, ...options });

  test('visitors and staff are refused', async () => {
    expect((await del({ id: '1000007' }, { role: null })).statusCode).toBe(401);
    expect((await del({ id: '1000007' }, { role: 'support' })).statusCode).toBe(403);
  });

  test('one notification: flagged, scoped to the signed-in customer', async () => {
    db.query.mockImplementation(async (text) => (text.startsWith('SELECT Customer_id') ? result([{ Customer_id: CUSTOMER }]) : result([], 1)));
    const res = await del({ id: '1000007' });
    expect(res.statusCode).toBe(200);
    const [sql, params] = db.query.mock.calls.at(-1);
    expect(sql).toMatch(/UPDATE NOTIFICATION SET Marked_for_deletion = 1/);
    expect(sql).toMatch(/Customer_id = @customerId/);
    expect(params).toEqual({ id: 1000007, customerId: CUSTOMER });
  });

  test('not mine or already gone: 404; bad id: 400', async () => {
    db.query.mockImplementation(async (text) => (text.startsWith('SELECT Customer_id') ? result([{ Customer_id: CUSTOMER }]) : result([], 0)));
    expect((await del({ id: '1000007' })).statusCode).toBe(404);
    expect((await del({ id: 'x' })).statusCode).toBe(400);
    expect((await del({})).statusCode).toBe(400);
  });

  test('clear read: only notifications that were read, and it reports how many', async () => {
    db.query.mockImplementation(async (text) => (text.startsWith('SELECT Customer_id') ? result([{ Customer_id: CUSTOMER }]) : result([], 4)));
    const res = await del({ read: 'true' });
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ ok: true, removed: 4 });
    expect(db.query.mock.calls.at(-1)[0]).toMatch(/Read_at IS NOT NULL/);
    expect((await del({ read: 'true', id: '1000007' })).statusCode).toBe(400);
  });
});

describe('closeCustomer (shared by the customer and the manager)', () => {
  test('flags the customer and empties the cart when nothing is open', async () => {
    db.txQuery
      .mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }]))
      .mockResolvedValueOnce(result([{ n: 0 }]))
      .mockResolvedValueOnce(result([], 2))
      .mockResolvedValueOnce(result([], 1));
    await closeCustomer({ query: db.txQuery }, CUSTOMER);
    expect(txSql()).toMatch(/DELETE FROM CART_ITEM WHERE Customer_id = @customerId/);
    expect(txSql()).toMatch(/UPDATE CUSTOMER SET Marked_for_deletion = 1/);
    expect(txSql()).not.toMatch(/DELETE FROM (?!CART_ITEM)/);
  });

  test('a requested or approved return blocks it with 409 and changes nothing', async () => {
    db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ n: 1 }]));
    await expect(closeCustomer({ query: db.txQuery }, CUSTOMER, { self: true })).rejects.toMatchObject({ status: 409, code: 'OPEN_RETURN', message: expect.stringMatching(/^You have a return/) });
    expect(db.txQuery.mock.calls[1][0]).toMatch(/r.Status IN \('requested', 'approved'\)/);
    expect(txSql()).not.toMatch(/UPDATE|DELETE/);
    db.txQuery.mockReset();
    db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ n: 2 }]));
    await expect(closeCustomer({ query: db.txQuery }, CUSTOMER)).rejects.toMatchObject({ message: expect.stringMatching(/^This customer has a return/) });
  });

  test('an unknown or already closed customer is 404', async () => {
    db.txQuery.mockResolvedValueOnce(result([]));
    await expect(closeCustomer({ query: db.txQuery }, CUSTOMER)).rejects.toMatchObject({ status: 404 });
  });
});

describe('close my account', () => {
  const post = (body, options) => call(close, { method: 'POST', body, ...options });
  const passwordLookup = (stored) => db.query.mockImplementation(async (text) => {
    if (text.startsWith('SELECT Customer_id FROM CUSTOMER')) return result([{ Customer_id: CUSTOMER }]);
    if (text.includes('Password_hash')) return result(stored === undefined ? [] : [{ hash: stored }]);
    throw new Error('Unexpected database query');
  });

  test('visitors and staff are refused', async () => {
    expect((await post({ password: 'x' }, { role: null })).statusCode).toBe(401);
    expect((await post({ password: 'x' }, { role: 'manager' })).statusCode).toBe(403);
  });

  test('a password is required and no other field is accepted', async () => {
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ password: '' })).statusCode).toBe(400);
    expect((await post({ password: 'Correct1pass', customerId: 1000009 })).statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('a wrong password is 403 and the account stays open', async () => {
    passwordLookup(hash);
    const res = await post({ password: 'Wrong1pass' }, { customerId: 1000011 });
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe('BAD_PASSWORD');
    expect(db.withTransaction).not.toHaveBeenCalled();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('five wrong passwords lock the attempts (429)', async () => {
    passwordLookup(hash);
    for (let i = 0; i < 5; i += 1) await post({ password: 'Wrong1pass' }, { customerId: 1000012 });
    const res = await post({ password: 'Correct1pass' }, { customerId: 1000012 });
    expect(res.statusCode).toBe(429);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('the right password closes the account and clears the login cookie', async () => {
    passwordLookup(hash);
    db.txQuery
      .mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }]))
      .mockResolvedValueOnce(result([{ n: 0 }]))
      .mockResolvedValueOnce(result([], 0))
      .mockResolvedValueOnce(result([], 1));
    const res = await post({ password: 'Correct1pass' }, { customerId: 1000013 });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toMatch(/pos_token=;/);
    expect(txSql()).toMatch(/UPDATE CUSTOMER SET Marked_for_deletion = 1/);
  });

  test('an open return gives 409 and the cookie stays', async () => {
    passwordLookup(hash);
    db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ n: 1 }]));
    const res = await post({ password: 'Correct1pass' }, { customerId: 1000014 });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('OPEN_RETURN');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
