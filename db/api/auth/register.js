const { route, readBody, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { hashPassword, setAuthCookie } = require('../../lib/auth');
const validate = require('../../lib/validate');

const DUPLICATE = [2627, 2601];

module.exports = route({
    POST: async (req, res) => {
        const body = readBody(req);
        const firstName = validate.text(body.firstName, 'First name', { max: 50 });
        const lastName = validate.text(body.lastName, 'Last name', { max: 50 })
        const email = validate.email(body.email);
        const password = validate.newPassword(body.password);

        const passwordHash = await hashPassword(password);

        let id;
        try {
            const r = await query(
                `INSERT INTO CUSTOMER (First_name, Last_name, Email, Password_hash)
                 OUTPUT INSERTED.Customer_id as id
                 VALUES (@firstName, @lastName, @email, @passwordHash)`,
               { firstName, lastName, email, passwordHash });
            id = r.recordset[0].id;
        }
        catch (err) {
            if (DUPLICATE.includes(err.number)) {
                throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_TAKEN');
            }
            throw err;
        }

        const user = { id, name: firstName, role: 'customer' };
        setAuthCookie(res, user);
        return { status: 201, body: { user } };
    },
});