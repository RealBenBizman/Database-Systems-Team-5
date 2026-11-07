// DEL-6: employees (add, change role, remove), review moderation, and deactivating a customer.
jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction } = require('./helpers_manager');
const employees = require('../server/manager/employees');
const reviews = require('../server/manager/reviews');
const customer = require('../server/manager/customers/[id]');

let txQuery;
beforeEach(() => { jest.resetAllMocks(); txQuery = fakeTransaction(db); });
const sqls = () => txQuery.mock.calls.map((c) => c[0]).join('\n');
// the signed-in test manager has id 1000001 (see helpers_manager.js)

describe.each([['employees', employees, 'DELETE'], ['reviews', reviews, 'DELETE'], ['customer detail', customer, 'DELETE']])('%s: who may use it', (_n, handler, method) => {
  test('support, customers and visitors are refused before any database call', async () => {
    const options = { method, query: { id: '1000004' }, body: {} };
    expect((await call(handler, { ...options, role: 'support' })).statusCode).toBe(403);
    expect((await call(handler, { ...options, role: 'customer' })).statusCode).toBe(403);
    expect((await call(handler, options)).statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});

describe('employees: list', () => {
  test('lists the people who still work here, with no password column at all', async () => {
    db.query.mockResolvedValue(rows([{ employeeId: 1000002, firstName: 'Sam', role: 'Support' }]));
    const res = await call(employees, { role: 'manager' });
    expect(res.statusCode).toBe(200);
    expect(res.json.employees).toHaveLength(1);
    expect(db.query.mock.calls[0][0]).toMatch(/Marked_for_deletion = 0/);
    expect(db.query.mock.calls[0][0]).not.toMatch(/Password/i);
  });
});

describe('employees: add', () => {
  const NEW = { firstName: 'Mia', lastName: 'Lopez', email: 'Mia@Store.com', phone: '(512) 555-0142', role: 'Support', hireDate: '2026-11-02', supervisorId: '', password: 'Welcome2store' };
  const add = (body) => call(employees, { method: 'POST', role: 'manager', body });

  test('creates the employee with a hashed password and a normalised email and phone', async () => {
    txQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ employeeId: 1000009 }]));
    const res = await add(NEW);
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ employeeId: 1000009 });
    const params = txQuery.mock.calls[1][1];
    expect(params).toMatchObject({ email: 'mia@store.com', phone: '5125550142', role: 'Support', supervisorId: null });
    expect(params.passwordHash).toMatch(/^\$2b\$/);
    expect(JSON.stringify(params)).not.toContain('Welcome2store');
    expect(JSON.stringify(res.json)).not.toMatch(/hash|password/i);
  });

  test('a supervisor must exist', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    const res = await add({ ...NEW, supervisorId: 1000050 });
    expect(res.statusCode).toBe(400);
    expect(sqls()).not.toMatch(/INSERT/);
  });

  test('an email already used (even by a removed employee) is 409', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Employee_id: 1000003 }]));
    const res = await add(NEW);
    expect(res.statusCode).toBe(409);
    expect(txQuery.mock.calls[0][0]).not.toMatch(/Marked_for_deletion/);
    expect(sqls()).not.toMatch(/INSERT/);
  });

  test.each([
    ['no first name', { firstName: ' ' }],
    ['a bad email', { email: 'mia' }],
    ['a short phone', { phone: '5125550' }],
    ['letters in the phone', { phone: '51255501ab' }],
    ['an unknown role', { role: 'Owner' }],
    ['a weak password', { password: 'password' }],
    ['a made-up hire date', { hireDate: '2026-02-31' }],
  ])('%s is 400 and nothing is written', async (_label, change) => {
    const res = await add({ ...NEW, ...change });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
});

describe('employees: change a role', () => {
  const put = (body) => call(employees, { method: 'PUT', role: 'manager', body });

  test('promotes a support person', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Employee_id: 1000002, Role: 'Support' }])).mockResolvedValueOnce(rows([], 1));
    const res = await put({ employeeId: 1000002, role: 'Manager' });
    expect(res.statusCode).toBe(200);
    expect(txQuery.mock.calls[1][1]).toEqual({ role: 'Manager', id: 1000002 });
  });

  test('nobody changes their own role', async () => {
    const res = await put({ employeeId: 1000001, role: 'Support' });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('SELF');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('the last other manager cannot be demoted', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Employee_id: 1000002, Role: 'Manager' }])).mockResolvedValueOnce(rows([{ n: 0 }]));
    const res = await put({ employeeId: 1000002, role: 'Support' });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('LAST_MANAGER');
    expect(sqls()).not.toMatch(/UPDATE/);
  });

  test('unknown employee 404, bad role 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await put({ employeeId: 1000002, role: 'Manager' })).statusCode).toBe(404);
    expect((await put({ employeeId: 1000002, role: 'Boss' })).statusCode).toBe(400);
  });
});

