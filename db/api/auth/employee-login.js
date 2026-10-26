const { route } = require('../../lib/http');
const { signIn } = require('../../lib/login');

const SQL = `
  SELECT Employee_id AS id, FirstName AS name, Password_hash AS password_hash, Role AS role
  FROM   EMPLOYEE
  WHERE  Email = @email AND Marked_for_deletion = 0`;

module.exports = route({
  POST: (req, res) => signIn(req, res, { sql: SQL, toRole: (row) => row.role.toLowerCase() }),
});