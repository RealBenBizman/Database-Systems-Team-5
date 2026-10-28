/*
   Guards for the single Vercel function (api/[...path].js).
   - routes.generated.js must list exactly the files in server/ (run "npm run routes" if this fails)
   - every listed endpoint can be reached through its own URL
   - the dispatcher fills req.query and answers 404 for unknown paths
*/
const { manifestText } = require('../scripts/build-routes');
const fs = require('fs');
const path = require('path');
const routes = require('../lib/routes.generated');
const { matchRoute } = require('../lib/router');
const { mockReq, mockRes } = require('./helpers');

test('lib/routes.generated.js is up to date with server/', () => {
  const { text, problems } = manifestText();
  const onDisk = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes.generated.js'), 'utf8');
  expect(problems.filter((p) => /not supported/.test(p))).toEqual([]);
  expect(onDisk.replace(/\r\n/g, '\n')).toBe(text);
});

test('there is exactly one function file in api/', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'api'), { recursive: true })
    .filter((f) => f.endsWith('.js'));
  expect(files).toEqual(['[...path].js']);
});

test('every endpoint is reachable through its own URL', () => {
  expect(routes.length).toBeGreaterThan(0);
  for (const r of routes) {
    const segments = r.pattern === '' ? [] : r.pattern.split('/').map((p) => (/^\[.+\]$/.test(p) ? 'x7' : p));
    const m = matchRoute(routes, segments);
    expect(m && m.route.pattern).toBe(r.pattern);
  }
});

test('every endpoint file loads and exports a function', () => {
  for (const r of routes) {
    expect(typeof r.load()).toBe('function');
  }
});

describe('dispatcher', () => {
  const fake = jest.fn(async (req, res) => { res.end(JSON.stringify({ query: req.query })); });
  let handler;
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../lib/routes.generated', () => [
      { pattern: 'orders/[id]', load: () => fake },
      { pattern: 'boom', load: () => async () => { throw new Error('bad'); } },
    ]);
    handler = require('../api/[...path]');
  });
  afterAll(() => jest.dontMock('../lib/routes.generated'));

  test('passes the query string and [id] to the endpoint, without the catch-all name', async () => {
    const res = mockRes();
    const req = { ...mockReq(), url: '/api/orders/1000001?status=open', query: { path: ['orders', '1000001'], status: 'open' } };
    await handler(req, res);
    expect(res.json.query).toEqual({ status: 'open', id: '1000001' });
  });
  test('unknown path gives a JSON 404', async () => {
    const res = mockRes();
    await handler({ ...mockReq(), url: '/api/nope', query: { path: ['nope'] } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.json.error).toMatch(/No such API route/);
  });
  test('an endpoint that crashes gives a JSON 500', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await handler({ ...mockReq(), url: '/api/boom', query: { path: ['boom'] } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.json.error).toMatch(/Something went wrong/);
    spy.mockRestore();
  });
});
