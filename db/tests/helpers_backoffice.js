/// Small fake request/response so a test can call an API file directly.
// Jest keeps its own copy of the environment, so we copy .env.local into it by hand.
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  Object.assign(process.env, require('util').parseEnv(fs.readFileSync(envFile, 'utf8')));
}

const { signToken } = require('../lib/auth');

function mockReq({ method = 'GET', body, role, id = 1 } = {}) {
  const headers = {};
  if (role) headers.cookie = 'pos_token=' + signToken({ id, role, name: 'Test' });
  return { method, body, headers };
}

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null, writableEnded: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(text) { this.body = text ? JSON.parse(text) : null; this.writableEnded = true; },
  };
}

async function call(handler, options) {
  const res = mockRes();
  await handler(mockReq(options), res);
  return res;
}

module.exports = { call };