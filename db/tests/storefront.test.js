jest.mock('../lib/db', () => {
  const sql = jest.requireActual('mssql');
  const txQuery = jest.fn();
  return { sql, query: jest.fn(), withTransaction: jest.fn((fn) => fn({ query: txQuery })), txQuery };
});

const db = require('../lib/db');
const { signToken } = require('../lib/auth');
const { mockReq, mockRes } = require('./helpers');
const products = require('../server/products');
const product = require('../server/products/[id]');
const categories = require('../server/products/categories');
const reviews = require('../server/reviews');
const cart = require('../server/cart');
const preview = require('../server/cart/preview');
const merge = require('../server/cart/merge');
const account = require('../server/account');
const addresses = require('../server/account/addresses');
const phones = require('../server/account/phones');
const notifications = require('../server/account/notifications');
const purchases = require('../server/account/purchases');
const job = require('../server/jobs/notifications');

const CUSTOMER = 1000001;
const PRODUCT = 1000002;
const result = (rows = []) => ({ recordset: rows, recordsets: [rows] });

async function call(handler, { method = 'GET', body, query = {}, role = 'customer', customerId = CUSTOMER, headers = {} } = {}) {
  const cookie = role ? `pos_token=${signToken({ id: customerId, role, name: 'Test' })}` : '';
  const req = mockReq({ method, body, headers: { cookie, ...headers } });
  req.query = query;
  const res = mockRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  process.env.JWT_SECRET = 'storefront-tests-use-a-local-secret-with-32-characters';
  delete process.env.CRON_SECRET;
  jest.clearAllMocks();
  db.query.mockReset(); db.txQuery.mockReset();
  db.query.mockImplementation(async (text) => {
    if (text.startsWith('SELECT Customer_id FROM CUSTOMER')) return result([{ Customer_id: CUSTOMER }]);
    throw new Error('Unexpected database query');
  });
  db.withTransaction.mockImplementation((fn) => fn({ query: db.txQuery }));
});

test('catalog is public and returns paginated database products', async () => {
  db.query.mockResolvedValue({ recordsets: [[{ id: PRODUCT, name: 'A game' }], [{ total: 1 }]] });
  const res = await call(products, { role: null });
  expect(res.statusCode).toBe(200);
  expect(res.json.products[0].id).toBe(PRODUCT);
  const [text, params] = db.query.mock.calls[0];
  expect(text).toContain('p.Is_active = 1');
  expect(text).toContain('p.Marked_for_deletion = 0');
  expect(text).not.toContain('Cost_price');
  expect(params).toMatchObject({ offset: 0, pageSize: 12 });
});

test('catalog search remains a bound literal even with SQL and wildcard characters', async () => {
  db.query.mockResolvedValue({ recordsets: [[], [{ total: 0 }]] });
  const res = await call(products, { query: { search: "x%_['; DROP TABLE PRODUCT;--", categoryId: String(PRODUCT), sort: 'price_desc' } });
  expect(res.statusCode).toBe(200);
  const [text, params] = db.query.mock.calls[0];
  expect(text).not.toContain('DROP TABLE');
  expect(params.search).toContain('~%~_~[');
  expect(text).toContain('ORDER BY effectivePrice DESC, id');
});

test.each([{ sort: 'price;DROP' }, { sort: 'constructor' }, { condition: 'Broken' }, { minPrice: '20', maxPrice: '10' }, { minPrice: '-1' }, { maxPrice: 'NaN' }, { page: '0' }, { categoryId: '2' }])('catalog rejects invalid filters %j', async (query) => {
  expect((await call(products, { query })).statusCode).toBe(400);
  expect(db.query).not.toHaveBeenCalled();
});

test('product detail returns 404 for an unavailable product', async () => {
  db.query.mockResolvedValue(result());
  expect((await call(product, { role: null, query: { id: PRODUCT } })).statusCode).toBe(404);
});

test('categories include active product counts', async () => {
  db.query.mockResolvedValue(result([{ id: PRODUCT, name: 'Games', productCount: 2 }]));
  const res = await call(categories, { role: null });
  expect(res.json.categories[0].productCount).toBe(2);
});

test('review list is public and does not expose customer emails', async () => {
  db.query.mockResolvedValue(result([{ id: PRODUCT, rating: 5, author: 'A. B.', total: 1 }]));
  const res = await call(reviews, { role: null, query: { productId: PRODUCT } });
  expect(res.json.total).toBe(1);
  expect(db.query.mock.calls[0][0]).not.toContain('c.Email');
});

