// POST /api/auth/employee-login   body: { email, password }   -> staff sign-in
const { route } = require('../../lib/http');
const { signIn } = require('../../lib/login');

const SQL = `
  SELECT Employee_id AS id, FirstName AS name, Password_hash AS password_hash, Role AS role
  FROM   EMPLOYEE
  WHERE  Email = @email AND Marked_for_deletion = 0`;

// EMPLOYEE.Role is 'Manager' or 'Support'; the app uses lower case.
module.exports = route({
  POST: (req, res) => signIn(req, res, { sql: SQL, toRole: (row) => row.role.toLowerCase() }),
});