// Supplier directory and supplier-product links (DEL-3): add, edit, remove, link products.
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const directory = require('../server/manager/supplier-directory');
const links = require('../server/manager/supplier-products');

let txQuery;
beforeEach(() => {
  jest.resetAllMocks();
  txQuery = fakeTransaction(db);
});

const SUPPLIER = { name: 'Acme Games', email: 'Orders@Acme.test', phone: '(512) 555-0100', street: '100 Main St', apt: '', city: 'Austin', state: 'tx', zip: '78701' };
const LINK = { supplierId: 1000001, productId: 1000007, supplierSku: 'AC-77', unitCost: 12.5, leadTimeDays: 5 };

describe('supplier directory: who may use it', () => {
  test.each(['GET', 'POST', 'PUT', 'DELETE'])('%s refuses support and customers and never touches the database', async (method) => {
    for (const role of ['support', 'customer']) {
      expect((await call(directory, { method, role, body: SUPPLIER, query: { id: '1000001' } })).statusCode).toBe(403);
    }
    expect((await call(directory, { method, body: SUPPLIER, query: { id: '1000001' } })).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});

describe('supplier directory: list', () => {
  test('returns the suppliers', async () => {
    db.query.mockResolvedValue(rows([{ supplierId: 1000001, name: 'Acme Games', productCount: 3, openOrders: 0 }]));
    const res = await call(directory, { method: 'GET', role: 'manager' });
    expect(res.statusCode).toBe(200);
    expect(res.json.suppliers).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toMatch(/Marked_for_deletion = 0/);
  });
});

describe('supplier directory: add', () => {
  test('creates the supplier with cleaned values (email lower case, state upper case, phone digits only)', async () => {
    txQuery
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([{ supplierId: 1000009 }]));
    const res = await call(directory, { method: 'POST', role: 'manager', body: SUPPLIER });
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ supplierId: 1000009 });
    const params = txQuery.mock.calls[1][1];
    expect(params).toMatchObject({ email: 'orders@acme.test', phone: '5125550100', state: 'TX', apt: null, zip: '78701' });
  });

  test.each([
    ['a phone with 9 digits', { phone: '512555010' }],
    ['a zip with letters', { zip: '78A01' }],
    ['a state with 3 letters', { state: 'TXX' }],
    ['no name', { name: '' }],
    ['a bad email', { email: 'nope' }],
  ])('%s is 400 and nothing is written', async (_label, change) => {
    const res = await call(directory, { method: 'POST', role: 'manager', body: { ...SUPPLIER, ...change } });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('an email used by another supplier is 409', async () => {
    txQuery.mockResolvedValueOnce(rows([{ removed: false }]));
    const res = await call(directory, { method: 'POST', role: 'manager', body: SUPPLIER });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/already used/);
    expect(txQuery).toHaveBeenCalledTimes(1);
  });

  test('an email of a removed supplier is 409 with its own message', async () => {
    txQuery.mockResolvedValueOnce(rows([{ removed: true }]));
    const res = await call(directory, { method: 'POST', role: 'manager', body: SUPPLIER });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/removed supplier/);
  });
});

describe('supplier directory: edit', () => {
  test('updates the supplier', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await call(directory, { method: 'PUT', role: 'manager', body: { ...SUPPLIER, supplierId: 1000001 } });
    expect(res.statusCode).toBe(200);
    expect(txQuery.mock.calls[1][1].selfId).toBe(1000001);   // its own email does not count as taken
  });

  test('an unknown or removed supplier is 404', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    const res = await call(directory, { method: 'PUT', role: 'manager', body: { ...SUPPLIER, supplierId: 1000001 } });
    expect(res.statusCode).toBe(404);
  });
});

describe('supplier directory: remove', () => {
  const remove = (options = {}) => call(directory, { method: 'DELETE', role: 'manager', query: { id: '1000001' }, ...options });

  test('a supplier with no open order is flagged, not deleted', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await remove();
    expect(res.statusCode).toBe(200);
    const all = txQuery.mock.calls.map((c) => c[0]).join('\n');
    expect(all).toMatch(/UPDATE SUPPLIER SET Marked_for_deletion = 1/);
    expect(all).not.toMatch(/DELETE\s+FROM/i);
  });

  test('a supplier with a Pending or Ordered order is 409 and nothing is changed', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([{ Order_id: 1000005 }]));
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('ON_ORDER');
    expect(txQuery.mock.calls.map((c) => c[0]).join('\n')).not.toMatch(/UPDATE/);
    expect(txQuery.mock.calls[1][0]).toMatch(/'Pending', 'Ordered'/);
  });

  test('an unknown supplier is 404 and a bad id is 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await remove()).statusCode).toBe(404);
    expect((await remove({ query: { id: 'x' } })).statusCode).toBe(400);
  });
});

