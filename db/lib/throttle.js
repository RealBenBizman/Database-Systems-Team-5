/*
   lib/throttle.js - slows down password guessing

   Counts failed logins per key (we use "ip|email"). After MAX_FAILURES
   failures inside WINDOW_MS the key is blocked until the window ends.

     throttle.check(key);    // throws HttpError 429 when blocked
     throttle.fail(key);     // call after a wrong password
     throttle.reset(key);    // call after a correct password

   Limit to know about: the counts live in the memory of one running server
   instance. Vercel may run several instances, so this is a speed bump, not a
   guarantee. Good enough for the project; say so in the README.
*/
const { HttpError } = require('./http');

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 5000; // stops the map from growing without limit

const failures = new Map(); // key -> { count, resetAt }

function live(key, now) {
  const entry = failures.get(key);
  if (entry && entry.resetAt <= now) {
    failures.delete(key);
    return null;
  }
  return entry || null;
}

function check(key, now = Date.now()) {
  const entry = live(key, now);
  if (entry && entry.count >= MAX_FAILURES) {
    const err = new HttpError(429, 'Too many attempts. Try again in a few minutes.', 'TOO_MANY_ATTEMPTS');
    err.retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    throw err;
  }
}

function fail(key, now = Date.now()) {
  const entry = live(key, now);
  if (entry) {
    entry.count += 1;
    return;
  }
  if (failures.size >= MAX_KEYS) failures.delete(failures.keys().next().value);
  failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
}

function reset(key) {
  failures.delete(key);
}

function _clear() {
  failures.clear();
}

module.exports = { check, fail, reset, _clear, MAX_FAILURES, WINDOW_MS };