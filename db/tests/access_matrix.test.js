// The access matrix: who may open which endpoint and screen.
// If this fails after you add an endpoint or a screen, decide who may use it,
// then add it to the right list below. (Nothing here touches the real database.)
// `sql` is the real mssql module: the sales report builds typed parameters with sql.Int and sql.VarChar
jest.mock('../lib/db', () => ({ sql: jest.requireActual('mssql'), query: jest.fn(), withTransaction: jest.fn() }));
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const routes = require('../lib/routes.generated');
const { call } = require('./helpers_manager');

// Endpoints Support (Customer Support Representative) may read. Everything else under manager/ is manager only.
const SUPPORT_MAY_READ = ['manager/alerts', 'manager/dashboard', 'manager/products'];

// Screens Support may open (staff screens whose access is STAFF in src/app/routes.jsx).
const SUPPORT_MAY_OPEN = ['/staff/dashboard', '/staff/inventory', '/staff/returns'];

const patterns = routes.map((r) => r.pattern);
const handlerOf = (pattern) => routes.find((r) => r.pattern === pattern).load();
const staffEndpoints = patterns.filter((p) => p.startsWith('manager/') || p.startsWith('reports/'));
const reportEndpoints = patterns.filter((p) => p.startsWith('reports/'));

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

beforeEach(() => {
  jest.resetAllMocks();
  db.query.mockResolvedValue({ recordset: [{ openAlerts: 0, pendingOrders: 0, returnsWaiting: 0 }], rowsAffected: [0] });
});

// the status code of every HTTP method on one endpoint (405 means "this endpoint has no such method")
async function codesFor(pattern, role) {
  const out = {};
  for (const method of METHODS) {
    out[method] = (await call(handlerOf(pattern), { role, method, query: { id: '1' }, body: {} })).statusCode;
  }
  return out;
}
const values = (o) => Object.values(o);

test('the matrix covers the endpoints that exist today', () => {
  expect(staffEndpoints.length).toBeGreaterThan(10);
  expect(reportEndpoints.length).toBeGreaterThanOrEqual(3);
  for (const p of SUPPORT_MAY_READ) expect(patterns).toContain(p);
});

describe('nobody signed in', () => {
  test.each(staffEndpoints)('%s answers 401', async (pattern) => {
    const codes = values(await codesFor(pattern, undefined));
    expect(codes).toContain(401);
    for (const c of codes) expect([401, 405]).toContain(c);
  });
});

describe('customers', () => {
  test.each(staffEndpoints)('%s answers 403', async (pattern) => {
    const codes = values(await codesFor(pattern, 'customer'));
    expect(codes).toContain(403);
    for (const c of codes) expect([403, 405]).toContain(c);
  });
});

describe('support', () => {
  const refused = staffEndpoints.filter((p) => !SUPPORT_MAY_READ.includes(p));

  test.each(refused)('%s answers 403 and never reads the database', async (pattern) => {
    const codes = values(await codesFor(pattern, 'support'));
    expect(codes).toContain(403);
    for (const c of codes) expect([403, 405]).toContain(c);
    expect(db.query).not.toHaveBeenCalled();
  });

  test.each(SUPPORT_MAY_READ)('%s may be read, and only read', async (pattern) => {
    const codes = await codesFor(pattern, 'support');
    expect(codes.GET).toBe(200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect([403, 405]).toContain(codes[method]);
  });
});

describe('managers', () => {
  test.each(staffEndpoints)('%s lets a manager in', async (pattern) => {
    const codes = values(await codesFor(pattern, 'manager'));
    for (const c of codes) expect([401, 403]).not.toContain(c);
  });
});

describe('screens (src/app/routes.jsx)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'routes.jsx'), 'utf8');
  const screens = [...text.matchAll(/path:\s*'([^']+)',\s*access:\s*('public'|\w+)/g)]
    .map((m) => ({ path: m[1], access: m[2] }));

  test('the screen list was read', () => {
    expect(screens.length).toBeGreaterThan(20);
  });

  test('every report screen is manager only', () => {
    const reports = screens.filter((s) => s.path.startsWith('/staff/reports/'));
    expect(reports.length).toBeGreaterThanOrEqual(3);
    for (const s of reports) expect([s.path, s.access]).toEqual([s.path, 'MANAGER']);
  });

  test('Support can open only the screens on its list', () => {
    const forSupport = screens.filter((s) => s.path.startsWith('/staff/') && s.access === 'STAFF').map((s) => s.path);
    expect(forSupport.sort()).toEqual([...SUPPORT_MAY_OPEN].sort());
  });

  test('supplier screens are manager only', () => {
    for (const s of screens.filter((x) => /supplier/.test(x.path))) expect(s.access).toBe('MANAGER');
  });
});