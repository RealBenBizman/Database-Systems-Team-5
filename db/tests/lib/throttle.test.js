const throttle = require('../../lib/throttle');

beforeEach(() => throttle._clear());

test('allows attempts until the limit, then blocks with 429 and Retry-After', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < throttle.MAX_FAILURES; i++) {
    expect(() => throttle.check('k', t0)).not.toThrow();
    throttle.fail('k', t0);
  }
  try {
    throttle.check('k', t0 + 1000);
    throw new Error('should have been blocked');
  } catch (e) {
    expect(e.status).toBe(429);
    expect(e.retryAfter).toBeGreaterThan(0);
  }
});

test('different keys are counted separately', () => {
  for (let i = 0; i < throttle.MAX_FAILURES; i++) throttle.fail('a');
  expect(() => throttle.check('a')).toThrow();
  expect(() => throttle.check('b')).not.toThrow();
});

test('the block ends when the window ends', () => {
  const t0 = 5_000_000;
  for (let i = 0; i < throttle.MAX_FAILURES; i++) throttle.fail('k', t0);
  expect(() => throttle.check('k', t0 + throttle.WINDOW_MS - 1)).toThrow();
  expect(() => throttle.check('k', t0 + throttle.WINDOW_MS)).not.toThrow();
});

test('reset clears the count', () => {
  for (let i = 0; i < throttle.MAX_FAILURES; i++) throttle.fail('k');
  throttle.reset('k');
  expect(() => throttle.check('k')).not.toThrow();
});