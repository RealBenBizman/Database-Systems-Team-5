// GET  /api/manager/categories                                      -> list (managers only)
// POST /api/manager/categories  body: { name, description }          -> create
// PUT  /api/manager/categories  body: { categoryId, name, description } -> edit
// DELETE /api/manager/categories?id=123                              -> remove (flag) a category with no products
// A removed category's name stays reserved (the name column is unique), so edit the name when you can.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

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

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const categoryId = validate.integer(req.query && req.query.id, 'Category');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Category_id FROM CATEGORY WITH (UPDLOCK, HOLDLOCK) WHERE Category_id = @categoryId AND Marked_for_deletion = 0',
        { categoryId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Category not found.', 'NOT_FOUND');
      const products = await tx.query(
        'SELECT COUNT(*) AS n FROM PRODUCT WHERE Category_id = @categoryId AND Marked_for_deletion = 0',
        { categoryId });
      const n = products.recordset[0].n;
      if (n > 0) {
        throw new HttpError(409,
          `This category still has ${n} product${n === 1 ? '' : 's'}. Move them to another category or remove them first.`,
          'IN_USE');
      }
      await softDelete(tx, 'CATEGORY', 'Category_id', categoryId, 'Category');
      return { ok: true };
    });
  },
});
