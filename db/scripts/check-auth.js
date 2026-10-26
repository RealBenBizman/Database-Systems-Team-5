const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { mockReq, mockRes, cookieFrom } = require('../tests/helpers');
const db = require('../lib/db');
const login = require('../api/auth/login');
const employeeLogin = require('../api/auth/employee-login');
const register = require('../api/auth/register');
const logout = require('../api/auth/logout');
const me = require('../api/auth/me');

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '  -  ' + detail : ''}`);
}

async function call(handler, { method = 'POST', body, headers, ip } = {}) {
  const res = mockRes();
  await handler(mockReq({ method, body, headers, ip }), res);
  return res;
}
const PASSWORD = 'Password123!';
const quiet = console.error;

(async () => {
  console.error = () => {};
  try {

    const a = await call(login, { body: { email: 'Alice.Nguyen@posstore.test', password: PASSWORD } });
    check('Customer sign-in (alice)', a.statusCode === 200 && a.json.user.role === 'customer' && a.json.user.name === 'Alice',
      `status ${a.statusCode} ${a.body}`);
    check('Cookie is set and httpOnly', /pos_token=.+HttpOnly/.test(String(a.headers['set-cookie'])));
    check('Password hash is not in the response', !/\$2[aby]\$/.test(a.body || ''));

    const m = await call(me, { method: 'GET', headers: { cookie: cookieFrom(a) } });
    check('/me returns the signed-in customer', m.statusCode === 200 && m.json.user.id === a.json.user.id,
      `status ${m.statusCode} ${m.body}`);

    const w = await call(login, { body: { email: 'alice.nguyen@posstore.test', password: 'WrongPass1' }, ip: '5.5.5.5' });
    const u = await call(login, { body: { email: 'nobody@posstore.test', password: PASSWORD }, ip: '5.5.5.6' });
    check('Wrong password is 401', w.statusCode === 401, `status ${w.statusCode}`);
    check('Unknown email is the same 401 message', u.statusCode === 401 && u.json.error === w.json.error);

    const mg = await call(employeeLogin, { body: { email: 'manager@posstore.test', password: PASSWORD } });
    check('Manager sign-in', mg.statusCode === 200 && mg.json.user.role === 'manager', `status ${mg.statusCode} ${mg.body}`);
    const sp = await call(employeeLogin, { body: { email: 'support1@posstore.test', password: PASSWORD } });
    check('Support sign-in', sp.statusCode === 200 && sp.json.user.role === 'support', `status ${sp.statusCode} ${sp.body}`);
    const mm = await call(me, { method: 'GET', headers: { cookie: cookieFrom(mg) } });
    check('/me returns the manager', mm.statusCode === 200 && mm.json.user.role === 'manager', `status ${mm.statusCode} ${mm.body}`);

    const cross1 = await call(login, { body: { email: 'manager@posstore.test', password: PASSWORD }, ip: '6.6.6.1' });
    const cross2 = await call(employeeLogin, { body: { email: 'alice.nguyen@posstore.test', password: PASSWORD }, ip: '6.6.6.2' });
    check('A staff email cannot use customer sign-in', cross1.statusCode === 401, `status ${cross1.statusCode}`);
    check('A customer email cannot use staff sign-in', cross2.statusCode === 401, `status ${cross2.statusCode}`);

    let last;
    for (let i = 0; i < 6; i++) {
      last = await call(login, { body: { email: 'brandon.lee@posstore.test', password: 'bad' + i }, ip: '7.7.7.7' });
    }
    check('Sixth wrong attempt is blocked (429)', last.statusCode === 429, `status ${last.statusCode}`);

    const lo = await call(logout);
    check('Logout clears the cookie', lo.statusCode === 200 && /Max-Age=0/.test(String(lo.headers['set-cookie'])));
    const noCookie = await call(me, { method: 'GET' });
    check('/me without a cookie is 401', noCookie.statusCode === 401);

    if (process.argv.includes('--register')) {
      const email = `check.${Date.now()}@example.com`;
      const body = { firstName: 'Check', lastName: 'Script', email, password: 'Sup3rSecret' };
      const r1 = await call(register, { body });
      check('Sign-up creates a customer (201)', r1.statusCode === 201 && r1.json.user.role === 'customer', `status ${r1.statusCode} ${r1.body}`);
      const r2 = await call(register, { body });
      check('Same email again is 409', r2.statusCode === 409, `status ${r2.statusCode} ${r2.body}`);
      const r3 = await call(login, { body: { email, password: 'Sup3rSecret' } });
      check('The new account can sign in', r3.statusCode === 200, `status ${r3.statusCode}`);
    } else {
      console.log('SKIP  Sign-up (run with --register to include it; it adds one customer row)');
    }
  } catch (err) {
    failures += 1;
    quiet(`FAIL  Unexpected error: ${err.code || ''} ${err.message}`);
  } finally {
    console.error = quiet;
    try { (await db.getPool()).close(); } catch (_) {              }
  }
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();