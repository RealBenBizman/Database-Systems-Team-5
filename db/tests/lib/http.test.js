const { HttpError, route, sendError, readBody } = require('../../lib/http');
const { mockReq, mockRes } = require('../helpers');

test('route returns 200 JSON for a plain return value', async () => {
  const res = mockRes();
  await route({ GET: async () => ({ hello: 'world' }) })(mockReq(), res);
  expect(res.statusCode).toBe(200);
  expect(res.json).toEqual({ hello: 'world' });
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.headers['cache-control']).toBe('no-store');
});

test('route honours { status, body }', async () => {
  const res = mockRes();
  await route({ POST: () => ({ status: 201, body: { id: 3 } }) })(mockReq({ method: 'POST' }), res);
  expect(res.statusCode).toBe(201);
  expect(res.json).toEqual({ id: 3 });
});

test('unsupported method gives 405 with an Allow header', async () => {
  const res = mockRes();
  await route({ GET: () => ({}), POST: () => ({}) })(mockReq({ method: 'DELETE' }), res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.allow).toBe('GET, POST');
});

test('HttpError keeps its status and message', async () => {
  const res = mockRes();
  await route({ GET: () => { throw new HttpError(403, 'No.', 'FORBIDDEN'); } })(mockReq(), res);
  expect(res.statusCode).toBe(403);
  expect(res.json).toEqual({ error: 'No.', code: 'FORBIDDEN' });
});

test('trigger errors (50001-50099) become 409 with their message', () => {
  const res = mockRes();
  sendError(res, Object.assign(new Error('A completed or voided sale cannot change status.'), { number: 50003 }));
  expect(res.statusCode).toBe(409);
  expect(res.json.error).toBe('A completed or voided sale cannot change status.');
});

test('duplicate key errors become 409', () => {
  const res = mockRes();
  sendError(res, Object.assign(new Error('Violation of UNIQUE KEY constraint ...'), { number: 2627 }));
  expect(res.statusCode).toBe(409);
  expect(res.json.error).not.toMatch(/UNIQUE KEY/);
});

test('unknown errors become a generic 500 and do not leak details', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = mockRes();
  sendError(res, new Error('Login failed for user sa at 10.0.0.5'));
  expect(res.statusCode).toBe(500);
  expect(res.body).not.toMatch(/sa|10\.0\.0\.5/);
  spy.mockRestore();
});

test('429 carries Retry-After', () => {
  const res = mockRes();
  const e = new HttpError(429, 'Slow down.');
  e.retryAfter = 42;
  sendError(res, e);
  expect(res.headers['retry-after']).toBe('42');
});

test('readBody: object, JSON string, empty, and bad input', () => {
  expect(readBody({ body: { a: 1 } })).toEqual({ a: 1 });
  expect(readBody({ body: '{"a":2}' })).toEqual({ a: 2 });
  expect(readBody({})).toEqual({});
  expect(() => readBody({ body: '{oops' })).toThrow(HttpError);
  expect(() => readBody({ body: [1, 2] })).toThrow(HttpError);
  expect(() => readBody({ body: 'null' })).not.toThrow();
});