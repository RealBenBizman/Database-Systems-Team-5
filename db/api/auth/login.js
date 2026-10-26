const { route } = require('../../lib/http');
const { signIn } = require('../../lib/login');

const SQL =
    `SELECT Customer_id AS id, First_name AS name, Password_hash AS password_hash
    FROM CUSTOMER
    WHERE Email = @email AND Marked_for_deletion = 0`;

module.exports = route({
    POST: (req, res) => signIn(req, res, { sql: SQL, toRole: () => 'customer' }),
});