test.each([0, 6, 2.5, null])('reviews reject rating %s', async (rating) => {
  const res = await call(reviews, { method: 'POST', body: { productId: PRODUCT, rating } });
  expect(res.statusCode).toBe(400);
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test('reviews do not allow a supplied customer ID', async () => {
  expect((await call(reviews, { method: 'POST', body: { productId: PRODUCT, rating: 5, customerId: 1000009 } })).statusCode).toBe(400);
});

test('reviews reject a foreign or incomplete purchase link before inserting', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Product_id: PRODUCT }])).mockResolvedValueOnce(result());
  const res = await call(reviews, { method: 'POST', body: { productId: PRODUCT, rating: 5, transactionId: 1000010 } });
  expect(res.statusCode).toBe(409);
  expect(db.txQuery).toHaveBeenCalledTimes(2);
  expect(db.txQuery.mock.calls[1][1].customerId).toBe(CUSTOMER);
});

test('review insert works with an enabled trigger and a nullable purchase link', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Product_id: PRODUCT }])).mockResolvedValueOnce(result([{ id: 1000050 }]));
  const res = await call(reviews, { method: 'POST', body: { productId: PRODUCT, rating: 4, comment: 'Good game' } });
  expect(res.statusCode).toBe(201);
  const [text, params] = db.txQuery.mock.calls[1];
  expect(text).toContain('INTO @created');
  expect(params.customerId).toBe(CUSTOMER);
  expect(params.transactionId.value).toBeNull();
});

test('eligible review purchases are restricted to this customer and product', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ id: 1000040 }]));
  const res = await call(purchases, { query: { productId: PRODUCT, customerId: '1000099' } });
  expect(res.statusCode).toBe(200);
  expect(db.query.mock.calls[1][1]).toEqual({ customerId: CUSTOMER, productId: PRODUCT });
});

test.each([cart, account, addresses, phones, notifications, purchases])('personal endpoints reject visitors and staff', async (handler) => {
  expect((await call(handler, { role: null })).statusCode).toBe(401);
  expect((await call(handler, { role: 'manager' })).statusCode).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});

test('a deleted customer cannot use an otherwise valid login token', async () => {
  db.query.mockResolvedValue(result());
  expect((await call(cart)).statusCode).toBe(401);
});

test('cart reads use the shared view and totals supplied by SQL', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ id: PRODUCT, quantity: 2, lineTotal: 18, cartSubtotal: 18, cartQuantity: 2 }]));
  const res = await call(cart, { query: { customerId: '1000999' } });
  expect(res.json).toEqual({ items: [{ id: PRODUCT, quantity: 2, lineTotal: 18 }], subtotal: 18, itemCount: 2 });
  expect(db.query.mock.calls[1][0]).toContain('FROM VW_CART');
  expect(db.query.mock.calls[1][1]).toEqual({ customerId: CUSTOMER });
});

test('adding an existing cart item increments its quantity and refreshes activity', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }]))
    .mockResolvedValueOnce(result([{ stock: 10 }])).mockResolvedValueOnce(result([{ quantity: 2, deleted: false }])).mockResolvedValueOnce(result());
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  const res = await call(cart, { method: 'POST', body: { productId: PRODUCT, quantity: 3 } });
  expect(res.statusCode).toBe(201);
  const [text, params] = db.txQuery.mock.calls[3];
  expect(params.quantity).toBe(5);
  expect(text).toContain('Added_at = SYSDATETIME()');
  expect(text).toContain('Marked_for_deletion = 0');
});

test('adding above stock does not write a cart row', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }]))
    .mockResolvedValueOnce(result([{ stock: 2 }])).mockResolvedValueOnce(result([{ quantity: 2, deleted: false }]));
  const res = await call(cart, { method: 'POST', body: { productId: PRODUCT, quantity: 1 } });
  expect(res.statusCode).toBe(409);
  expect(db.txQuery).toHaveBeenCalledTimes(3);
});

test('adding a previously soft-deleted cart item reuses its composite key', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }]))
    .mockResolvedValueOnce(result([{ stock: 8 }])).mockResolvedValueOnce(result([{ quantity: 7, deleted: true }])).mockResolvedValueOnce(result());
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  expect((await call(cart, { method: 'POST', body: { productId: PRODUCT, quantity: 1 } })).statusCode).toBe(201);
  expect(db.txQuery.mock.calls[3][1].quantity).toBe(1);
});

test('zero quantity removes a row instead of violating the positive quantity constraint', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ id: PRODUCT }]));
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  expect((await call(cart, { method: 'PATCH', body: { productId: PRODUCT, quantity: 0 } })).statusCode).toBe(200);
  expect(db.txQuery.mock.calls[1][0]).toMatch(/DELETE FROM CART_ITEM/);
  expect(db.txQuery.mock.calls[1][1]).toEqual({ customerId: CUSTOMER, productId: PRODUCT });
});