describe('supplier products', () => {
  test.each(['GET', 'POST', 'PUT', 'DELETE'])('%s is manager only', async (method) => {
    const options = { method, body: LINK, query: { supplierId: '1000001', productId: '1000007' } };
    expect((await call(links, { ...options, role: 'support' })).statusCode).toBe(403);
    expect((await call(links, { ...options, role: 'customer' })).statusCode).toBe(403);
    expect((await call(links, options)).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('GET returns the links and the products that can still be linked', async () => {
    db.query
      .mockResolvedValueOnce(rows([{ productId: 1000007, leadTimeDays: 5 }]))
      .mockResolvedValueOnce(rows([{ productId: 1000008 }]));
    const res = await call(links, { method: 'GET', role: 'manager', query: { supplierId: '1000001' } });
    expect(res.statusCode).toBe(200);
    expect(res.json.links).toHaveLength(1);
    expect(res.json.products).toHaveLength(1);
    expect(db.query.mock.calls[1][0]).toMatch(/NOT EXISTS/);
  });

  test('POST inserts a new link', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await call(links, { method: 'POST', role: 'manager', body: LINK });
    expect(res.statusCode).toBe(201);
    expect(txQuery.mock.calls[3][0]).toMatch(/INSERT INTO SUPPLIER_PRODUCT/);
  });

  test('POST for a link that was removed before turns the old row back on (no insert)', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]))
      .mockResolvedValueOnce(rows([{ removed: true }]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await call(links, { method: 'POST', role: 'manager', body: LINK });
    expect(res.statusCode).toBe(201);
    const sql = txQuery.mock.calls[3][0];
    expect(sql).toMatch(/UPDATE SUPPLIER_PRODUCT/);
    expect(sql).toMatch(/Marked_for_deletion = 0/);
    expect(txQuery.mock.calls.map((c) => c[0]).join('\n')).not.toMatch(/INSERT/);
  });

  test('POST for a link that is already visible is 409', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }]))
      .mockResolvedValueOnce(rows([{ Product_id: 1000007 }]))
      .mockResolvedValueOnce(rows([{ removed: false }]));
    const res = await call(links, { method: 'POST', role: 'manager', body: LINK });
    expect(res.statusCode).toBe(409);
  });

  test.each([
    ['a negative cost', { unitCost: -1 }],
    ['a lead time that is not a whole number', { leadTimeDays: 2.5 }],
    ['no supplier SKU', { supplierSku: ' ' }],
  ])('%s is 400', async (_label, change) => {
    const res = await call(links, { method: 'POST', role: 'manager', body: { ...LINK, ...change } });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('POST for an unknown supplier is 404 and for an unknown product is 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await call(links, { method: 'POST', role: 'manager', body: LINK })).statusCode).toBe(404);
    txQuery.mockReset();
    txQuery.mockResolvedValueOnce(rows([{ Supplier_id: 1000001 }])).mockResolvedValueOnce(rows([]));
    expect((await call(links, { method: 'POST', role: 'manager', body: LINK })).statusCode).toBe(400);
  });

  test('PUT edits a visible link, 404 otherwise', async () => {
    db.query.mockResolvedValueOnce(rows([], 1));
    expect((await call(links, { method: 'PUT', role: 'manager', body: LINK })).statusCode).toBe(200);
    db.query.mockResolvedValueOnce(rows([], 0));
    expect((await call(links, { method: 'PUT', role: 'manager', body: LINK })).statusCode).toBe(404);
  });

  test('DELETE flags the link, never deletes it', async () => {
    db.query.mockResolvedValueOnce(rows([], 1));
    const res = await call(links, { method: 'DELETE', role: 'manager', query: { supplierId: '1000001', productId: '1000007' } });
    expect(res.statusCode).toBe(200);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE SUPPLIER_PRODUCT SET Marked_for_deletion = 1/);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    db.query.mockResolvedValueOnce(rows([], 0));
    expect((await call(links, { method: 'DELETE', role: 'manager', query: { supplierId: '1000001', productId: '1000007' } })).statusCode).toBe(404);
  });
});
