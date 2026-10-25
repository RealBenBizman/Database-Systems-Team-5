/*
   lib/http.js - small helpers shared by every API function

   An API file looks like this:

     const { route } = require('../../lib/http');
     module.exports = route({ GET: async (req) => ({ hello: 'world' }) });

   A method function returns the JSON body (status 200), or
   { status: 201, body: {...} } to choose a status, and may throw
   HttpError(status, message) for expected failures. Anything else becomes a
   generic 500 so database details never reach the browser.
*/

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

// Messages from our own triggers (THROW 50001..50099) are written for people,
// so they are safe to show. 409 = the request conflicts with the data's rules.
const TRIGGER_ERROR_MIN = 50001;
const TRIGGER_ERROR_MAX = 50099;

function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function toHttpError(err) {
  if (err instanceof HttpError) return err;

  const number = err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
  if (number >= TRIGGER_ERROR_MIN && number <= TRIGGER_ERROR_MAX) {
    return new HttpError(409, err.message, 'RULE_VIOLATION');
  }
  if (number === 2627 || number === 2601) {
    return new HttpError(409, 'That value is already in use.', 'DUPLICATE');
  }
  return null;
}

function sendError(res, err) {
  const known = toHttpError(err);
  if (known) {
    const headers = known.retryAfter ? { 'Retry-After': String(known.retryAfter) } : {};
    return sendJson(res, known.status, { error: known.message, code: known.code }, headers);
  }
  console.error(err);
  return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
}

// Vercel parses JSON bodies for us (req.body). Accept a string too, and
// reject anything that is not a JSON object.
function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      throw new HttpError(400, 'The request body is not valid JSON.');
    }
  }
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }
  return body;
}

function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// route({ GET: fn, POST: fn }) -> (req, res) handler
function route(methods) {
  return async function handler(req, res) {
    try {
      const fn = methods[req.method];
      if (!fn) {
        throw new HttpError(405, 'Method not allowed.');
      }
      const out = await fn(req, res);
      if (res.writableEnded) return;
      if (out && typeof out === 'object' && 'status' in out && 'body' in out) {
        return sendJson(res, out.status, out.body, out.headers);
      }
      return sendJson(res, 200, out === undefined ? {} : out);
    } catch (err) {
      if (err instanceof HttpError && err.status === 405) {
        res.setHeader('Allow', Object.keys(methods).join(', '));
      }
      return sendError(res, err);
    }
  };
}

module.exports = { HttpError, sendJson, sendError, readBody, clientIp, route };