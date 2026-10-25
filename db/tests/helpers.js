// Fake request/response objects so handlers can be called directly (no server).
function mockReq({ method = 'GET', body, headers = {}, ip = '1.2.3.4' } = {}) {
  return { method, body, headers: { 'x-forwarded-for': ip, ...headers }, socket: {} };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    writableEnded: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(text) { this.body = text; this.writableEnded = true; },
  };
  Object.defineProperty(res, 'json', { get() { return res.body ? JSON.parse(res.body) : undefined; } });
  return res;
}

// Pull "pos_token=..." out of a Set-Cookie header so it can be sent back.
function cookieFrom(res) {
  return String(res.headers['set-cookie']).split(';')[0];
}

module.exports = { mockReq, mockRes, cookieFrom };