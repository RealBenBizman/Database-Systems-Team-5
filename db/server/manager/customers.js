// GET /api/manager/customers?q=text -> find customers by name, email or 7-digit id (managers only, read only)
// Without q it lists the 50 newest. Never returns the password hash.
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const f = require('../../lib/fields');

const SQL = `
  SELECT TOP (50)
         c.Customer_id AS customerId, c.First_name AS firstName, c.Last_name AS lastName,
         c.Email AS email, c.Loyalty_points AS points, t.Tier_name AS tier,
         CONVERT(VARCHAR(10), c.Created_date, 23) AS createdDate
  FROM   CUSTOMER c
  LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id AND t.Marked_for_deletion = 0
  WHERE  c.Marked_for_deletion = 0
    AND  (@like IS NULL
          OR c.First_name LIKE @like OR c.Last_name LIKE @like OR c.Email LIKE @like
          OR CONCAT(c.First_name, N' ', c.Last_name) LIKE @like
          OR c.Customer_id = @id)
  ORDER BY c.Created_date DESC, c.Customer_id DESC`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const q = req.query && req.query.q;
    const result = await query(SQL, { like: f.likePattern(q), id: f.idFromSearch(q) });
    return { customers: result.recordset };
  },
});
