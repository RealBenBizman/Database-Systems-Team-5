const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { HttpError, sendError } = require('./http');

const COOKIE_NAME = 'pos_token';
const ROLES = ['customer', 'support', 'manager'];
const SESSION_SECONDS = 8 * 60 * 60;
const BCRYPT_ROUNDS = 10;

const DUMMY_HASH = '$2b$10$xhH5kKZdx7RJzwMlb1dfG.OmhOx39C0NaAoNGzLtD4LIMZpvLF95.';

function secret() {
    const s = process.env.JWT_SECRET;
    if(!s || s.length < 32){
        throw new Error('JWT_SECRET must be set to at least 32 characters');
    }
    return s;
}

function hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function checkPassword(plain, storedHash) {
    const ok = await bcrypt.compare(plain, storedHash || DUMMY_HASH);
    return Boolean(storedHash) && ok;
}

function signToken(user) {
    return jwt.sign({ role: user.role, name: user.name }, secret(), {
        subject: String(user.id),
        expiresIn: SESSION_SECONDS,
        algorithm: 'HS256',
    });
}

function parseCookies(req) {
    const out = {};
    const header = (req.headers && req.headers.cookie) || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const name = part.slice(0, i).trim();
        if (name) out[name] = decodeURIComponent(part.slice(i+1).trim());
    }
    return out;
}

function cookieFlags(maxAge) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  return flags.join('; ');
}

function setAuthCookie(res, user) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${signToken(user)}; ${cookieFlags(SESSION_SECONDS)}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieFlags(0)}`);
}

function getUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (!ROLES.includes(p.role)) return null;
    return { id: Number(p.sub), role: p.role, name: p.name };
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) return null;
    throw err;
  }
}

function checkAccess(req, roles) {
  const user = getUser(req);
  if (!user) throw new HttpError(401, 'Please sign in.', 'NOT_SIGNED_IN');
  if (roles && !roles.includes(user.role)) {
    throw new HttpError(403, 'You do not have access to this.', 'FORBIDDEN');
  }
  return user;
}

function requireAuth(first, second) {
  if (first === undefined || Array.isArray(first)) {
    const roles = first;
    return (handler) => async (req, res) => {
      try {
        req.user = checkAccess(req, roles);
        return await handler(req, res);
      } catch (err) {
        return sendError(res, err);
      }
    };
  }
  return checkAccess(first, second);
}

module.exports = {
  COOKIE_NAME, ROLES, DUMMY_HASH,
  hashPassword, checkPassword, signToken,
  parseCookies, setAuthCookie, clearAuthCookie,
  getUser, requireAuth,
};