test('removing a cart item cannot select another customer', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ id: PRODUCT }]));
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  const res = await call(cart, { method: 'DELETE', query: { productId: PRODUCT, customerId: '1000999' } });
  expect(res.statusCode).toBe(200);
  expect(db.txQuery.mock.calls[1][1].customerId).toBe(CUSTOMER);
});

test('repeating a visitor cart merge does not add the same quantity twice', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }]))
    .mockResolvedValueOnce(result([{ stock: 8 }])).mockResolvedValueOnce(result([{ quantity: 3, deleted: false }])).mockResolvedValueOnce(result());
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  const res = await call(merge, { method: 'POST', body: { items: [{ productId: PRODUCT, quantity: 3 }] } });
  expect(res.statusCode).toBe(200);
  expect(res.json.rejected).toEqual([]);
  expect(db.txQuery.mock.calls[3][1].quantity).toBe(3);
});

test('unavailable visitor items are reported without silently dropping them', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  const res = await call(merge, { method: 'POST', body: { items: [{ productId: PRODUCT, quantity: 1 }] } });
  expect(res.json.rejected[0]).toMatchObject({ productId: PRODUCT, quantity: 1 });
});

test('guest preview binds its JSON rather than inserting cart rows', async () => {
  db.query.mockResolvedValue(result([{ id: PRODUCT, cartSubtotal: 8, cartQuantity: 1, lineTotal: 8 }]));
  const res = await call(preview, { role: null, method: 'POST', body: { items: [{ productId: PRODUCT, quantity: 1 }] } });
  expect(res.json.subtotal).toBe(8);
  expect(db.query.mock.calls[0][1].items.value).toBe(JSON.stringify([{ productId: PRODUCT, quantity: 1 }]));
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test.each([[{ productId: PRODUCT, quantity: 0 }], [{ productId: PRODUCT, quantity: 1 }, { productId: PRODUCT, quantity: 1 }], Array.from({ length: 101 }, (_, i) => ({ productId: 1000000 + i, quantity: 1 }))])('guest preview rejects invalid or oversized carts', async (items) => {
  expect((await call(preview, { role: null, method: 'POST', body: { items } })).statusCode).toBe(400);
});

test('profile read returns only the signed-in customer data', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce({ recordsets: [[{ id: CUSTOMER, firstName: 'Alice' }], [], []] });
  expect((await call(account)).json.profile.id).toBe(CUSTOMER);
  expect(db.query.mock.calls[1][0]).not.toContain('Password_hash');
  expect(db.query.mock.calls[1][1].customerId).toBe(CUSTOMER);
});

test('profile cannot directly change points, roles or customer identity', async () => {
  for (const field of ['points', 'role', 'customerId', 'Tier_id', 'Marked_for_deletion']) {
    expect((await call(account, { method: 'PATCH', body: { [field]: 100 } })).statusCode).toBe(400);
  }
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test('preferences require booleans', async () => {
  expect((await call(account, { method: 'PATCH', body: { notifyCart: 'false' } })).statusCode).toBe(400);
});

test('profile duplicate emails become a useful conflict response', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockRejectedValueOnce({ number: 2627, message: 'duplicate' });
  expect((await call(account, { method: 'PATCH', body: { email: 'a@example.com' } })).statusCode).toBe(409);
});

const addressBody = { type: 'home', recipient: 'Alice Nguyen', street: '1 Main Street', apt: '', city: 'Houston', state: 'TX', zip: '77002', isDefault: true };

test('setting a new default address clears the old default within one transaction', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result()).mockResolvedValueOnce(result([{ id: PRODUCT }]));
  const res = await call(addresses, { method: 'POST', body: addressBody });
  expect(res.statusCode).toBe(201);
  expect(db.withTransaction).toHaveBeenCalledTimes(1);
  expect(db.txQuery.mock.calls[1][0]).toContain('is_default = 0');
  expect(db.txQuery.mock.calls[2][1].customerId).toBe(CUSTOMER);
  expect(db.txQuery.mock.calls[2][1].apt.value).toBeNull();
});

test('editing someone else address fails before clearing any default', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  const res = await call(addresses, { method: 'PATCH', body: { ...addressBody, id: PRODUCT } });
  expect(res.statusCode).toBe(404);
  expect(db.txQuery).toHaveBeenCalledTimes(2);
});

