// Part 2 tests: checkout, orders and the sales report. The database is faked, so
// these run without SQL Server: they check each endpoint's rules and responses.
// (sp_Checkout itself is tested by db/checkout/test.sql.)
jest.mock('../lib/db', () => {
  const sql = jest.requireActual('mssql');
  return { sql, query: jest.fn(), withTransaction: jest.fn() };
});

const db = require('../lib/db');
const { signToken } = require('../lib/auth');
const { mockReq, mockRes } = require('./helpers');
const checkout = require('../server/checkout');
const orders = require('../server/orders');
const order = require('../server/orders/[id]');
const sales = require('../server/reports/sales');

const CUSTOMER = 1000001;
const ORDER = 1000123;
const result = (rows = []) => ({ recordset: rows, recordsets: [rows] });

async function call(handler, { method = 'GET', body, query = {}, role = 'customer', userId = CUSTOMER } = {}) {
  const cookie = role ? `pos_token=${signToken({ id: userId, role, name: 'Test' })}` : '';
  const req = mockReq({ method, body, headers: { cookie } });
  req.query = query;
  const res = mockRes();
  await handler(req, res);
  return res;
}

// Makes db.query answer with whatever `answer(text, params)` returns.
const fakeDb = (answer) => db.query.mockImplementation(async (text, params) => answer(text, params));

beforeEach(() => {
  process.env.JWT_SECRET = 'checkout-tests-use-a-local-secret-with-32-characters';
  db.query.mockReset();
});

