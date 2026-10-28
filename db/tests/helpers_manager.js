// Fake request/response plus a fake database, so the manager endpoints can be tested without SQL Server.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';
const { signToken } = require('../lib/auth');
const { mockRes } = require('./helpers');

function req({ method = 'GET', body, query = {}, role } = {}) {
  const headers = {};
  if (role) headers.cookie = 'pos_token=' + signToken({ id: 1000001, role, name: 'Test' });
  return { method, body, query, headers, socket: {} };
}

async function call(handler, options) {
  const res = mockRes();
  await handler(req(options), res);
  return res;
}

// what a successful query returns
const rows = (recordset = [], affected = 1) => ({ recordset, rowsAffected: [affected] });

// make db.withTransaction run the callback with a fake tx; returns the tx.query mock
function fakeTransaction(db) {
  const tx = { query: jest.fn() };
  db.withTransaction.mockImplementation(async (fn) => fn(tx));
  return tx.query;
}

// a SQL Server error as the mssql driver reports it
const sqlError = (number, message) => Object.assign(new Error(message), { number });

module.exports = { call, rows, fakeTransaction, sqlError };
