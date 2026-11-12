// Part 3 tests: returns, rewards and the rewards report. The database is faked, so these run without SQL Server:
// they check the endpoints' rules and responses. The triggers themselves (TR_PRODUCT_RETURN_ITEM_Guard,
// TR_PRODUCT_RETURN_Refunded) are tested in db/core/test_guards.sql, cases 21 to 39.
jest.mock('../lib/db', () => {
  const sql = jest.requireActual('mssql');
  return { sql, query: jest.fn(), withTransaction: jest.fn() };
});

const db = require('../lib/db');
const { signToken } = require('../lib/auth');
const { mockReq, mockRes } = require('./helpers');
const { refundFor } = require('../lib/returns');
const returns = require('../server/returns');
const eligibilityApi = require('../server/returns/eligibility');
const oneReturn = require('../server/returns/[id]');
const rewards = require('../server/rewards');
const rewardsReport = require('../server/reports/rewards');

const CUSTOMER = 1000001;
const STAFF = 1000500;
const ORDER = 1000123;
const P1 = 1000002;
const P2 = 1000003;
const NEW_RETURN = 1000900;
const rows = (recordset = [], affected = 1) => ({ recordset, rowsAffected: [affected] });
const sqlError = (number, message) => Object.assign(new Error(message), { number });

async function call(handler, { method = 'GET', body, query = {}, role = 'customer', userId } = {}) {
  const id = userId || (role === 'customer' ? CUSTOMER : STAFF);
  const cookie = role ? `pos_token=${signToken({ id, role, name: 'Test' })}` : '';
  const req = mockReq({ method, body, headers: { cookie } });
  req.query = query;
  const res = mockRes();
  await handler(req, res);
  return res;
}

// ---- the standard sale: P1 2 x 20.00 = 40.00, P2 3 x 20.00 = 60.00; subtotal 100.00, tax 8.25 ----
const sale = (extra = {}) => ({
  id: ORDER, status: 'completed', date: '2026-10-20T10:00:00.000Z', subtotal: '100.00', tax: '8.25', total: '108.25',
  deadline: '2026-11-19', daysLeft: 20, expired: false, ...extra,
});
const line = (extra = {}) => ({ productId: P1, name: 'Kingdom of Embers', purchased: 2, returned: 0, lineTotal: '40.00', ...extra });
const lineTwo = (extra = {}) => ({ productId: P2, name: 'Pro Controller', purchased: 3, returned: 0, lineTotal: '60.00', ...extra });

// Answers the questions both db.query and tx.query get about the sale.
function saleAnswers({ saleRow = sale(), lines = [line(), lineTwo()] } = {}) {
  return (text) => {
    if (text.startsWith('SELECT Customer_id FROM CUSTOMER')) return rows([{ Customer_id: CUSTOMER }]);
    if (text.includes('s.Transaction_id AS id, s.Status AS status')) return rows(saleRow ? [saleRow] : []);
    if (text.includes('FROM TRANSACTION_ITEM ti')) return rows(lines);
    return undefined;
  };
}

let tx;
function fakeTx(extra = {}) {
  tx = { query: jest.fn() };
  db.withTransaction.mockImplementation(async (fn) => fn(tx));
  const base = saleAnswers(extra.sale);
  tx.query.mockImplementation(async (text, params) => {
    if (text.startsWith('SELECT Customer_id FROM CUSTOMER WITH (UPDLOCK')) return rows([{ Customer_id: CUSTOMER }]);
    if (extra.onInsert) {
      const forced = extra.onInsert(text, params);
      if (forced) return forced;
    }
    if (text.startsWith('INSERT INTO PRODUCT_RETURN_ITEM')) return rows([], 1);
    if (text.startsWith('INSERT INTO PRODUCT_RETURN ')) return rows([{ id: NEW_RETURN }]);
    return base(text, params);
  });
}

function fakeDb(answer) {
  db.query.mockImplementation(async (text, params) => {
    const out = answer(text, params);
    if (out !== undefined) return out;
    if (text.startsWith('SELECT Customer_id FROM CUSTOMER')) return rows([{ Customer_id: CUSTOMER }]);
    throw new Error('unexpected query: ' + text.slice(0, 80));
  });
}

const returnRow = (extra = {}) => ({
  id: NEW_RETURN, orderId: ORDER, requestedAt: '2026-10-22T10:00:00.000Z', status: 'requested', reason: 'Changed my mind',
  refundTotal: '21.65', refundedAt: null, customerId: CUSTOMER, customerName: 'Alice Nguyen', handledBy: null, ...extra,
});
const returnItems = [{ returnId: NEW_RETURN, productId: P1, name: 'Kingdom of Embers', quantity: 1, refundAmount: '21.65' }];

// db.query answers for loadReturns: the returns, then their items
function returnsAnswers(list = [returnRow()], items = returnItems) {
  return (text) => {
    if (text.includes('FROM PRODUCT_RETURN r') && text.includes('GROUP BY r.Status')) {
      return rows([{ status: 'requested', count: 3 }, { status: 'approved', count: 1 }, { status: 'refunded', count: 2 }]);
    }
    if (text.includes('FROM PRODUCT_RETURN r')) return rows(list);
    if (text.includes('FROM PRODUCT_RETURN_ITEM ri')) return rows(items);
    return undefined;
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = 'returns-tests-use-a-local-secret-with-32-characters';
  db.query.mockReset();
  db.withTransaction.mockReset();
});