test('removing a default address also clears the filtered unique index flag', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ id: PRODUCT }]));
  expect((await call(addresses, { method: 'DELETE', query: { id: PRODUCT } })).statusCode).toBe(200);
  expect(db.txQuery.mock.calls[1][0]).toContain('Marked_for_deletion = 1, is_default = 0');
});

test.each([{ zip: 'bad' }, { state: 'Texas' }, { recipient: '' }, { apt: 'a'.repeat(11) }])('invalid addresses are rejected %j', async (fields) => {
  expect((await call(addresses, { method: 'POST', body: { ...addressBody, ...fields } })).statusCode).toBe(400);
});

test('adding a deleted phone restores its existing key', async () => {
  db.txQuery.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ deleted: true }])).mockResolvedValueOnce(result());
  const res = await call(phones, { method: 'POST', body: { phone: '(713) 555-0123' } });
  expect(res.statusCode).toBe(201);
  expect(res.json.phone).toBe('7135550123');
  expect(db.txQuery.mock.calls[2][0]).toContain('UPDATE CUSTOMER_PHONE');
});

test('phone removal is soft and restricted to the signed-in customer', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ phone: '7135550123' }]));
  expect((await call(phones, { method: 'DELETE', query: { phone: '7135550123' } })).statusCode).toBe(200);
  expect(db.query.mock.calls[1][0]).toContain('SET Marked_for_deletion = 1');
  expect(db.query.mock.calls[1][1].customerId).toBe(CUSTOMER);
});

test('notifications are paginated and restricted to the signed-in customer', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce({ recordsets: [[{ id: PRODUCT }], [{ total: 1, unread: 1 }]] });
  const res = await call(notifications, { query: { unread: 'true' } });
  expect(res.json.unread).toBe(1);
  expect(db.query.mock.calls[1][0]).toContain('AND Read_at IS NULL');
  expect(db.query.mock.calls[1][1].customerId).toBe(CUSTOMER);
});

test('marking a notification read is repeatable and scoped to its owner', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result([{ id: PRODUCT }]));
  expect((await call(notifications, { method: 'PATCH', body: { id: PRODUCT } })).statusCode).toBe(200);
  expect(db.query.mock.calls[1][0]).toContain('ISNULL(Read_at, SYSDATETIME())');
  expect(db.query.mock.calls[1][1]).toEqual({ id: PRODUCT, customerId: CUSTOMER });
});

test('mark all read cannot affect a different customer', async () => {
  db.query.mockResolvedValueOnce(result([{ Customer_id: CUSTOMER }])).mockResolvedValueOnce(result());
  expect((await call(notifications, { method: 'PATCH', body: { all: true } })).statusCode).toBe(200);
  expect(db.query.mock.calls[1][1]).toEqual({ customerId: CUSTOMER });
});

test('notification jobs reject anonymous and customer callers', async () => {
  expect((await call(job, { role: null, method: 'GET' })).statusCode).toBe(401);
  expect((await call(job, { role: 'customer', method: 'POST' })).statusCode).toBe(403);
  expect(db.withTransaction).not.toHaveBeenCalled();
});

test('a valid cron credential can run the deduplicated notification job', async () => {
  process.env.CRON_SECRET = 'test-cron-secret';
  db.txQuery.mockResolvedValueOnce(result([{ result: 0 }])).mockResolvedValueOnce(result([{ id: PRODUCT }])).mockResolvedValueOnce(result());
  const res = await call(job, { role: null, headers: { authorization: 'Bearer test-cron-secret' } });
  expect(res.json).toEqual({ cartReminders: 1, offers: 0 });
  expect(db.query).not.toHaveBeenCalled();
  const text = db.txQuery.mock.calls[1][0];
  expect(text).toContain('MAX(ci.Added_at)');
  expect(text).toContain('c.Notify_cart = 1');
  expect(text).toContain('DATEADD(DAY, -3');
  expect(db.txQuery.mock.calls[2][0]).toContain('c.Notify_offers = 1');
});

test('overlapping notification runs fail without creating messages', async () => {
  process.env.CRON_SECRET = 'test-cron-secret';
  db.txQuery.mockResolvedValueOnce(result([{ result: -1 }]));
  expect((await call(job, { role: null, headers: { authorization: 'Bearer test-cron-secret' } })).statusCode).toBe(409);
  expect(db.txQuery).toHaveBeenCalledTimes(1);
});

test('unsupported API methods return 405 and an Allow header', async () => {
  const res = await call(products, { method: 'DELETE', role: null });
  expect(res.statusCode).toBe(405);
  expect(res.headers.allow).toBe('GET');
});