// ---------------------------------------------------------------- GET /api/checkout
describe('checkout page data (GET /api/checkout)', () => {
  const ADDRESS = { Recipient_name: 'Alice Nguyen', Street: '1200 Main St', Apt: 'Apt 4B', City: 'Houston', State: 'TX', Zip: '77002' };
  // one row as readCart() gets it from SQL (it adds the cart totals to every row)
  const row = (extra = {}) => ({
    id: 1000002, name: 'Kingdom of Embers', price: '59.99', quantity: 2, stock: 35,
    discountName: 'Embers Launch 25% off', discountAmount: '30.00', lineTotal: '89.98',
    isActive: true, available: true, cartSubtotal: '89.98', cartQuantity: 2, ...extra,
  });
  const cart = (rows, address = ADDRESS) =>
    fakeDb((text) => (text.includes('FROM CUSTOMER_ADDRESS') ? result(address ? [address] : []) : result(rows)));

  test('returns the discounted cart, its subtotal and the default address', async () => {
    cart([row()]);
    const res = await call(checkout);
    expect(res.statusCode).toBe(200);
    expect(res.json.subtotal).toBe(89.98);
    expect(res.json.address).toEqual(ADDRESS);
    expect(res.json.canCheckout).toBe(true);
    expect(res.json.items).toHaveLength(1);
    expect(res.json.items[0]).toMatchObject({ id: 1000002, name: 'Kingdom of Embers', quantity: 2, discountAmount: '30.00', lineTotal: '89.98' });
    // the cart totals belong to the response, not to every item
    expect(res.json.items[0]).not.toHaveProperty('cartSubtotal');
  });

  test('reads the cart and the address of the signed-in customer only', async () => {
    cart([row()]);
    await call(checkout, { userId: 1000077 });
    expect(db.query.mock.calls.length).toBe(2);
    for (const [, params] of db.query.mock.calls) {
      expect(Object.values(params)).toContain(1000077);
    }
    const addressCall = db.query.mock.calls.find(([text]) => text.includes('FROM CUSTOMER_ADDRESS'));
    expect(addressCall[0]).toMatch(/is_default = 1 AND Marked_for_deletion = 0/);
  });

  test('an empty cart cannot check out', async () => {
    cart([]);
    const res = await call(checkout);
    expect(res.json).toMatchObject({ items: [], subtotal: 0, canCheckout: false });
  });

  test('no default address blocks checkout', async () => {
    cart([row()], null);
    const res = await call(checkout);
    expect(res.json.address).toBeNull();
    expect(res.json.canCheckout).toBe(false);
  });

  test('an unavailable item (inactive or short on stock) blocks checkout', async () => {
    cart([row(), row({ id: 1000003, name: 'Retro Pack', available: false })]);
    const res = await call(checkout);
    expect(res.json.items).toHaveLength(2);
    expect(res.json.canCheckout).toBe(false);
  });

  test('needs a customer login', async () => {
    expect((await call(checkout, { role: null })).statusCode).toBe(401);
    expect((await call(checkout, { role: 'manager' })).statusCode).toBe(403);
    expect((await call(checkout, { role: 'support' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------- POST /api/checkout
describe('place the order (POST /api/checkout)', () => {
  const ok = () => fakeDb(async (text) => (text.startsWith('EXEC sp_Checkout') ? result([{ Transaction_id: ORDER }]) : result()));
  const place = (body, extra = {}) => call(checkout, { method: 'POST', body, ...extra });
  const sqlError = (number, message) => Object.assign(new Error(message), { number });

  test('runs sp_Checkout for the signed-in customer and returns the order number', async () => {
    ok();
    const res = await place({ method: 'credit', cardLast4: '4242' });
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ transactionId: ORDER });
    const [text, params] = db.query.mock.calls.find(([t]) => t.startsWith('EXEC sp_Checkout'));
    expect(text).toBe('EXEC sp_Checkout @Customer_id = @cid, @Method = @method, @Card_last4 = @last4');
    expect(params.cid.value).toBe(CUSTOMER);
    expect(params.method).toBe('credit');
    expect(params.last4).toBe('4242');
  });

  test('accepts debit, in any letter case', async () => {
    ok();
    const res = await place({ method: 'Debit', cardLast4: '1111' });
    expect(res.statusCode).toBe(201);
    expect(db.query.mock.calls[0][1].method).toBe('debit');
  });

  test('the customer comes from the login, never from the request body', async () => {
    ok();
    await place({ method: 'credit', cardLast4: '4242', customerId: 1000999, Customer_id: 1000999 });
    expect(db.query.mock.calls[0][1].cid.value).toBe(CUSTOMER);
  });

  test.each([undefined, '', 'cash', 'paypal', 42])('payment method %p is refused', async (method) => {
    ok();
    const res = await place({ method, cardLast4: '4242' });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe('BAD_METHOD');
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each([undefined, '', '12', '12345', 'abcd', '12 4', 4242.5])('card digits %p are refused', async (cardLast4) => {
    ok();
    const res = await place({ method: 'credit', cardLast4 });
    expect(res.statusCode).toBe(400);
    expect(res.json.code).toBe('BAD_CARD');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a rule from the database is shown to the customer as a 409', async () => {
    db.query.mockRejectedValue(sqlError(50040, 'Your cart is empty.'));
    const res = await place({ method: 'credit', cardLast4: '4242' });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toBe('Your cart is empty.');
  });

  test('"Not enough stock" and "no tax rate" messages also reach the customer', async () => {
    for (const [number, message] of [[50044, 'Not enough stock for "Pro Controller". Update your cart and try again.'], [50043, 'No tax rate was found for an item in your shipping state.']]) {
      db.query.mockRejectedValueOnce(sqlError(number, message));
      const res = await place({ method: 'credit', cardLast4: '4242' });
      expect(res.statusCode).toBe(409);
      expect(res.json.error).toBe(message);
    }
  });

  test('error 547 (the stock changed while paying) becomes a readable 409', async () => {
    db.query.mockRejectedValue(sqlError(547, 'The UPDATE statement conflicted with the CHECK constraint "CK_PRODUCT_Stock"'));
    const res = await place({ method: 'credit', cardLast4: '4242' });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('CHANGED');
    expect(res.json.error).toMatch(/changed while you were checking out/);
    expect(res.json.error).not.toMatch(/CK_PRODUCT/);
  });

  test('any other database failure is a generic 500 with no details', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query.mockRejectedValue(sqlError(208, 'Invalid object name PAYMENT'));
    const res = await place({ method: 'credit', cardLast4: '4242' });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json)).not.toMatch(/PAYMENT|208/);
    console.error.mockRestore();
  });

  test('needs a customer login', async () => {
    expect((await place({ method: 'credit', cardLast4: '4242' }, { role: null })).statusCode).toBe(401);
    expect((await place({ method: 'credit', cardLast4: '4242' }, { role: 'manager' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('other methods are refused', async () => {
    expect((await call(checkout, { method: 'DELETE' })).statusCode).toBe(405);
  });
});

// ------------------------------------------------------------------- GET /api/orders
describe('my orders (GET /api/orders)', () => {
  test('lists the signed-in customer\'s orders', async () => {
    const rows = [
      { Transaction_id: ORDER, Transaction_date: '2026-10-26T15:00:00.000Z', Status: 'completed', Total: 75.76, Items: 3 },
      { Transaction_id: ORDER - 1, Transaction_date: '2026-10-20T15:00:00.000Z', Status: 'completed', Total: 25, Items: 1 },
    ];
    fakeDb(() => result(rows));
    const res = await call(orders);
    expect(res.statusCode).toBe(200);
    expect(res.json.orders).toHaveLength(2);
    expect(res.json.orders[0]).toMatchObject({ Transaction_id: ORDER, Status: 'completed', Total: 75.76, Items: 3 });
    const [text, params] = db.query.mock.calls[0];
    expect(params.cid).toBe(CUSTOMER);
    expect(text).toMatch(/Customer_id = @cid/);
    expect(text).toMatch(/Status <> 'open'/);
    expect(text).toMatch(/Marked_for_deletion = 0/);
    expect(text).toMatch(/ORDER BY s.Transaction_date DESC/);
  });

  test('a customer with no orders gets an empty list', async () => {
    fakeDb(() => result([]));
    expect((await call(orders)).json).toEqual({ orders: [] });
  });

  test('needs a customer login', async () => {
    expect((await call(orders, { role: null })).statusCode).toBe(401);
    expect((await call(orders, { role: 'manager' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------- GET /api/orders/<id>
describe('one order (GET /api/orders/<id>)', () => {
  const HEAD = {
    Transaction_id: ORDER, Transaction_date: '2026-10-26', Status: 'completed', Subtotal: 69.99, Tax_amount: 5.77, Total: 75.76,
    Ship_name: 'Alice Nguyen', Ship_street: '1200 Main St', Ship_apt: null, Ship_city: 'Houston', Ship_state: 'TX', Ship_zip: '77002',
    Tracking_number: `TRK${ORDER}`, Estimated_arrival: '2026-10-31',
  };
  const ITEMS = [{ Product_id: 1000002, Name: 'Pro Controller', Quantity: 1, Unit_price: 69.99, Discount_amount: 0, Line_total: 69.99 }];
  const PAYMENTS = [{ Method: 'credit', Amount: 75.76, Card_last4: '4242', Paid_at: '2026-10-26T15:00:00Z' }];
  const found = () => fakeDb((text) => {
    if (text.includes('FROM SALES_TRANSACTION')) return result([HEAD]);
    if (text.includes('FROM TRANSACTION_ITEM')) return result(ITEMS);
    return result(PAYMENTS);
  });

  test('returns the order, its items and its payments', async () => {
    found();
    const res = await call(order, { query: { id: String(ORDER) } });
    expect(res.statusCode).toBe(200);
    expect(res.json.order).toMatchObject({ Transaction_id: ORDER, Total: 75.76, Tracking_number: `TRK${ORDER}` });
    expect(res.json.items).toEqual(ITEMS);
    expect(res.json.payments).toEqual(PAYMENTS);
  });

  test('only looks for orders that belong to the signed-in customer', async () => {
    found();
    await call(order, { query: { id: String(ORDER) }, userId: 1000055 });
    for (const [text, params] of db.query.mock.calls) {
      expect(params).toEqual({ id: ORDER, cid: 1000055 });
      expect(text).toMatch(/Marked_for_deletion = 0/);
    }
    expect(db.query.mock.calls[0][0]).toMatch(/Customer_id = @cid/);
  });

  test('someone else\'s or a missing order is a 404, and nothing more is read', async () => {
    fakeDb(() => result([]));
    const res = await call(order, { query: { id: String(ORDER) } });
    expect(res.statusCode).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test.each(['abc', '123', '12345678', '1e6000', '-1000123', '1000123.5', ''])('the order number %p is refused', async (id) => {
    found();
    const res = await call(order, { query: { id } });
    expect(res.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('needs a customer login', async () => {
    expect((await call(order, { query: { id: String(ORDER) }, role: null })).statusCode).toBe(401);
    expect((await call(order, { query: { id: String(ORDER) }, role: 'manager' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------- GET /api/reports/sales
describe('sales report (GET /api/reports/sales)', () => {
  const DAYS = [{ Sale_date: '2026-10-26', Orders: 2, Units: 5, Gross_revenue: 200, Refunded_revenue: 20, Net_revenue: 180, Tax_collected: 14.85, Total_collected: 214.85 }];
  const CATEGORIES = [{ Category_name: 'Video Games', Units: 3, Net_revenue: 120 }];
  const TOP = [{ Name: 'Kingdom of Embers', Units: 3, Revenue: 134.97 }];
  const report = () => fakeDb((text) => {
    if (text.includes('VW_SALES_REPORT')) return result(DAYS);
    if (text.includes('VW_SALES_BY_CATEGORY')) return result(CATEGORIES);
    return result(TOP);
  });
  const run = (query = {}, extra = {}) => call(sales, { role: 'manager', userId: 1000900, query, ...extra });

  test('returns the days, the categories and the top products for the dates asked', async () => {
    report();
    const res = await run({ from: '2026-10-01', to: '2026-10-31' });
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ from: '2026-10-01', to: '2026-10-31', days: DAYS, byCategory: CATEGORIES, topProducts: TOP });
    expect(db.query).toHaveBeenCalledTimes(3);
    for (const [, params] of db.query.mock.calls) expect(params).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  test('uses the last 30 days when no dates are given', async () => {
    report();
    const res = await run();
    const day = 86400000;
    const gap = (Date.parse(res.json.to) - Date.parse(res.json.from)) / day;
    expect(gap).toBe(30);
    expect(res.json.to).toBe(new Date().toISOString().slice(0, 10));
  });

  test('only completed sales, and the end date is converted with CAST', async () => {
    report();
    await run({ from: '2026-10-01', to: '2026-10-31' });
    const top = db.query.mock.calls[2][0];
    expect(top).toMatch(/s\.Status = 'completed'/);
    expect(top).toMatch(/CAST\(@to AS DATE\)/);
  });

  test.each([
    ['2026-99-99', '2026-10-31'],
    ['2026-02-30', '2026-03-01'],
    ['10/01/2026', '2026-10-31'],
    ['2026-10-01', 'tomorrow'],
    ['2026-10-01; DROP TABLE PRODUCT', '2026-10-31'],
  ])('the dates %p to %p are refused', async (from, to) => {
    report();
    const res = await run({ from, to });
    expect(res.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a start date after the end date is refused', async () => {
    report();
    const res = await run({ from: '2026-11-01', to: '2026-10-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json.error).toMatch(/cannot be after/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('managers only', async () => {
    report();
    expect((await run({}, { role: null })).statusCode).toBe(401);
    expect((await run({}, { role: 'customer' })).statusCode).toBe(403);
    expect((await run({}, { role: 'support' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
