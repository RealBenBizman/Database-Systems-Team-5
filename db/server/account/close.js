// POST /api/account/close  body: { password }  -> the signed-in customer closes their own account.
// The password is asked again so a stolen session cannot close it. Orders and returns are kept.
// Refused (409) while a return is still open. On success the login cookie is cleared.
const db = require('../../lib/db');
const { route, readBody, HttpError, clientIp } = require('../../lib/http');
const { checkPassword, clearAuthCookie } = require('../../lib/auth');
const throttle = require('../../lib/throttle');
const validate = require('../../lib/validate');
const { closeCustomer } = require('../../lib/closeAccount');
const { customer, keys } = require('../../lib/storefront');

module.exports = route({
  POST: async (req, res) => {
    const user = await customer(req);
    const body = readBody(req); keys(body, ['password']);
    const password = validate.passwordInput(body.password);

    const key = `close|${clientIp(req)}|${user.id}`;
    throttle.check(key);
    const found = await db.query('SELECT Password_hash AS hash FROM CUSTOMER WHERE Customer_id = @customerId AND Marked_for_deletion = 0', { customerId: user.id });
    const hash = found.recordset[0] && found.recordset[0].hash;
    if (!(await checkPassword(password, hash))) {
      throttle.fail(key);
      throw new HttpError(403, 'That password is not correct.', 'BAD_PASSWORD');
    }
    throttle.reset(key);

    await db.withTransaction((tx) => closeCustomer(tx, user.id, { self: true }));
    clearAuthCookie(res);
    return { ok: true };
  },
});
