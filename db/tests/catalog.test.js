jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const catalog = require('../server/manager/product-catalog');
const categories = require('../server/manager/categories');

beforeEach(() => { jest.resetAllMocks(); });

const good = {
  sku: 'SKU-1', name: 'Test Game', description: 'A game', categoryId: 1000001, productCondition: 'New',
  costPrice: '10.5', sellPrice: '19.99', stock: '5', threshold: '2',
};

describe('product catalog list', () => {
  test('manager gets products and the search is escaped', async () => {
    db.query.mockResolvedValue(rows([{ productId: 1 }]));
    const res = await call(catalog, { role: 'manager', query: { q: '50%_off' } });
    expect(res.statusCode).toBe(200);
    expect(res.json.products).toHaveLength(1);
    expect(db.query.mock.calls[0][1].like).toBe('%50[%][_]off%');
    expect(db.query.mock.calls[0][0]).toMatch(/Marked_for_deletion = 0/);
  });
  test('no search text means no filter', async () => {
    db.query.mockResolvedValue(rows([]));
    await call(catalog, { role: 'manager' });
    expect(db.query.mock.calls[0][1].like).toBeNull();
  });
  test('support is refused (403) and no login is 401', async () => {
    expect((await call(catalog, { role: 'support' })).statusCode).toBe(403);
    expect((await call(catalog, {})).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('product catalog create', () => {
  test('creates a product (201) with cleaned values', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ Category_id: 1 }]))   // category exists
     .mockResolvedValueOnce(rows([]))                     // sku free
     .mockResolvedValueOnce(rows([{ productId: 1000050 }]));
    const res = await call(catalog, { method: 'POST', role: 'manager', body: good });
    expect(res.statusCode).toBe(201);
    expect(res.json.productId).toBe(1000050);
    const p = q.mock.calls[2][1];
    expect(p).toMatchObject({ sku: 'SKU-1', costPrice: 10.5, sellPrice: 19.99, stock: 5, threshold: 2 });
  });
  test('a SKU that exists (even hidden) is refused with 409', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ Category_id: 1 }])).mockResolvedValueOnce(rows([{ Product_id: 9 }]));
    const res = await call(catalog, { method: 'POST', role: 'manager', body: good });
    expect(res.statusCode).toBe(409);
    expect(q.mock.calls[1][0]).not.toMatch(/Marked_for_deletion/);
  });
  test('unknown category is 400', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([]));
    expect((await call(catalog, { method: 'POST', role: 'manager', body: good })).statusCode).toBe(400);
  });
  test.each([
    ['bad condition', { productCondition: 'Broken' }],
    ['negative price', { sellPrice: -1 }],
    ['text price', { costPrice: 'abc' }],
    ['empty sku', { sku: '  ' }],
    ['negative stock', { stock: -3 }],
    ['fractional threshold', { threshold: 1.5 }],
    ['category missing', { categoryId: undefined }],
  ])('%s is 400 and nothing is written', async (_n, change) => {
    const res = await call(catalog, { method: 'POST', role: 'manager', body: { ...good, ...change } });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
  test('support cannot create (403)', async () => {
    expect((await call(catalog, { method: 'POST', role: 'support', body: good })).statusCode).toBe(403);
  });
});

describe('product catalog edit', () => {
  const edit = { productId: 1000050, name: 'New name', description: '', categoryId: 1000001,
    productCondition: 'Used', costPrice: 8, threshold: 4, isActive: false };
  test('edits and can pause a product', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ Category_id: 1 }])).mockResolvedValueOnce(rows([], 1));
    const res = await call(catalog, { method: 'PUT', role: 'manager', body: edit });
    expect(res.statusCode).toBe(200);
    expect(q.mock.calls[1][1]).toMatchObject({ isActive: false, description: null });
    expect(q.mock.calls[1][0]).not.toMatch(/Sell_price|Stock_quantity/);
  });
  test('missing product is 404', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ Category_id: 1 }])).mockResolvedValueOnce(rows([], 0));
    expect((await call(catalog, { method: 'PUT', role: 'manager', body: edit })).statusCode).toBe(404);
  });
  test('isActive must be true or false (400)', async () => {
    expect((await call(catalog, { method: 'PUT', role: 'manager', body: { ...edit, isActive: 'no' } })).statusCode).toBe(400);
  });
});

describe('categories', () => {
  test('list, create, edit, 404 and roles', async () => {
    db.query.mockResolvedValueOnce(rows([{ categoryId: 1, name: 'Games', productCount: 3 }]));
    expect((await call(categories, { role: 'manager' })).json.categories).toHaveLength(1);

    db.query.mockResolvedValueOnce(rows([{ categoryId: 1000009 }]));
    const made = await call(categories, { method: 'POST', role: 'manager', body: { name: ' Toys ', description: '' } });
    expect(made.statusCode).toBe(201);
    expect(db.query.mock.calls[1][1]).toEqual({ name: 'Toys', description: null });

    db.query.mockResolvedValueOnce(rows([], 0));
    expect((await call(categories, { method: 'PUT', role: 'manager', body: { categoryId: 1000009, name: 'X' } })).statusCode).toBe(404);

    expect((await call(categories, { method: 'POST', role: 'support', body: { name: 'X' } })).statusCode).toBe(403);
    expect((await call(categories, { method: 'POST', role: 'manager', body: {} })).statusCode).toBe(400);
  });
  test('a duplicate name becomes 409 "already in use"', async () => {
    const { sqlError } = require('./helpers_manager');
    db.query.mockRejectedValueOnce(sqlError(2627, 'Violation of UNIQUE KEY'));
    const res = await call(categories, { method: 'POST', role: 'manager', body: { name: 'Games' } });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/already in use/);
  });
});
