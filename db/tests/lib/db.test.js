jest.mock('mssql', () => {
  const calls = { inputs: [], queries: [], begun: 0, committed: 0, rolledBack: 0, connects: 0, connectErrors: [] };
  class Request {
    input(...args) { calls.inputs.push(args); return this; }
    async query(text) { calls.queries.push(text); if (calls.failQuery) throw new Error('boom'); return { recordset: [{ ok: 1 }] }; }
  }
  class ConnectionPool {
    constructor(cfg) { calls.config = cfg; }
    async connect() {
      calls.connects += 1;
      if (calls.connectErrors.length) throw calls.connectErrors.shift();
      if (calls.failConnect) { calls.failConnect = false; throw new Error('down'); }
      return this;
    }
    request() { return new Request(); }
  }
  class Transaction {
    async begin() { calls.begun += 1; }
    async commit() { calls.committed += 1; }
    async rollback() { calls.rolledBack += 1; }
  }
  return { ConnectionPool, Transaction, Request, Int: 'Int', __calls: calls };
});

const mssql = require('mssql');
const db = require('../../lib/db');
const calls = mssql.__calls;

let sleeps = [];
const ENV = { DB_SERVER: 'srv', DB_DATABASE: 'pos_store', DB_USER: 'pos_app', DB_PASSWORD: 'pw' };

beforeEach(() => {
  Object.assign(process.env, ENV);
  Object.assign(calls, { inputs: [], queries: [], begun: 0, committed: 0, rolledBack: 0, connects: 0, failQuery: false, failConnect: false, connectErrors: [] });
  delete process.env.DB_RETRY_SECONDS;
  delete process.env.DB_CONNECT_TIMEOUT_MS;
  sleeps = [];
  db._timing.sleep = async (ms) => { sleeps.push(ms); };
  db._reset();
});

test('buildConfig reads the environment and defaults to encrypted, port 1433', () => {
  const cfg = db.buildConfig(ENV);
  expect(cfg).toMatchObject({ server: 'srv', port: 1433, database: 'pos_store', user: 'pos_app' });
  expect(cfg.options).toEqual({ encrypt: true, trustServerCertificate: false });
  const cfg2 = db.buildConfig({ ...ENV, DB_PORT: '1444', DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERT: 'true' });
  expect(cfg2.port).toBe(1444);
  expect(cfg2.options).toEqual({ encrypt: false, trustServerCertificate: true });
});

test('DB_INSTANCE uses the named instance and drops the port', () => {
  const cfg = db.buildConfig({ ...ENV, DB_PORT: '1444', DB_INSTANCE: 'SQLEXPRESS' });
  expect(cfg.options.instanceName).toBe('SQLEXPRESS');
  expect(cfg.port).toBeUndefined();
});

test('buildConfig names the missing variable', () => {
  expect(() => db.buildConfig({ ...ENV, DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
});

test('query binds plain and typed parameters and reuses one pool', async () => {
  const r = await db.query('SELECT 1', { email: 'a@b.com', id: { type: mssql.Int, value: 5 } });
  await db.query('SELECT 2');
  expect(r.recordset).toEqual([{ ok: 1 }]);
  expect(calls.inputs).toEqual([['email', 'a@b.com'], ['id', 'Int', 5]]);
  expect(calls.connects).toBe(1);
});

test('a failed connection is retried on the next call', async () => {
  calls.failConnect = true;
  await expect(db.query('SELECT 1')).rejects.toThrow('down');
  await expect(db.query('SELECT 1')).resolves.toBeTruthy();
  expect(calls.connects).toBe(2);
});

test('withTransaction commits on success', async () => {
  const out = await db.withTransaction(async (tx) => { await tx.query('UPDATE x', { a: 1 }); return 'done'; });
  expect(out).toBe('done');
  expect(calls).toMatchObject({ begun: 1, committed: 1, rolledBack: 0 });
});

test('withTransaction rolls back and rethrows the original error', async () => {
  await expect(db.withTransaction(async () => { throw new Error('nope'); })).rejects.toThrow('nope');
  expect(calls).toMatchObject({ begun: 1, committed: 0, rolledBack: 1 });
});

// ---- waking up a paused hosted database (Azure SQL serverless) ----

const resuming = () => Object.assign(new Error("Database 'pos_store' on server 'x' is not currently available. Please retry the connection later."), { code: 'ELOGIN' });

test('connection timeout defaults to 30 s and can be changed', () => {
  expect(db.buildConfig(ENV).connectionTimeout).toBe(30000);
  expect(db.buildConfig({ ...ENV, DB_CONNECT_TIMEOUT_MS: '45000' }).connectionTimeout).toBe(45000);
});

test('isTransient recognises the wake-up errors by number and by message', () => {
  expect(db.isTransient(Object.assign(new Error('x'), { number: 40613 }), {})).toBe(true);
  expect(db.isTransient({ message: 'x', originalError: { number: 40197 } }, {})).toBe(true);
  expect(db.isTransient({ message: 'x', originalError: { info: { number: 49918 } } }, {})).toBe(true);
  expect(db.isTransient(resuming(), {})).toBe(true);
  expect(db.isTransient(new Error('Login failed for user pos_app'), {})).toBe(false);
  expect(db.isTransient(new Error('port 14061 refused'), {})).toBe(false);
});

test('a timeout counts as waking up only for an Azure SQL server', () => {
  const timeout = Object.assign(new Error('Failed to connect in 30000ms'), { code: 'ETIMEOUT' });
  expect(db.isTransient(timeout, { server: 'pos-team.database.windows.net' })).toBe(true);
  expect(db.isTransient(timeout, { server: 'localhost' })).toBe(false);
  expect(db.isTransient(timeout, {})).toBe(false);
});

test('connect retries while the database resumes, with growing pauses', async () => {
  calls.connectErrors = [resuming(), resuming(), resuming()];
  const r = await db.query('SELECT 1');
  expect(r.recordset).toEqual([{ ok: 1 }]);
  expect(calls.connects).toBe(4);
  expect(sleeps).toEqual([2000, 4000, 8000]);
});

test('connect gives up when the retry time is used up and says why', async () => {
  calls.connectErrors = Array.from({ length: 50 }, resuming);
  await expect(db.query('SELECT 1')).rejects.toThrow(/not currently available/);
  expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(40000);
  expect(calls.connects).toBeGreaterThan(3);
  expect(calls.connects).toBeLessThan(10);
});

test('DB_RETRY_SECONDS=0 turns retrying off', async () => {
  process.env.DB_RETRY_SECONDS = '0';
  calls.connectErrors = [resuming()];
  await expect(db.query('SELECT 1')).rejects.toThrow(/not currently available/);
  expect(calls.connects).toBe(1);
  expect(sleeps).toEqual([]);
});

test('other errors (wrong password, wrong host) are not retried', async () => {
  calls.connectErrors = [Object.assign(new Error('Login failed for user pos_app'), { code: 'ELOGIN' })];
  await expect(db.query('SELECT 1')).rejects.toThrow(/Login failed/);
  expect(calls.connects).toBe(1);
  expect(sleeps).toEqual([]);
});

test('after giving up, the next request tries again from scratch', async () => {
  process.env.DB_RETRY_SECONDS = '0';
  calls.connectErrors = [resuming()];
  await expect(db.query('SELECT 1')).rejects.toThrow();
  await expect(db.query('SELECT 1')).resolves.toBeTruthy();
});
