// Employees (managers only): add staff, change a role, remove someone who left.
// GET    /api/manager/employees   -> { employees }  (never the password or its hash)
// POST   /api/manager/employees   body: { firstName, lastName, email, phone, role, hireDate, supervisorId, password }
//                                 -> create; the password is the temporary one the person signs in with (stored hashed)
// PUT    /api/manager/employees   body: { employeeId, role }  -> change a role
// DELETE /api/manager/employees?id=123 -> remove (the person can no longer sign in; flagged, not deleted)
// Rules: nobody changes or removes their own account, the last manager stays, and someone who is still
// another employee's supervisor cannot be removed. Orders, returns and adjustments they handled keep their name.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth, hashPassword } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

const ROLES = ['Manager', 'Support'];

const LIST_SQL = `
  SELECT e.Employee_id AS employeeId, e.FirstName AS firstName, e.LastName AS lastName, e.Email AS email,
         e.Phone_number AS phone, e.Role AS role, CONVERT(VARCHAR(10), e.Hire_date, 23) AS hireDate,
         e.Supervisor_id AS supervisorId, CONCAT(s.FirstName, N' ', s.LastName) AS supervisorName
  FROM   EMPLOYEE e
  LEFT JOIN EMPLOYEE s ON s.Employee_id = e.Supervisor_id AND s.Marked_for_deletion = 0
  WHERE  e.Marked_for_deletion = 0
  ORDER BY e.Role, e.LastName, e.FirstName`;

const employeeId = (value) => validate.integer(value, 'Employee', { min: 1000000, max: 9999999 });

// active managers other than this one (inside a transaction, so two managers cannot remove each other at once)
async function otherManagers(tx, id) {
  const r = await tx.query(
    `SELECT COUNT(*) AS n FROM EMPLOYEE WITH (UPDLOCK, HOLDLOCK)
     WHERE Role = 'Manager' AND Marked_for_deletion = 0 AND Employee_id <> @id`, { id });
  return r.recordset[0].n;
}

async function loadEmployee(tx, id) {
  const r = await tx.query(
    'SELECT Employee_id, Role FROM EMPLOYEE WITH (UPDLOCK, HOLDLOCK) WHERE Employee_id = @id AND Marked_for_deletion = 0', { id });
  if (r.recordset.length === 0) throw new HttpError(404, 'Employee not found.', 'NOT_FOUND');
  return r.recordset[0];
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(LIST_SQL);
    return { employees: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const firstName = validate.text(body.firstName, 'First name', { max: 50 });
    const lastName = validate.text(body.lastName, 'Last name', { max: 50 });
    const email = validate.email(body.email);
    const phone = f.digits(body.phone, 'Phone number', { min: 10 });
    const role = f.oneOf(body.role, 'Role', ROLES);
    const hireDate = body.hireDate === undefined || body.hireDate === '' || body.hireDate === null ? null : f.isoDate(body.hireDate, 'Hire date');
    const supervisorId = body.supervisorId === undefined || body.supervisorId === '' || body.supervisorId === null ? null : employeeId(body.supervisorId);
    const passwordHash = await hashPassword(validate.newPassword(body.password, 'Temporary password'));

    return withTransaction(async (tx) => {
      if (supervisorId !== null) {
        const boss = await tx.query('SELECT Employee_id FROM EMPLOYEE WHERE Employee_id = @supervisorId AND Marked_for_deletion = 0', { supervisorId });
        if (boss.recordset.length === 0) throw new HttpError(400, 'Choose an existing supervisor.', 'VALIDATION');
      }
      // the email is unique even for people who were removed, so a removed employee's address stays taken
      const taken = await tx.query('SELECT Employee_id FROM EMPLOYEE WHERE Email = @email', { email });
      if (taken.recordset.length > 0) throw new HttpError(409, 'That email is already used by an employee.', 'DUPLICATE');
      const made = await tx.query(
        `INSERT INTO EMPLOYEE (FirstName, LastName, Email, Phone_number, Role, Hire_date, Password_hash, Supervisor_id)
         VALUES (@firstName, @lastName, @email, @phone, @role, ISNULL(CAST(@hireDate AS DATE), CAST(SYSDATETIME() AS DATE)), @passwordHash, @supervisorId);
         SELECT SCOPE_IDENTITY() AS employeeId;`,
        { firstName, lastName, email, phone, role, hireDate, passwordHash, supervisorId });
      return { status: 201, body: { employeeId: made.recordset[0].employeeId } };
    });
  },

  PUT: async (req) => {
    const me = requireAuth(req, ['manager']);
    const body = readBody(req);
    const id = employeeId(body.employeeId);
    const role = f.oneOf(body.role, 'Role', ROLES);
    if (Number(me.id) === id) throw new HttpError(409, 'You cannot change your own role. Ask another manager.', 'SELF');
    return withTransaction(async (tx) => {
      const current = await loadEmployee(tx, id);
      if (current.Role === 'Manager' && role !== 'Manager' && (await otherManagers(tx, id)) === 0) {
        throw new HttpError(409, 'There must always be at least one manager.', 'LAST_MANAGER');
      }
      await tx.query('UPDATE EMPLOYEE SET Role = @role WHERE Employee_id = @id', { role, id });
      return { employeeId: id };
    });
  },

  DELETE: async (req) => {
    const me = requireAuth(req, ['manager']);
    const id = employeeId(req.query && req.query.id);
    if (Number(me.id) === id) throw new HttpError(409, 'You cannot remove your own account. Ask another manager.', 'SELF');
    return withTransaction(async (tx) => {
      const current = await loadEmployee(tx, id);
      if (current.Role === 'Manager' && (await otherManagers(tx, id)) === 0) {
        throw new HttpError(409, 'There must always be at least one manager.', 'LAST_MANAGER');
      }
      const team = await tx.query(
        `SELECT FirstName + N' ' + LastName AS name FROM EMPLOYEE
         WHERE Supervisor_id = @id AND Marked_for_deletion = 0 ORDER BY LastName, FirstName`, { id });
      if (team.recordset.length > 0) {
        const names = team.recordset.slice(0, 5).map((r) => r.name).join(', ');
        const more = team.recordset.length > 5 ? ` and ${team.recordset.length - 5} more` : '';
        throw new HttpError(409, `Give these people another supervisor first. This person supervises: ${names}${more}.`, 'IS_SUPERVISOR');
      }
      await softDelete(tx, 'EMPLOYEE', 'Employee_id', id, 'Employee');
      return { ok: true };
    });
  },
});