// ------------------------------------------------------------------------------------------------
describe('refundFor (the formula of the database guard)', () => {
  test('1 of 2 units: (40.00 + 8.25 * 40 / 100) / 2 = 21.65', () => {
    expect(refundFor({ lineTotal: '40.00', subtotal: '100.00', tax: '8.25', purchased: 2, quantity: 1 })).toBe(21.65);
  });

  test('the whole line gets the whole line plus its share of tax', () => {
    expect(refundFor({ lineTotal: '40.00', subtotal: '100.00', tax: '8.25', purchased: 2, quantity: 2 })).toBe(43.3);
    expect(refundFor({ lineTotal: '60.00', subtotal: '100.00', tax: '8.25', purchased: 3, quantity: 3 })).toBe(64.95);
  });

  test('half a cent rounds up, like ROUND(x, 2)', () => {
    // 0.05 line, no tax, 1 of 2 units = 0.025 -> 0.03
    expect(refundFor({ lineTotal: '0.05', subtotal: '100.00', tax: '0.00', purchased: 2, quantity: 1 })).toBe(0.03);
  });

  test('a sale with a subtotal of 0 refunds 0 and does not divide by zero', () => {
    expect(refundFor({ lineTotal: '0.00', subtotal: '0.00', tax: '0.00', purchased: 1, quantity: 1 })).toBe(0);
  });

  test('a discounted line uses its stored line total (a free line refunds nothing)', () => {
    expect(refundFor({ lineTotal: '0.00', subtotal: '60.00', tax: '4.95', purchased: 2, quantity: 1 })).toBe(0);
  });

  test('is exactly the largest amount the guard accepts, for many random sales', () => {
    // guard (db/core/triggers.sql): 2*L*(S+T)*q + S*n >= 2*R*S*n, all in cents; S = 0 -> 2*L*q + n >= 2*R*n
    const cents = (v) => BigInt(Math.round(v * 100));
    const accepts = (L, S, T, q, n, R) => (S === 0n
      ? 2n * L * q + n >= 2n * R * n
      : 2n * L * (S + T) * q + S * n >= 2n * R * S * n);
    let seed = 12345;
    const rnd = (max) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };
    for (let i = 0; i < 3000; i += 1) {
      const n = 1 + rnd(6);
      const q = 1 + rnd(n);
      const lineTotal = rnd(50000) / 100;
      const subtotal = lineTotal + rnd(50000) / 100;
      const tax = rnd(8000) / 100;
      const refund = refundFor({ lineTotal, subtotal, tax, purchased: n, quantity: q });
      const L = cents(lineTotal); const S = cents(subtotal); const T = cents(tax);
      expect(accepts(L, S, T, BigInt(q), BigInt(n), cents(refund))).toBe(true);
      expect(accepts(L, S, T, BigInt(q), BigInt(n), cents(refund) + 1n)).toBe(false);
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe('request a return (POST /api/returns)', () => {
  const body = (extra = {}) => ({ orderId: ORDER, reason: 'Changed my mind', items: [{ productId: P1, quantity: 1 }], ...extra });
  const inserts = () => tx.query.mock.calls.filter(([text]) => text.startsWith('INSERT'));

  beforeEach(() => {
    fakeTx();
    fakeDb(saleAnswers());
  });

  test('creates the return and its item with the refund from the formula', async () => {
    const res = await call(returns, { method: 'POST', body: body() });
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ returnId: NEW_RETURN });
    const [head, item] = inserts();
    expect(head[0]).toMatch(/INSERT INTO PRODUCT_RETURN \(Transaction_id, Reason, Refund_total\)/);
    expect(head[1]).toMatchObject({ orderId: ORDER, reason: 'Changed my mind' });
    expect(head[1].total.value).toBe(21.65);
    expect(item[1]).toMatchObject({ returnId: NEW_RETURN, productId: P1, quantity: 1 });
    expect(item[1].refund.value).toBe(21.65);
  });

  test('never sets the status, the handler or the date: the database defaults do', async () => {
    await call(returns, { method: 'POST', body: body() });
    const [head] = inserts();
    expect(head[0]).not.toMatch(/Status|Employee_id|Requested_at/);
  });

  test('two lines: the return total is the sum of the item refunds', async () => {
    const res = await call(returns, { method: 'POST', body: body({ items: [{ productId: P1, quantity: 2 }, { productId: P2, quantity: 1 }] }) });
    expect(res.statusCode).toBe(201);
    const [head, a, b] = inserts();
    expect(a[1].refund.value).toBe(43.3);
    expect(b[1].refund.value).toBe(21.65);
    expect(head[1].total.value).toBe(64.95);
  });

  test('takes the customer id from the login, locks the customer row, and checks the order belongs to them', async () => {
    await call(returns, { method: 'POST', body: body(), userId: 1000077 });
    expect(tx.query.mock.calls[0][0]).toMatch(/WITH \(UPDLOCK, HOLDLOCK\)/);
    const saleCall = tx.query.mock.calls.find(([text]) => text.includes('s.Transaction_id AS id, s.Status AS status'));
    expect(saleCall[1]).toEqual({ orderId: ORDER, customerId: 1000077 });
  });

  test('rejects a request that carries a customer id, a refund amount or any other field', async () => {
    for (const extra of [{ customerId: 1000002 }, { refundTotal: 1 }, { status: 'refunded' }]) {
      const res = await call(returns, { method: 'POST', body: body(extra) });
      expect(res.statusCode).toBe(400);
    }
    expect((await call(returns, { method: 'POST', body: body({ items: [{ productId: P1, quantity: 1, refundAmount: 99 }] }) })).statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['no reason', { reason: '' }],
    ['a reason that is only spaces', { reason: '   ' }],
    ['a reason over 200 characters', { reason: 'x'.repeat(201) }],
    ['no items', { items: [] }],
    ['items that are not a list', { items: 'all' }],
    ['more than 50 items', { items: Array.from({ length: 51 }, (_, i) => ({ productId: 1000000 + i, quantity: 1 })) }],
    ['an item that is not an object', { items: [5] }],
    ['quantity 0', { items: [{ productId: P1, quantity: 0 }] }],
    ['a negative quantity', { items: [{ productId: P1, quantity: -1 }] }],
    ['a fractional quantity', { items: [{ productId: P1, quantity: 1.5 }] }],
    ['the same product twice', { items: [{ productId: P1, quantity: 1 }, { productId: P1, quantity: 1 }] }],
    ['a product id that is not 7 digits', { items: [{ productId: 5, quantity: 1 }] }],
    ['an order id that is not 7 digits', { orderId: 42 }],
    ['no order id', { orderId: undefined }],
  ])('400 for %s', async (_label, extra) => {
    const res = await call(returns, { method: 'POST', body: body(extra) });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('another customer\'s order, a missing order and an open order are all 404', async () => {
    fakeTx({ sale: { saleRow: null } });
    const res = await call(returns, { method: 'POST', body: body() });
    expect(res.statusCode).toBe(404);
    expect(inserts()).toHaveLength(0);
  });

  test('a voided order cannot be returned', async () => {
    fakeTx({ sale: { saleRow: sale({ status: 'voided' }) } });
    const res = await call(returns, { method: 'POST', body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/completed orders/);
    expect(inserts()).toHaveLength(0);
  });

  test('after 30 days the request is refused with the last day named', async () => {
    fakeTx({ sale: { saleRow: sale({ expired: true, deadline: '2026-09-18', daysLeft: -36 }) } });
    const res = await call(returns, { method: 'POST', body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({ code: 'WINDOW_CLOSED' });
    expect(res.json.error).toMatch(/30-day/);
    expect(res.json.error).toMatch(/2026-09-18/);
    expect(inserts()).toHaveLength(0);
  });

  test('a product that is not part of the order is refused', async () => {
    const res = await call(returns, { method: 'POST', body: body({ items: [{ productId: 1000999, quantity: 1 }] }) });
    expect(res.statusCode).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  test('more than is left to return is refused, and the message says how many are left', async () => {
    fakeTx({ sale: { lines: [line({ returned: 1 }), lineTwo()] } });
    const res = await call(returns, { method: 'POST', body: body({ items: [{ productId: P1, quantity: 2 }] }) });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/Only 1 of Kingdom of Embers/);
    expect(res.json.error).toMatch(/1 already on other returns/);
    expect(inserts()).toHaveLength(0);
  });

  test('a product that was already returned in full is refused', async () => {
    fakeTx({ sale: { lines: [line({ returned: 2 }), lineTwo()] } });
    const res = await call(returns, { method: 'POST', body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/already been returned/);
  });

  test('if the database guard still says no, its message reaches the customer as a 409', async () => {
    fakeTx({ onInsert: (text) => (text.startsWith('INSERT INTO PRODUCT_RETURN_ITEM') ? Promise.reject(sqlError(50008, 'Returns must be requested within 30 days of the sale.')) : undefined) });
    const res = await call(returns, { method: 'POST', body: body() });
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({ code: 'RULE_VIOLATION', error: 'Returns must be requested within 30 days of the sale.' });
  });

  test('another database error is a generic 500 with no details', async () => {
    fakeTx({ onInsert: (text) => (text.startsWith('INSERT INTO PRODUCT_RETURN ') ? Promise.reject(sqlError(2714, 'There is already an object named secret_table')) : undefined) });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(returns, { method: 'POST', body: body() });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/secret_table/);
  });

  test('staff and signed-out visitors cannot request a return', async () => {
    expect((await call(returns, { method: 'POST', body: body(), role: 'support' })).statusCode).toBe(403);
    expect((await call(returns, { method: 'POST', body: body(), role: 'manager' })).statusCode).toBe(403);
    expect((await call(returns, { method: 'POST', body: body(), role: null })).statusCode).toBe(401);
  });

  test('only GET and POST are accepted', async () => {
    const res = await call(returns, { method: 'DELETE' });
    expect(res.statusCode).toBe(405);
  });
});

// ------------------------------------------------------------------------------------------------
describe('lists of returns (GET /api/returns)', () => {
  test('a customer gets only their own, newest first, with the items inside', async () => {
    fakeDb(returnsAnswers());
    const res = await call(returns, { userId: 1000042 });
    expect(res.statusCode).toBe(200);
    expect(res.json.returns).toHaveLength(1);
    expect(res.json.returns[0]).toMatchObject({ id: NEW_RETURN, status: 'requested', refundTotal: '21.65' });
    expect(res.json.returns[0].items).toEqual([{ productId: P1, name: 'Kingdom of Embers', quantity: 1, refundAmount: '21.65' }]);
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r'));
    expect(head[0]).toMatch(/s\.Customer_id = @customerId/);
    expect(head[0]).toMatch(/ORDER BY r\.Requested_at DESC/);
    expect(head[1]).toEqual({ customerId: 1000042 });
    expect(res.json.counts).toBeUndefined();
  });

  test('every query leaves out rows flagged as deleted, including the joined tables', async () => {
    fakeDb(returnsAnswers());
    await call(returns);
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r'))[0];
    expect(head).toMatch(/r\.Marked_for_deletion = 0/);
    expect(head).toMatch(/s\.Marked_for_deletion = 0/);
    expect(head).toMatch(/c\.Marked_for_deletion = 0/);
    const items = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN_ITEM ri'))[0];
    expect(items).toMatch(/ri\.Marked_for_deletion = 0/);
  });

  test('items are fetched with the ids as one JSON parameter, not glued into the SQL', async () => {
    fakeDb(returnsAnswers());
    await call(returns);
    const items = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN_ITEM ri'));
    expect(items[1]).toEqual({ ids: JSON.stringify([NEW_RETURN]) });
    expect(items[0]).not.toContain(String(NEW_RETURN));
  });

  test('a customer with no returns gets an empty list and no item query', async () => {
    fakeDb(returnsAnswers([]));
    const res = await call(returns);
    expect(res.json.returns).toEqual([]);
    expect(db.query.mock.calls.some(([text]) => text.includes('FROM PRODUCT_RETURN_ITEM ri'))).toBe(false);
  });

  test('a customer cannot widen the list with ?status', async () => {
    fakeDb(returnsAnswers());
    await call(returns, { query: { status: 'all' } });
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r'));
    expect(head[1]).toEqual({ customerId: CUSTOMER });
  });

  test('staff see the waiting returns, oldest first, with a count for every status', async () => {
    fakeDb(returnsAnswers());
    const res = await call(returns, { role: 'support' });
    expect(res.statusCode).toBe(200);
    expect(res.json.counts).toEqual({ requested: 3, approved: 1, denied: 0, refunded: 2 });
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r') && !text.includes('GROUP BY'));
    expect(head[1]).toEqual({ status: 'requested' });
    expect(head[0]).toMatch(/ORDER BY r\.Requested_at ASC/);
    expect(head[0]).not.toMatch(/Customer_id = @customerId/);
  });

  test.each(['approved', 'denied', 'refunded'])('staff can ask for %s returns, newest first', async (status) => {
    fakeDb(returnsAnswers());
    await call(returns, { role: 'manager', query: { status } });
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r') && !text.includes('GROUP BY'));
    expect(head[1]).toEqual({ status });
    expect(head[0]).toMatch(/ORDER BY r\.Requested_at DESC/);
  });

  test('status=all lists every status', async () => {
    fakeDb(returnsAnswers());
    await call(returns, { role: 'manager', query: { status: 'all' } });
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r') && !text.includes('GROUP BY'));
    expect(head[1]).toEqual({});
    expect(head[0]).not.toMatch(/Status = @status/);
  });

  test('an unknown status is a 400', async () => {
    fakeDb(returnsAnswers());
    const res = await call(returns, { role: 'support', query: { status: "x'; DROP TABLE PRODUCT_RETURN;--" } });
    expect(res.statusCode).toBe(400);
  });

  test('signed-out visitors get 401', async () => {
    expect((await call(returns, { role: null })).statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------------
describe('what can still be returned (GET /api/returns/eligibility)', () => {
  test('lists every line with the exact refund for 1, 2, ... units', async () => {
    fakeDb(saleAnswers());
    const res = await call(eligibilityApi, { query: { order: String(ORDER) } });
    expect(res.statusCode).toBe(200);
    expect(res.json.order).toMatchObject({ id: ORDER, status: 'completed', deadline: '2026-11-19', daysLeft: 20, canReturn: true, blockedReason: null });
    expect(res.json.items[0]).toMatchObject({ productId: P1, name: 'Kingdom of Embers', purchased: 2, returned: 0, available: 2, refunds: [21.65, 43.3] });
    expect(res.json.items[1]).toMatchObject({ productId: P2, available: 3, refunds: [21.65, 43.3, 64.95] });
  });

  test('units already on other returns are taken off', async () => {
    fakeDb(saleAnswers({ lines: [line({ returned: 1 }), lineTwo({ returned: 3 })] }));
    const res = await call(eligibilityApi, { query: { order: String(ORDER) } });
    expect(res.json.items[0]).toMatchObject({ returned: 1, available: 1, refunds: [21.65] });
    expect(res.json.items[1]).toMatchObject({ returned: 3, available: 0, refunds: [] });
    expect(res.json.order.canReturn).toBe(true);
  });

  test('everything already returned: blocked as nothing_left', async () => {
    fakeDb(saleAnswers({ lines: [line({ returned: 2 }), lineTwo({ returned: 3 })] }));
    const res = await call(eligibilityApi, { query: { order: String(ORDER) } });
    expect(res.json.order).toMatchObject({ canReturn: false, blockedReason: 'nothing_left' });
  });

  test('past the window: blocked as expired, days left never negative', async () => {
    fakeDb(saleAnswers({ saleRow: sale({ expired: true, daysLeft: -5, deadline: '2026-10-01' }) }));
    const res = await call(eligibilityApi, { query: { order: String(ORDER) } });
    expect(res.json.order).toMatchObject({ canReturn: false, blockedReason: 'expired', daysLeft: 0, deadline: '2026-10-01' });
  });

  test('a voided order is blocked as voided', async () => {
    fakeDb(saleAnswers({ saleRow: sale({ status: 'voided' }) }));
    const res = await call(eligibilityApi, { query: { order: String(ORDER) } });
    expect(res.json.order).toMatchObject({ canReturn: false, blockedReason: 'voided' });
  });

  test('scopes by the signed-in customer, and a missing or foreign order is 404', async () => {
    fakeDb(saleAnswers({ saleRow: null }));
    const res = await call(eligibilityApi, { query: { order: String(ORDER) }, userId: 1000055 });
    expect(res.statusCode).toBe(404);
    const saleCall = db.query.mock.calls.find(([text]) => text.includes('s.Transaction_id AS id, s.Status AS status'));
    expect(saleCall[1]).toEqual({ orderId: ORDER, customerId: 1000055 });
  });

  test('bad or missing order id is 400; staff 403; signed out 401', async () => {
    fakeDb(saleAnswers());
    expect((await call(eligibilityApi, { query: { order: 'abc' } })).statusCode).toBe(400);
    expect((await call(eligibilityApi, { query: {} })).statusCode).toBe(400);
    expect((await call(eligibilityApi, { query: { order: String(ORDER) }, role: 'support' })).statusCode).toBe(403);
    expect((await call(eligibilityApi, { query: { order: String(ORDER) }, role: null })).statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------------
describe('approve, deny and refund (PATCH /api/returns/:id)', () => {
  const patch = (action, extra = {}) => call(oneReturn, { method: 'PATCH', query: { id: String(NEW_RETURN) }, body: { action }, role: 'support', ...extra });
  const update = () => db.query.mock.calls.find(([text]) => text.startsWith('UPDATE PRODUCT_RETURN'));

  // the UPDATE changes one row (or `affected`), the rest answers like the list does
  function fakeUpdate(affected = 1, then = {}) {
    fakeDb((text, params) => {
      if (text.startsWith('UPDATE PRODUCT_RETURN')) return rows([], affected);
      if (text.startsWith('SELECT Status AS status FROM PRODUCT_RETURN')) return rows(then.current === undefined ? [] : [{ status: then.current }]);
      return returnsAnswers([returnRow({ status: then.status || 'approved', handledBy: 'Sam' })])(text, params);
    });
  }

  test('approve saves the handler from the login and only moves a requested return', async () => {
    fakeUpdate(1, { status: 'approved' });
    const res = await patch('approve', { userId: 1000321 });
    expect(res.statusCode).toBe(200);
    expect(res.json.return).toMatchObject({ id: NEW_RETURN, status: 'approved', handledBy: 'Sam' });
    const [text, params] = update();
    expect(text).toMatch(/Status = 'approved', Employee_id = @employeeId/);
    expect(text).toMatch(/WHERE Return_id = @returnId AND Status = @from AND Marked_for_deletion = 0/);
    expect(params).toMatchObject({ returnId: NEW_RETURN, from: 'requested', employeeId: 1000321 });
  });

  test('deny saves the handler and only moves a requested return', async () => {
    fakeUpdate(1, { status: 'denied' });
    const res = await patch('deny', { role: 'manager', userId: 1000322 });
    expect(res.statusCode).toBe(200);
    const [text, params] = update();
    expect(text).toMatch(/Status = 'denied', Employee_id = @employeeId/);
    expect(params).toMatchObject({ from: 'requested', employeeId: 1000322 });
  });

  test('refund only moves an approved return, sets Refunded_at, and leaves the handler alone', async () => {
    fakeUpdate(1, { status: 'refunded' });
    const res = await patch('refund');
    expect(res.statusCode).toBe(200);
    const [text, params] = update();
    expect(text).toMatch(/Status = 'refunded', Refunded_at = SYSDATETIME\(\)/);
    expect(text).not.toMatch(/Employee_id\s*=/);
    expect(params.from).toBe('approved');
  });

  test('the app never touches stock or points itself on a refund', async () => {
    fakeUpdate(1, { status: 'refunded' });
    await patch('refund');
    const sqlText = db.query.mock.calls.map(([text]) => text).join('\n');
    expect(sqlText).not.toMatch(/UPDATE PRODUCT\b|Stock_quantity\s*=|INSERT INTO LOYALTY_TRANSACTION|UPDATE CUSTOMER/);
  });

  test('a return that was already handled is a 409 naming its status', async () => {
    fakeUpdate(0, { current: 'approved' });
    const res = await patch('approve');
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({ code: 'ALREADY_HANDLED' });
    expect(res.json.error).toMatch(/already approved/);
  });

  test('refunding a return that is not approved yet is a 409', async () => {
    fakeUpdate(0, { current: 'requested' });
    const res = await patch('refund');
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/cannot be refunded: it is already requested/);
  });

  test('a return that does not exist is a 404', async () => {
    fakeUpdate(0, {});
    expect((await patch('approve')).statusCode).toBe(404);
  });

  test('refund fails with a readable message when the customer no longer has the points (CHECK 547)', async () => {
    fakeDb((text) => {
      if (text.startsWith('UPDATE PRODUCT_RETURN')) {
        return Promise.reject(sqlError(547, 'The UPDATE statement conflicted with the CHECK constraint "CK_CUSTOMER_Points". The conflict occurred in database "pos_store", table "dbo.CUSTOMER", column \'Loyalty_points\'.'));
      }
      return undefined;
    });
    const res = await patch('refund');
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({ code: 'POINTS_SPENT' });
    expect(res.json.error).toMatch(/no longer has enough loyalty points/);
    expect(res.body).not.toMatch(/CK_CUSTOMER_Points|pos_store/);
  });

  test('the trigger\'s own negative-balance error (50001) gets the same readable message', async () => {
    fakeDb((text) => (text.startsWith('UPDATE PRODUCT_RETURN') ? Promise.reject(sqlError(50001, 'Loyalty points balance cannot be negative.')) : undefined));
    const res = await patch('refund');
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('POINTS_SPENT');
  });

  test('other rule errors from the triggers pass through as 409 (error 50009)', async () => {
    fakeDb((text) => (text.startsWith('UPDATE PRODUCT_RETURN') ? Promise.reject(sqlError(50009, 'A return must be approved before it can be refunded.')) : undefined));
    const res = await patch('refund');
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toBe('A return must be approved before it can be refunded.');
  });

  test('an unrelated CHECK failure (547) is still a generic 500', async () => {
    fakeDb((text) => (text.startsWith('UPDATE PRODUCT_RETURN') ? Promise.reject(sqlError(547, 'conflicted with the CHECK constraint "CK_PRODUCT_RETURN_Dates"')) : undefined));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await patch('refund');
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/CK_PRODUCT_RETURN_Dates/);
  });

  test.each([
    ['an unknown action', { action: 'delete' }],
    ['no action', {}],
    ['an action that is not text', { action: 5 }],
    ['an extra field', { action: 'approve', employeeId: 1000999 }],
    ['a status instead of an action', { status: 'refunded' }],
  ])('400 for %s', async (_label, body) => {
    fakeUpdate();
    const res = await call(oneReturn, { method: 'PATCH', query: { id: String(NEW_RETURN) }, body, role: 'support' });
    expect(res.statusCode).toBe(400);
    expect(update()).toBeUndefined();
  });

  test('a bad return id is a 400', async () => {
    fakeUpdate();
    const res = await call(oneReturn, { method: 'PATCH', query: { id: 'abc' }, body: { action: 'approve' }, role: 'support' });
    expect(res.statusCode).toBe(400);
  });

  test('customers cannot approve, deny or refund; signed-out visitors get 401', async () => {
    fakeUpdate();
    for (const action of ['approve', 'deny', 'refund']) {
      expect((await patch(action, { role: 'customer' })).statusCode).toBe(403);
    }
    expect((await patch('approve', { role: null })).statusCode).toBe(401);
    expect(update()).toBeUndefined();
  });
});

describe('one return (GET /api/returns/:id)', () => {
  test('a customer can open only their own return', async () => {
    fakeDb(returnsAnswers());
    const res = await call(oneReturn, { query: { id: String(NEW_RETURN) }, userId: 1000042 });
    expect(res.statusCode).toBe(200);
    expect(res.json.return.items).toHaveLength(1);
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r'));
    expect(head[0]).toMatch(/s\.Customer_id = @customerId/);
    expect(head[1]).toEqual({ returnId: NEW_RETURN, customerId: 1000042 });
  });

  test('staff can open any return', async () => {
    fakeDb(returnsAnswers());
    const res = await call(oneReturn, { query: { id: String(NEW_RETURN) }, role: 'manager' });
    expect(res.statusCode).toBe(200);
    const head = db.query.mock.calls.find(([text]) => text.includes('FROM PRODUCT_RETURN r'));
    expect(head[1]).toEqual({ returnId: NEW_RETURN });
  });

  test('a missing or foreign return is a 404; a bad id is a 400; signed out is 401', async () => {
    fakeDb(returnsAnswers([]));
    expect((await call(oneReturn, { query: { id: String(NEW_RETURN) } })).statusCode).toBe(404);
    expect((await call(oneReturn, { query: { id: '12' } })).statusCode).toBe(400);
    expect((await call(oneReturn, { query: { id: String(NEW_RETURN) }, role: null })).statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------------
describe('rewards (GET /api/rewards)', () => {
  const TIERS = [
    { name: 'Bronze', minPoints: 100, perk: 'Birthday coupon' },
    { name: 'Silver', minPoints: 500, perk: 'Free shipping' },
    { name: 'Gold', minPoints: 1000, perk: 'Early access' },
  ];
  const HISTORY = [
    { id: 1000012, date: '2026-10-22T12:00:00.000Z', points: -40, reason: 'Return refund', orderId: ORDER, balanceAfter: 160 },
    { id: 1000011, date: '2026-10-20T12:00:00.000Z', points: 200, reason: 'Purchase', orderId: ORDER, balanceAfter: 200 },
  ];
  function fakeRewards({ me, program = { id: 1000000, name: 'Standard rewards', pointsPerDollar: '1.00' }, tiers = TIERS, history = HISTORY } = {}) {
    fakeDb((text) => {
      if (text.includes('FROM CUSTOMER c')) return rows(me ? [me] : []);
      if (text.includes('FROM REWARD_PROGRAM')) return rows(program ? [program] : []);
      if (text.includes('FROM LOYALTY_TRANSACTION lt')) return rows(history);
      if (text.includes('FROM REWARD_TIER WHERE Program_id')) return rows(tiers);
      return undefined;
    });
  }
  const bronze = { points: 160, tierId: 1000010, tierName: 'Bronze', tierMin: 100, tierPerk: 'Birthday coupon', tierProgramId: 1000000 };

  test('balance, tier, the next tier with the points still needed, and the history', async () => {
    fakeRewards({ me: bronze });
    const res = await call(rewards);
    expect(res.statusCode).toBe(200);
    expect(res.json.points).toBe(160);
    expect(res.json.tier).toEqual({ name: 'Bronze', minPoints: 100, perk: 'Birthday coupon' });
    expect(res.json.nextTier).toEqual({ name: 'Silver', minPoints: 500, perk: 'Free shipping', pointsToGo: 340 });
    expect(res.json.program).toEqual({ name: 'Standard rewards', pointsPerDollar: '1.00' });
    expect(res.json.tiers.map((t) => [t.name, t.reached])).toEqual([['Bronze', true], ['Silver', false], ['Gold', false]]);
    expect(res.json.history).toHaveLength(2);
    expect(res.json.history[0]).toMatchObject({ points: -40, reason: 'Return refund', balanceAfter: 160 });
  });

  test('a customer with no tier yet: tier null, next tier is the first one', async () => {
    fakeRewards({ me: { points: 30, tierId: null, tierName: null, tierMin: null, tierPerk: null, tierProgramId: null } });
    const res = await call(rewards);
    expect(res.json.tier).toBeNull();
    expect(res.json.nextTier).toMatchObject({ name: 'Bronze', pointsToGo: 70 });
    expect(res.json.tiers.every((t) => t.reached === false)).toBe(true);
  });

  test('exactly at a tier minimum counts as reaching it', async () => {
    fakeRewards({ me: { ...bronze, points: 500, tierId: 1000011, tierName: 'Silver', tierMin: 500, tierPerk: 'Free shipping' } });
    const res = await call(rewards);
    expect(res.json.nextTier).toMatchObject({ name: 'Gold', pointsToGo: 500 });
    expect(res.json.tiers.map((t) => t.reached)).toEqual([true, true, false]);
  });

  test('the top tier has no next tier', async () => {
    fakeRewards({ me: { ...bronze, points: 1500, tierId: 1000012, tierName: 'Gold', tierMin: 1000, tierPerk: 'Early access' } });
    const res = await call(rewards);
    expect(res.json.nextTier).toBeNull();
  });

  test('no reward program today: still answers, with no program and no tiers', async () => {
    fakeRewards({ me: { points: 0, tierId: null, tierName: null, tierMin: null, tierPerk: null, tierProgramId: null }, program: null, history: [] });
    const res = await call(rewards);
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({ points: 0, tier: null, nextTier: null, program: null, tiers: [], history: [] });
    expect(db.query.mock.calls.some(([text]) => text.includes('FROM REWARD_TIER WHERE Program_id'))).toBe(false);
  });

  test('reads only the signed-in customer, never takes an id from the request, and filters deleted rows', async () => {
    fakeRewards({ me: bronze });
    await call(rewards, { userId: 1000042, query: { customerId: '1000001' } });
    for (const [text, params] of db.query.mock.calls.filter(([t]) => t.includes('@customerId'))) {
      expect(params.customerId).toBe(1000042);
      expect(text).toMatch(/Marked_for_deletion = 0/);
    }
    const history = db.query.mock.calls.find(([text]) => text.includes('FROM LOYALTY_TRANSACTION lt'))[0];
    expect(history).toMatch(/TOP \(100\)/);
  });

  test('staff and signed-out visitors are refused', async () => {
    fakeRewards({ me: bronze });
    expect((await call(rewards, { role: 'support' })).statusCode).toBe(403);
    expect((await call(rewards, { role: 'manager' })).statusCode).toBe(403);
    expect((await call(rewards, { role: null })).statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------------
describe('rewards report (GET /api/reports/rewards)', () => {
  function fakeReport({ totals, tierCounts, tierDefs, earners } = {}) {
    fakeDb((text) => {
      if (text.includes('SELECT COUNT(*) AS customers')) {
        return rows([totals || { customers: 7, pointsIssued: 2400, pointsTakenBack: 150, pointsOutstanding: 2250, totalSpent: '2400.50' }]);
      }
      if (text.includes('FROM VW_REWARDS_REPORT GROUP BY Tier_name')) {
        return rows(tierCounts || [{ tier: 'Gold', customers: 1, points: 1100 }, { tier: 'No tier', customers: 3, points: 40 }, { tier: 'Silver', customers: 2, points: 900 }]);
      }
      if (text.includes('FROM REWARD_TIER')) {
        return rows(tierDefs || [{ tier: 'Gold', minPoints: 1000 }, { tier: 'Bronze', minPoints: 100 }, { tier: 'Silver', minPoints: 500 }]);
      }
      if (text.includes('TOP (@top)')) {
        return rows(earners || [{ customerId: CUSTOMER, name: 'Alice Nguyen', tier: 'Gold', pointsEarned: 1250, pointsTakenBack: 150, balance: 1100, orders: 3, totalSpent: '1250.00', lastActivity: '2026-10-22T12:00:00.000Z' }]);
      }
      return undefined;
    });
  }

  test('points issued and taken back, customers per tier (lowest first), and the top earners', async () => {
    fakeReport();
    const res = await call(rewardsReport, { role: 'manager' });
    expect(res.statusCode).toBe(200);
    expect(res.json.totals).toEqual({ customers: 7, pointsIssued: 2400, pointsTakenBack: 150, pointsOutstanding: 2250, totalSpent: 2400.5 });
    expect(res.json.tiers.map((t) => [t.tier, t.customers])).toEqual([['No tier', 3], ['Bronze', 0], ['Silver', 2], ['Gold', 1]]);
    expect(res.json.topEarners[0]).toMatchObject({ customerId: CUSTOMER, name: 'Alice Nguyen', pointsEarned: 1250, pointsTakenBack: 150, balance: 1100 });
  });

  test('top earners default to 10 and can be changed from 1 to 50', async () => {
    fakeReport();
    await call(rewardsReport, { role: 'manager' });
    await call(rewardsReport, { role: 'manager', query: { top: '25' } });
    const tops = db.query.mock.calls.filter(([text]) => text.includes('TOP (@top)')).map(([, params]) => params.top);
    expect(tops).toEqual([10, 25]);
  });

  test.each(['0', '51', 'abc', '2.5', '-1'])('top=%s is a 400', async (top) => {
    fakeReport();
    const res = await call(rewardsReport, { role: 'manager', query: { top } });
    expect(res.statusCode).toBe(400);
  });

  test('with no customers it still answers with zeros and an empty list', async () => {
    fakeReport({ totals: { customers: 0, pointsIssued: 0, pointsTakenBack: 0, pointsOutstanding: 0, totalSpent: '0.00' }, tierCounts: [], tierDefs: [], earners: [] });
    const res = await call(rewardsReport, { role: 'manager' });
    expect(res.statusCode).toBe(200);
    expect(res.json.totals.customers).toBe(0);
    expect(res.json.tiers).toEqual([{ tier: 'No tier', customers: 0, points: 0, minPoints: 0 }]);
    expect(res.json.topEarners).toEqual([]);
  });

  test('lists only customers who earned something, best first', async () => {
    fakeReport();
    await call(rewardsReport, { role: 'manager' });
    const text = db.query.mock.calls.find(([t]) => t.includes('TOP (@top)'))[0];
    expect(text).toMatch(/WHERE Points_earned > 0/);
    expect(text).toMatch(/ORDER BY Points_earned DESC/);
  });

  test('managers only: support, customers and visitors are refused', async () => {
    fakeReport();
    expect((await call(rewardsReport, { role: 'support' })).statusCode).toBe(403);
    expect((await call(rewardsReport, { role: 'customer' })).statusCode).toBe(403);
    expect((await call(rewardsReport, { role: null })).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('never exposes emails or password hashes', async () => {
    fakeReport();
    const res = await call(rewardsReport, { role: 'manager' });
    expect(res.body).not.toMatch(/email|password/i);
    const sqlText = db.query.mock.calls.map(([text]) => text).join('\n');
    expect(sqlText).not.toMatch(/Email|Password/);
  });
});
