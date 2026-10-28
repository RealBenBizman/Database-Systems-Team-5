jest.mock('../lib/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const db = require('../lib/db');
const { call, rows, fakeTransaction, sqlError } = require('./helpers_manager');
const taxRates = require('../server/manager/tax-rates');
const programs = require('../server/manager/reward-programs');

beforeEach(() => { jest.resetAllMocks(); });

describe('tax rates', () => {
  const good = { categoryId: 1000001, state: 'tx', rate: 0.0825, effectiveFrom: '2026-01-01', effectiveTo: '' };

  test('list needs a manager', async () => {
    db.query.mockResolvedValue(rows([{ taxRateId: 1 }]));
    expect((await call(taxRates, { role: 'manager' })).json.taxRates).toHaveLength(1);
    expect((await call(taxRates, { role: 'support' })).statusCode).toBe(403);
    expect((await call(taxRates, {})).statusCode).toBe(401);
  });
  test('creates a rate: state upper case, open-ended end date', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ Category_id: 1 }])).mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ taxRateId: 1000077 }]));
    const res = await call(taxRates, { method: 'POST', role: 'manager', body: good });
    expect(res.statusCode).toBe(201);
    expect(q.mock.calls[1][1]).toMatchObject({ state: 'TX', from: '2026-01-01', to: null, selfId: 0 });
    expect(q.mock.calls[1][0]).toMatch(/Marked_for_deletion = 0/);
    expect(q.mock.calls[2][1].rate).toBe(0.0825);
  });
  test('an overlapping rate for the same category and state is 409 and nothing is inserted', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ Category_id: 1 }])).mockResolvedValueOnce(rows([{ Tax_rate_id: 5 }]));
    const res = await call(taxRates, { method: 'POST', role: 'manager', body: good });
    expect(res.statusCode).toBe(409);
    expect(q).toHaveBeenCalledTimes(2);
  });
  test.each([
    ['a percent instead of a fraction', { rate: 8.25 }],
    ['a negative rate', { rate: -0.1 }],
    ['a state with 3 letters', { state: 'TEX' }],
    ['a fake date', { effectiveFrom: '2026-02-30' }],
    ['a date in the wrong format', { effectiveFrom: '01/01/2026' }],
    ['an end before the start', { effectiveTo: '2025-12-31' }],
  ])('%s is 400', async (_n, change) => {
    const res = await call(taxRates, { method: 'POST', role: 'manager', body: { ...good, ...change } });
    expect(res.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });
  test('edit ignores itself when checking overlap, and 404 when missing', async () => {
    const q = fakeTransaction(db);
    q.mockResolvedValueOnce(rows([{ categoryId: 7, state: 'TX' }])).mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([], 1));
    const res = await call(taxRates, { method: 'PUT', role: 'manager', body: { taxRateId: 1000077, rate: 0.07, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' } });
    expect(res.statusCode).toBe(200);
    expect(q.mock.calls[1][1]).toMatchObject({ categoryId: 7, state: 'TX', selfId: 1000077 });

    q.mockReset();
    q.mockResolvedValueOnce(rows([]));
    const missing = await call(taxRates, { method: 'PUT', role: 'manager', body: { taxRateId: 1, rate: 0.07, effectiveFrom: '2026-01-01' } });
    expect(missing.statusCode).toBe(404);
  });
});

describe('reward programs', () => {
  const good = { programName: 'Standard', pointsPerDollar: '1.5', effectiveFrom: '2026-01-01', effectiveTo: null };
  test('list, create and roles', async () => {
    db.query.mockResolvedValueOnce(rows([{ programId: 1 }]));
    expect((await call(programs, { role: 'manager' })).json.programs).toHaveLength(1);
    db.query.mockResolvedValueOnce(rows([{ programId: 1000005 }]));
    const made = await call(programs, { method: 'POST', role: 'manager', body: good });
    expect(made.statusCode).toBe(201);
    expect(db.query.mock.calls[1][1]).toMatchObject({ pointsPerDollar: 1.5, to: null });
    expect(db.query.mock.calls[1][0]).toMatch(/Redemption_rate/);
    expect((await call(programs, { method: 'POST', role: 'support', body: good })).statusCode).toBe(403);
  });
  test('the overlap trigger error 50002 becomes 409 with its message', async () => {
    db.query.mockRejectedValueOnce(sqlError(50002, 'Reward programs cannot have overlapping dates.'));
    const res = await call(programs, { method: 'POST', role: 'manager', body: good });
    expect(res.statusCode).toBe(409);
    expect(res.json.error).toBe('Reward programs cannot have overlapping dates.');
  });
  test('bad input is 400', async () => {
    for (const change of [{ pointsPerDollar: -1 }, { pointsPerDollar: 'lots' }, { programName: '' }, { effectiveTo: '2025-01-01' }]) {
      expect((await call(programs, { method: 'POST', role: 'manager', body: { ...good, ...change } })).statusCode).toBe(400);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
  test('edit 404 when missing', async () => {
    db.query.mockResolvedValueOnce(rows([], 0));
    expect((await call(programs, { method: 'PUT', role: 'manager', body: { ...good, programId: 1000005 } })).statusCode).toBe(404);
  });
});