describe('employees: remove', () => {
  const remove = (id = '1000002') => call(employees, { method: 'DELETE', role: 'manager', query: { id } });

  test('flags the employee, never deletes', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Employee_id: 1000002, Role: 'Support' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([], 1));
    const res = await remove();
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE EMPLOYEE SET Marked_for_deletion = 1/);
    expect(sqls()).not.toMatch(/DELETE\s+FROM/i);
  });

  test('you cannot remove yourself', async () => {
    const res = await remove('1000001');
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('SELF');
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('the last other manager cannot be removed', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Employee_id: 1000002, Role: 'Manager' }])).mockResolvedValueOnce(rows([{ n: 0 }]));
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('LAST_MANAGER');
  });

  test('someone who still supervises people is refused and the names are listed', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Employee_id: 1000002, Role: 'Manager' }]))
      .mockResolvedValueOnce(rows([{ n: 1 }]))
      .mockResolvedValueOnce(rows([{ name: 'Sam Reed' }, { name: 'Ana Cruz' }]));
    const res = await remove();
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('IS_SUPERVISOR');
    expect(res.json.error).toMatch(/supervises: Sam Reed, Ana Cruz\./);
    expect(sqls()).not.toMatch(/UPDATE EMPLOYEE SET Marked/);
    expect(txQuery.mock.calls[2][0]).toMatch(/Marked_for_deletion = 0/);   // removed people do not block
  });

  test('unknown employee 404, bad id 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await remove()).statusCode).toBe(404);
    expect((await remove('abc')).statusCode).toBe(400);
  });
});

describe('review moderation', () => {
  test('search: only visible reviews, text and product filters passed as parameters', async () => {
    db.query.mockResolvedValue(rows([{ reviewId: 1000005, author: 'Alice N' }]));
    const res = await call(reviews, { role: 'manager', query: { q: 'spam', productId: '1000002' } });
    expect(res.statusCode).toBe(200);
    expect(res.json.reviews).toHaveLength(1);
    expect(db.query.mock.calls[0][1]).toEqual({ like: '%spam%', productId: 1000002 });
    expect(db.query.mock.calls[0][0]).toMatch(/rv.Marked_for_deletion = 0/);
    expect(await call(reviews, { role: 'manager', query: { productId: 'x' } }).then((r) => r.statusCode)).toBe(400);
  });

  test('remove flags the review', async () => {
    txQuery.mockResolvedValueOnce(rows([], 1));
    const res = await call(reviews, { method: 'DELETE', role: 'manager', query: { id: '1000005' } });
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE REVIEW SET Marked_for_deletion = 1/);
  });

  test('unknown review 404, bad id 400', async () => {
    txQuery.mockResolvedValueOnce(rows([], 0));
    expect((await call(reviews, { method: 'DELETE', role: 'manager', query: { id: '1000005' } })).statusCode).toBe(404);
    expect((await call(reviews, { method: 'DELETE', role: 'manager', query: { id: 'z' } })).statusCode).toBe(400);
  });
});

describe('deactivate a customer', () => {
  const deactivate = (id = '1000007') => call(customer, { method: 'DELETE', role: 'manager', query: { id } });

  test('flags the customer and empties the cart', async () => {
    txQuery
      .mockResolvedValueOnce(rows([{ Customer_id: 1000007 }]))
      .mockResolvedValueOnce(rows([{ n: 0 }]))
      .mockResolvedValueOnce(rows([], 1))
      .mockResolvedValueOnce(rows([], 1));
    const res = await deactivate();
    expect(res.statusCode).toBe(200);
    expect(sqls()).toMatch(/UPDATE CUSTOMER SET Marked_for_deletion = 1/);
    expect(sqls()).toMatch(/DELETE FROM CART_ITEM/);
  });

  test('an open return blocks it (409, worded for staff)', async () => {
    txQuery.mockResolvedValueOnce(rows([{ Customer_id: 1000007 }])).mockResolvedValueOnce(rows([{ n: 1 }]));
    const res = await deactivate();
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toMatch(/^This customer has a return/);
  });

  test('unknown customer 404, bad id 400', async () => {
    txQuery.mockResolvedValueOnce(rows([]));
    expect((await deactivate()).statusCode).toBe(404);
    expect((await deactivate('5')).statusCode).toBe(400);
  });
});
