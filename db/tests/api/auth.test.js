process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';

jest.mock('../../lib/db', () => ({ query: jest.fn() }));

const { query } = require('../../lib/db');
const auth = require('../../lib/auth');
const throttle = require('../../lib/throttle');
const { mockReq, mockRes, cookieFrom } = require('../helpers');

const login = require('../../server/auth/login');
const employeeLogin = require('../../server/auth/employee-login');
const register = require('../../server/auth/register');
const logout = require('../../server/auth/logout');
const me = require('../../server/auth/me');

let hash;
beforeAll(async () => { hash = await auth.hashPassword('Password123!'); });
beforeEach(() => { query.mockReset(); throttle._clear(); });

async function call(handler, opts) {
  const res = mockRes();
  await handler(mockReq(opts), res);
  return res;
}
const post = (handler, body, extra = {}) => call(handler, { method: 'POST', body, ...extra });
const rows = (...r) => ({ recordset: r });

describe('POST /api/auth/login (customers)', () => {
  const alice = { id: 1000003, name: 'Alice', password_hash: undefined };

  test('right password: 200, user in body, httpOnly cookie, role customer', async () => {
    query.mockResolvedValue(rows({ ...alice, password_hash: hash }));
    const res = await post(login, { email: 'Alice.Nguyen@posstore.test', password: 'Password123!' });
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ user: { id: 1000003, name: 'Alice', role: 'customer' } });
    expect(res.headers['set-cookie']).toMatch(/pos_token=.+HttpOnly/);
    // email was lower-cased and passed as a parameter
    expect(query.mock.calls[0][1]).toEqual({ email: 'alice.nguyen@posstore.test' });
    expect(query.mock.calls[0][0]).toMatch(/Marked_for_deletion = 0/);
    // the password hash never leaves the server
    expect(res.body).not.toMatch(/\$2b\$/);
  });

  test('wrong password and unknown email give the same 401 message and no cookie', async () => {
    query.mockResolvedValueOnce(rows({ ...alice, password_hash: hash }));
    const wrong = await post(login, { email: 'alice.nguyen@posstore.test', password: 'Wrong123!' });
    query.mockResolvedValueOnce(rows());
    const unknown = await post(login, { email: 'nobody@posstore.test', password: 'Password123!' });
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json.error).toBe('Incorrect email or password.');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  test('missing fields are 400 and do not touch the database', async () => {
    expect((await post(login, { email: 'a@b.com' })).statusCode).toBe(400);
    expect((await post(login, { password: 'x' })).statusCode).toBe(400);
    expect((await post(login, undefined)).statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('GET is 405', async () => {
    expect((await call(login, { method: 'GET' })).statusCode).toBe(405);
  });

  test('after 5 wrong passwords the 6th try is 429, even with the right password', async () => {
    query.mockResolvedValue(rows({ ...alice, password_hash: hash }));
    for (let i = 0; i < 5; i++) {
      expect((await post(login, { email: 'alice.nguyen@posstore.test', password: 'bad' + i })).statusCode).toBe(401);
    }
    const blocked = await post(login, { email: 'alice.nguyen@posstore.test', password: 'Password123!' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // another address is unaffected
    const other = await post(login, { email: 'alice.nguyen@posstore.test', password: 'Password123!' }, { ip: '9.9.9.9' });
    expect(other.statusCode).toBe(200);
  });

  test('a good login clears earlier failures', async () => {
    query.mockResolvedValue(rows({ ...alice, password_hash: hash }));
    for (let i = 0; i < 4; i++) await post(login, { email: 'alice.nguyen@posstore.test', password: 'bad' });
    expect((await post(login, { email: 'alice.nguyen@posstore.test', password: 'Password123!' })).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await post(login, { email: 'alice.nguyen@posstore.test', password: 'bad' });
    expect((await post(login, { email: 'alice.nguyen@posstore.test', password: 'Password123!' })).statusCode).toBe(200);
  });

  test('a database failure is a generic 500', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    query.mockRejectedValue(new Error('Login failed for user pos_app'));
    const res = await post(login, { email: 'a@b.com', password: 'x' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/pos_app/);
    spy.mockRestore();
  });
});

describe('POST /api/auth/employee-login', () => {
  test.each([['Manager', 'manager'], ['Support', 'support']])('%s row gives role %s', async (dbRole, role) => {
    query.mockResolvedValue(rows({ id: 1000001, name: 'Sam', password_hash: hash, role: dbRole }));
    const res = await post(employeeLogin, { email: 'manager@posstore.test', password: 'Password123!' });
    expect(res.statusCode).toBe(200);
    expect(res.json.user.role).toBe(role);
    expect(query.mock.calls[0][0]).toMatch(/FROM\s+EMPLOYEE/);
    expect(query.mock.calls[0][0]).toMatch(/Marked_for_deletion = 0/);
  });

  test('wrong password is 401', async () => {
    query.mockResolvedValue(rows({ id: 1, name: 'Sam', password_hash: hash, role: 'Manager' }));
    expect((await post(employeeLogin, { email: 'manager@posstore.test', password: 'nope1234' })).statusCode).toBe(401);
  });
});

describe('POST /api/auth/register', () => {
  const good = { firstName: ' Zoe ', lastName: 'Ruiz', email: 'Zoe@Example.com', password: 'Sup3rSecret' };

  test('creates the customer, stores a bcrypt hash, signs in, returns 201', async () => {
    query.mockResolvedValue(rows({ id: 1000010 }));
    const res = await post(register, good);
    expect(res.statusCode).toBe(201);
    expect(res.json).toEqual({ user: { id: 1000010, name: 'Zoe', role: 'customer' } });
    expect(res.headers['set-cookie']).toMatch(/HttpOnly/);
    const [sqlText, params] = query.mock.calls[0];
    expect(sqlText).toMatch(/INSERT INTO CUSTOMER/);
    expect(params.email).toBe('zoe@example.com');
    expect(params.firstName).toBe('Zoe');
    expect(params.passwordHash).toMatch(/^\$2b\$10\$/);
    expect(JSON.stringify(params)).not.toContain('Sup3rSecret');
  });

  test('a taken email is 409', async () => {
    query.mockRejectedValue(Object.assign(new Error('Violation of UNIQUE KEY'), { number: 2627 }));
    const res = await post(register, good);
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('EMAIL_TAKEN');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test.each([
    ['no first name', { firstName: '' }],
    ['long last name', { lastName: 'x'.repeat(51) }],
    ['bad email', { email: 'zoe' }],
    ['weak password', { password: 'password' }],
    ['short password', { password: 'a1' }],
  ])('%s is 400', async (_, patch) => {
    const res = await post(register, { ...good, ...patch });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('extra fields such as role or points are ignored', async () => {
    query.mockResolvedValue(rows({ id: 1 }));
    const res = await post(register, { ...good, role: 'manager', Loyalty_points: 9999 });
    expect(res.json.user.role).toBe('customer');
    expect(Object.keys(query.mock.calls[0][1]).sort())
      .toEqual(['email', 'firstName', 'lastName', 'passwordHash']);
  });
});

describe('POST /api/auth/logout', () => {
  test('expires the cookie', async () => {
    const res = await post(logout);
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toMatch(/Max-Age=0/);
  });
});

describe('GET /api/auth/me', () => {
  function cookieHeader(user) {
    const r = mockRes();
    auth.setAuthCookie(r, user);
    return { cookie: cookieFrom(r) };
  }

  test('signed out is 401', async () => {
    expect((await call(me)).statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  test('customer is looked up in CUSTOMER, employee in EMPLOYEE', async () => {
    query.mockResolvedValueOnce(rows({ id: 1000003, name: 'Alice', role: 'customer' }));
    const a = await call(me, { headers: cookieHeader({ id: 1000003, role: 'customer', name: 'Alice' }) });
    expect(a.json.user).toEqual({ id: 1000003, name: 'Alice', role: 'customer' });
    expect(query.mock.calls[0][0]).toMatch(/FROM CUSTOMER/);

    query.mockResolvedValueOnce(rows({ id: 1000001, name: 'Sam', role: 'manager' }));
    const m = await call(me, { headers: cookieHeader({ id: 1000001, role: 'manager', name: 'Sam' }) });
    expect(m.json.user.role).toBe('manager');
    expect(query.mock.calls[1][0]).toMatch(/FROM EMPLOYEE/);
    expect(query.mock.calls[1][1]).toEqual({ id: 1000001 });
  });

  test('an account marked for deletion after sign-in is signed out', async () => {
    query.mockResolvedValue(rows());
    const res = await call(me, { headers: cookieHeader({ id: 1000003, role: 'customer', name: 'Alice' }) });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toMatch(/Max-Age=0/);
  });
});