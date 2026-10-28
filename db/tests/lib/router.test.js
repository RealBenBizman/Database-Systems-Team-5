const { segmentsFromRequest, matchRoute } = require('../../lib/router');

const load = (name) => () => name;
const routes = [
  { pattern: 'orders', load: load('orders') },
  { pattern: 'orders/[id]', load: load('orders/[id]') },
  { pattern: 'orders/recent', load: load('orders/recent') },
  { pattern: 'returns/[id]/approve', load: load('approve') },
  { pattern: 'auth/login', load: load('login') },
];

describe('segmentsFromRequest', () => {
  test('reads the path after /api/ and ignores the query string', () => {
    expect(segmentsFromRequest({ url: '/api/orders/1000001?x=1' })).toEqual(['orders', '1000001']);
    expect(segmentsFromRequest({ url: '/api/auth/login' })).toEqual(['auth', 'login']);
    expect(segmentsFromRequest({ url: '/api/' })).toEqual([]);
  });
  test('decodes pieces and refuses odd ones', () => {
    expect(segmentsFromRequest({ url: '/api/products/a%20b' })).toEqual(['products', 'a b']);
    // the URL parser already collapses "..", and routes are matched by name, never by file path
    expect(segmentsFromRequest({ url: '/api/a/%2e%2e/b' })).toEqual(['b']);
    expect(segmentsFromRequest({ url: '/api/a%2Fb' })).toBeNull();
    expect(segmentsFromRequest({ url: '/api/a/%E0%A4%A' })).toBeNull();
  });
  test('falls back to the catch-all parameter when the URL was rewritten', () => {
    expect(segmentsFromRequest({ url: '/somewhere', query: { path: ['orders', '7'] } })).toEqual(['orders', '7']);
    expect(segmentsFromRequest({ url: '/somewhere', query: { path: 'orders/7' } })).toEqual(['orders', '7']);
    expect(segmentsFromRequest({ url: '/somewhere' })).toEqual([]);
  });
});

describe('matchRoute', () => {
  test('finds a fixed route', () => {
    expect(matchRoute(routes, ['orders']).route.load()).toBe('orders');
    expect(matchRoute(routes, ['auth', 'login']).route.load()).toBe('login');
  });
  test('fills [id]-style values', () => {
    const m = matchRoute(routes, ['orders', '1000001']);
    expect(m.route.load()).toBe('orders/[id]');
    expect(m.params).toEqual({ id: '1000001' });
    expect(matchRoute(routes, ['returns', '55', 'approve']).params).toEqual({ id: '55' });
  });
  test('a fixed word beats [id]', () => {
    expect(matchRoute(routes, ['orders', 'recent']).route.load()).toBe('orders/recent');
  });
  test('returns null for unknown or wrong-length paths', () => {
    expect(matchRoute(routes, ['nope'])).toBeNull();
    expect(matchRoute(routes, ['orders', '1', 'extra'])).toBeNull();
    expect(matchRoute(routes, ['returns', '55'])).toBeNull();
    expect(matchRoute(routes, null)).toBeNull();
  });
  test('matching is case sensitive, like the file system on Vercel', () => {
    expect(matchRoute(routes, ['Orders'])).toBeNull();
  });
});
