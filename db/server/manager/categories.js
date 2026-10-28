// GET  /api/manager/categories                                      -> list (managers only)
// POST /api/manager/categories  body: { name, description }          -> create
// PUT  /api/manager/categories  body: { categoryId, name, description } -> edit
// Categories are never deleted (a flagged name would still be reserved); edit the name instead.
const { route, HttpError, readBody } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');

const LIST_SQL = `
  SELECT c.Category_id AS categoryId, c.Name AS name, c.Description AS description,
         (SELECT COUNT(*) FROM PRODUCT p
          WHERE p.Category_id = c.Category_id AND p.Marked_for_deletion = 0) AS productCount
  FROM   CATEGORY c
  WHERE  c.Marked_for_deletion = 0
  ORDER BY c.Name`;

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(LIST_SQL);
    return { categories: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const name = validate.text(body.name, 'Name', { max: 100 });
    const description = f.optionalText(body.description, 'Description', { max: 500 });
    // a duplicate name (even a hidden one) is rejected by the unique key and shown as "already in use"
    const made = await query(
      `INSERT INTO CATEGORY (Name, Description) VALUES (@name, @description);
       SELECT SCOPE_IDENTITY() AS categoryId;`,
      { name, description });
    return { status: 201, body: { categoryId: made.recordset[0].categoryId } };
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const categoryId = validate.integer(body.categoryId, 'Category');
    const name = validate.text(body.name, 'Name', { max: 100 });
    const description = f.optionalText(body.description, 'Description', { max: 500 });
    const changed = await query(
      `UPDATE CATEGORY SET Name = @name, Description = @description
       WHERE Category_id = @categoryId AND Marked_for_deletion = 0`,
      { categoryId, name, description });
    if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Category not found.');
    return { categoryId };
  },
});
