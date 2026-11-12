//GET /api/auth/me -> { user: { id, name, role } } for the signed-in person, 401 otherwise
//The account is looked up again, so a customer or employee who was marked
//for deletion after signing in is signed out on the next page load.
const { route, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth, clearAuthCookie } = require('../../lib/auth');

const LOOKUP = {
    customer: `SELECT Customer_id As id, First_name AS name, 'customer' AS role
               FROM CUSTOMER WHERE Customer_id = @id AND Marked_for_deletion = 0`,
    employee: `SELECT Employee_id As id, FirstName AS name, LOWER(Role) AS role
               FROM EMPLOYEE WHERE Employee_id = @id AND Marked_for_deletion = 0`,
};

module.exports = route({
    GET: async (req, res) => {
        const token = requireAuth(req);
        const r = await query(LOOKUP[token.role === 'customer' ? 'customer' : 'employee'], { id: token.id});
        const row = r.recordset[0];
        if(!row) {
            clearAuthCookie(res);
            throw new HttpError(401, 'Please sign in.', 'NOT_SIGNED_IN');
        }
        return { user: { id: row.id, name: row.name, role: row.role}};
    },
});