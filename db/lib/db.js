/*
   lib/db.js - the one place that talks to SQL Server

   Environment variables (see .env.example):
     DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD,
     DB_PORT (default 1433) or DB_INSTANCE (a named instance such as SQLEXPRESS;
       needs the SQL Server Browser service, and then the port is ignored),
     DB_ENCRYPT (default true), DB_TRUST_SERVER_CERT (default false)
     DB_CONNECT_TIMEOUT_MS (default 30000)
     DB_RETRY_SECONDS (default 40): how long to keep retrying while a hosted
       database wakes up (Azure SQL serverless pauses when idle). 0 = no retry.

   Usage in an API file:
     const { query, withTransaction, sql } = require('../../lib/db');

     const r = await query(
       'SELECT Customer_id FROM CUSTOMER WHERE Email = @email AND Marked_for_deletion = 0',
       { email: 'a@b.com' });
     r.recordset   // array of rows

   Always pass values as parameters (@name). Never build SQL by gluing strings.
   Every list or detail query must filter Marked_for_deletion = 0.
*/
const sql = require('mssql');

let poolPromise = null;

// Replaceable in tests so they do not really wait.
const timing = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

// Azure SQL serverless answers these while it is waking up or briefly busy.
const TRANSIENT_NUMBERS = new Set([40613, 40197, 40501, 49918, 49919, 49920, 10928, 10929]);
const TRANSIENT_TEXT = /not currently available|is being resumed|service is currently busy|\b(40613|40197|40501|49918)\b/i;

function flag(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function buildConfig(env = process.env) {
  for (const name of ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[name]) throw new Error(`Missing environment variable ${name}`);
  }
  const config = {
    server: env.DB_SERVER,
    database: env.DB_DATABASE,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      encrypt: flag(env.DB_ENCRYPT, true),
      trustServerCertificate: flag(env.DB_TRUST_SERVER_CERT, false),
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: Number(env.DB_CONNECT_TIMEOUT_MS) || 30000,
    requestTimeout: 15000,
  };
  if (env.DB_INSTANCE) {
    config.options.instanceName = env.DB_INSTANCE; // the port is found through SQL Server Browser
  } else {
    config.port = env.DB_PORT ? Number(env.DB_PORT) : 1433;
  }
  return config;
}

// Is this connection error the kind that goes away by itself? Only used while
// connecting, never for queries, so a write is never repeated.
function isTransient(err, config) {
  const numbers = [err && err.number, err && err.originalError && err.originalError.number,
    err && err.originalError && err.originalError.info && err.originalError.info.number];
  if (numbers.some((n) => TRANSIENT_NUMBERS.has(n))) return true;
  if (TRANSIENT_TEXT.test(String((err && err.message) || ''))) return true;
  // A timeout is only treated as "still waking up" for Azure SQL; against any
  // other server it usually means a wrong address, and waiting would not help.
  const hosted = /\.database\.windows\.net$/i.test(String((config && config.server) || ''));
  return Boolean(hosted && err && (err.code === 'ETIMEOUT' || /timeout/i.test(String(err.message || ''))));
}

// Connects, retrying transient errors with a growing pause until the budget
// (DB_RETRY_SECONDS) is used up. Other errors are thrown at once.
async function connectWithRetry(config, env = process.env) {
  const raw = env.DB_RETRY_SECONDS;
  const budgetMs = (raw === undefined || raw === '' ? 40 : Number(raw)) * 1000;
  const started = Date.now();
  let pause = 2000;
  let slept = 0;
  for (;;) {
    try {
      return await new sql.ConnectionPool(config).connect();
    } catch (err) {
      const spent = Math.max(Date.now() - started, slept);
      if (!(budgetMs > 0) || !isTransient(err, config) || spent + pause > budgetMs) throw err;
      await timing.sleep(pause);
      slept += pause;
      pause = Math.min(pause * 2, 10000);
    }
  }
}

// One pool per server instance. A failed connect is not cached, so the next
// request tries again.
function getPool() {
  if (!poolPromise) {
    poolPromise = connectWithRetry(buildConfig()).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// params: { name: value }  or  { name: { type: sql.Int, value: 5 } }
function bind(request, params) {
  for (const [name, p] of Object.entries(params || {})) {
    if (p !== null && typeof p === 'object' && 'type' in p && 'value' in p) {
      request.input(name, p.type, p.value);
    } else {
      request.input(name, p);
    }
  }
  return request;
}

async function query(text, params) {
  const pool = await getPool();
  return bind(pool.request(), params).query(text);
}

// Runs fn(tx) inside one transaction. tx.query(text, params) works like query().
// Commits when fn returns, rolls back and rethrows when fn throws.
async function withTransaction(fn) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  const tx = {
    query: (text, params) => bind(new sql.Request(transaction), params).query(text),
  };
  try {
    const result = await fn(tx);
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch (_) {
      // the transaction may already be rolled back by SQL Server; keep the original error
    }
    throw err;
  }
}

// For tests only: forget the cached pool.
function _reset() {
  poolPromise = null;
}

module.exports = { sql, buildConfig, getPool, query, withTransaction, isTransient, connectWithRetry, _reset, _timing: timing };
