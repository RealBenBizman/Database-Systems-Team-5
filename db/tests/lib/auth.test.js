const jwt = require('jsonwebtoken');

const SECRET = 'test-secret-test-secret-test-secret-123';
process.env.JWT_SECRET = SECRET;

const auth = require('../../lib/auth');
const { mockReq, mockRes, cookieFrom } = require('../helpers');

const user = { id: 1000003, role: 'customer', name: 'Alice' };

function reqWithCookie(res) {
  return mockReq({ headers: { cookie: cookieFrom(res) } });
}

test('cookie round trip gives the same user back', () => {
  const res = mockRes();
  auth.setAuthCookie(res, user);
  expect(auth.getUser(reqWithCookie(res))).toEqual(user);
});

test('cookie is httpOnly, SameSite=Lax and expires; Secure only in production', () => {
  const res = mockRes();
  auth.setAuthCookie(res, user);
  const c = res.headers['set-cookie'];
  expect(c).toMatch(/HttpOnly/);
  expect(c).toMatch(/SameSite=Lax/);
  expect(c).toMatch(/Max-Age=28800/);
  expect(c).not.toMatch(/Secure/);

  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res2 = mockRes();
  auth.setAuthCookie(res2, user);
  expect(res2.headers['set-cookie']).toMatch(/Secure/);
  process.env.NODE_ENV = old;
});

test('clearAuthCookie expires the cookie immediately', () => {
  const res = mockRes();
  auth.clearAuthCookie(res);
  expect(res.headers['set-cookie']).toMatch(/^pos_token=; .*Max-Age=0/);
});

test('no cookie, junk, tampered, wrong-secret, expired and alg=none tokens are all "not signed in"', () => {
  const none = mockReq();
  expect(auth.getUser(none)).toBeNull();
  expect(auth.getUser(mockReq({ headers: { cookie: 'pos_token=junk' } }))).toBeNull();

  const wrongSecret = jwt.sign({ role: 'manager', name: 'x' }, 'another-secret-another-secret-123456', { subject: '1' });
  expect(auth.getUser(mockReq({ headers: { cookie: `pos_token=${wrongSecret}` } }))).toBeNull();

  const expired = jwt.sign({ role: 'manager', name: 'x' }, SECRET, { subject: '1', expiresIn: -10 });
  expect(auth.getUser(mockReq({ headers: { cookie: `pos_token=${expired}` } }))).toBeNull();

  const unsigned = jwt.sign({ role: 'manager', name: 'x' }, '', { subject: '1', algorithm: 'none' });
  expect(auth.getUser(mockReq({ headers: { cookie: `pos_token=${unsigned}` } }))).toBeNull();

  const badRole = jwt.sign({ role: 'admin', name: 'x' }, SECRET, { subject: '1' });
  expect(auth.getUser(mockReq({ headers: { cookie: `pos_token=${badRole}` } }))).toBeNull();
});

test('requireAuth: 401 when signed out, 403 for the wrong role, user when allowed', () => {
  const res = mockRes();
  auth.setAuthCookie(res, user);
  const req = reqWithCookie(res);

  expect(() => auth.requireAuth(mockReq())).toThrow(expect.objectContaining({ status: 401 }));
  expect(() => auth.requireAuth(req, ['manager'])).toThrow(expect.objectContaining({ status: 403 }));
  expect(auth.requireAuth(req)).toEqual(user);
  expect(auth.requireAuth(req, ['customer', 'support'])).toEqual(user);
});

test('a missing or short JWT_SECRET is a server error, not a bad login', () => {
  const res = mockRes();
  auth.setAuthCookie(res, user);
  const req = reqWithCookie(res);
  process.env.JWT_SECRET = 'short';
  expect(() => auth.getUser(req)).toThrow(/JWT_SECRET/);
  process.env.JWT_SECRET = SECRET;
});

test('passwords: hash is bcrypt, right password passes, wrong or missing hash fails', async () => {
  const hash = await auth.hashPassword('Password123!');
  expect(hash).toMatch(/^\$2[aby]\$10\$/);
  expect(await auth.checkPassword('Password123!', hash)).toBe(true);
  expect(await auth.checkPassword('wrong', hash)).toBe(false);
  expect(await auth.checkPassword('Password123!', undefined)).toBe(false);
});

test('the dummy hash is a valid bcrypt hash (so the timing step really runs)', async () => {
  expect(await auth.checkPassword('anything', auth.DUMMY_HASH)).toBe(false);
  expect(auth.DUMMY_HASH).toMatch(/^\$2b\$10\$.{53}$/);
});

test('parseCookies handles several cookies and encoded values', () => {
  expect(auth.parseCookies({ headers: { cookie: 'a=1; pos_token=x%20y; b=2' } }))
    .toEqual({ a: '1', pos_token: 'x y', b: '2' });
  expect(auth.parseCookies({ headers: {} })).toEqual({});
});

test('requireAuth(roles)(handler): runs the handler with req.user, or replies 401/403 itself', async () => {
  const signedIn = mockRes();
  auth.setAuthCookie(signedIn, user);
  const handler = jest.fn(async (req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ id: req.user.id }));
  });

  // allowed
  const ok = mockRes();
  await auth.requireAuth(['customer'])(handler)(reqWithCookie(signedIn), ok);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(ok.json).toEqual({ id: user.id });

  // any signed-in user
  const any = mockRes();
  await auth.requireAuth()(handler)(reqWithCookie(signedIn), any);
  expect(handler).toHaveBeenCalledTimes(2);

  // wrong role: 403 and the handler is not called
  const forbidden = mockRes();
  await auth.requireAuth(['manager'])(handler)(reqWithCookie(signedIn), forbidden);
  expect(forbidden.statusCode).toBe(403);
  expect(handler).toHaveBeenCalledTimes(2);

  // signed out: 401 and the handler is not called
  const out = mockRes();
  await auth.requireAuth(['customer'])(handler)(mockReq(), out);
  expect(out.statusCode).toBe(401);
  expect(handler).toHaveBeenCalledTimes(2);
});