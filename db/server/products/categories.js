const { query } = require('../../lib/db');
const { route } = require('../../lib/http');

module.exports = route({
  GET: async () => {
    const result = await query(`SELECT c.Category_id AS id, c.Name AS name, COUNT(p.Product_id) AS productCount
      FROM CATEGORY c LEFT JOIN PRODUCT p ON p.Category_id = c.Category_id AND p.Is_active = 1 AND p.Marked_for_deletion = 0
      WHERE c.Marked_for_deletion = 0 GROUP BY c.Category_id, c.Name ORDER BY c.Name`);
    return { categories: result.recordset };
  },
});
