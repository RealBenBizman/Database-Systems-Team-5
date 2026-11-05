//POST api/auth/login body: { email, password } -> one sign-in for customers and staff.
//The email is looked up in CUSTOMER and in EMPLOYEE; the role comes from the account that matches.
const { route } = require('../../lib/http');
const { signIn } = require('../../lib/login');

const SQL =
    `SELECT Customer_id AS id, First_name AS name, Password_hash AS password_hash, 'customer' AS role, 0 AS sort_order
    FROM CUSTOMER
    WHERE Email = @email AND Marked_for_deletion = 0
    UNION ALL
    SELECT Employee_id, FirstName, Password_hash, Role, 1
    FROM EMPLOYEE
    WHERE Email = @email AND Marked_for_deletion = 0
    ORDER BY sort_order`;

// EMPLOYEE.Role is 'Manager' or 'Support'; the app uses lower case.
module.exports = route({
    POST: (req, res) => signIn(req, res, { sql: SQL, toRole: (row) => String(row.role || 'customer').toLowerCase() }),
});
