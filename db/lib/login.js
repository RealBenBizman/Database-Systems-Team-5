/*
    lib/logins.js - the sign-in steps shared by the customer and employee endpoints

    the endpoints says which table to look in; everything else (validation, throttling, password check, cookie) is the same.
*/

const { query } = require('./db');
const { HttpError, readBody, clientIp } = require('./http');
const { checkPassword, setAuthCookie } = require('./auth');
const throttle = require('./throttle');
const validate = require('./validate');

const BAD_LOGIN = 'Incorrect email or password.';

/*
    source = {
        sql:    'SELECT ... WHERE Email = @email ANd Marked_for_deletion = 0'
                must return the columns id, name, role, password_hash
        toRole: (row) => 'customer' | 'support' | 'manager'
    }
*/
async function signIn(req, res, source){
    const body = readBody(req);
    const email = validate.email(body.email);
    const password = validate.passwordInput(body.password);

    const key = `${clientIp(req)}|${email}`;
    throttle.check(key);

    const result = await query(source.sql, { email });
    const row = result.recordset[0];

    if (!(await checkPassword(password, row && row.password_hash))) {
        throttle.fail(key);
        throw new HttpError(401, BAD_LOGIN, 'BAD_LOGIN');
    }

    throttle.reset(key);
    const user = { id: row.id, name: row.name, role: source.toRole(row) };
    setAuthCookie(res, user);
    return { user };
}

module.exports = { signIn, BAD_LOGIN };