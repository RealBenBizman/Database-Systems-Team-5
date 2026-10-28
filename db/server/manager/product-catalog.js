// GET  /api/manager/product-catalog?q=text  -> every product (also paused ones), managers only
// POST /api/manager/product-catalog  body: { sku, name, description, categoryId, productCondition,
//                                            costPrice, sellPrice, stock, threshold }   -> create
// PUT  /api/manager/product-catalog  body: { productId, name, description, categoryId, productCondition,
//                                            costPrice, threshold, isActive }            -> edit
// Price changes go through /api/manager/prices (it writes the PRICE_CHANGE row) and stock changes
// through /api/manager/adjustments (the trigger applies them), so neither is editable here.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');

const CONDITIONS = ['New', 'Used', 'Refurbished'];

const LIST_SQL = `
  SELECT TOP (300)
         p.Product_id AS productId, p.SKU AS sku, p.Name AS name, p.Description AS description,
         p.Cost_price AS costPrice, p.Sell_price AS sellPrice, p.Stock_quantity AS stock,
         p.Reorder_threshold AS threshold, p.Product_condition AS productCondition,
         p.Is_active AS isActive, c.Category_id AS categoryId, c.Name AS category
  FROM   PRODUCT p
  JOIN   CATEGORY c ON c.Category_id = p.Category_id AND c.Marked_for_deletion = 0
  WHERE  p.Marked_for_deletion = 0
    AND  (@like IS NULL OR p.Name LIKE @like OR p.SKU LIKE @like)
  ORDER BY p.Name`;

async function requireCategory(tx, categoryId) {
  const found = await tx.query(
    'SELECT Category_id FROM CATEGORY WHERE Category_id = @categoryId AND Marked_for_deletion = 0',
    { categoryId });
  if (found.recordset.length === 0) throw new HttpError(400, 'Choose an existing category.', 'VALIDATION');
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const like = f.likePattern(req.query && req.query.q);
    const result = await query(LIST_SQL, { like });
    return { products: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const sku = validate.text(body.sku, 'SKU', { max: 50 });
    const name = validate.text(body.name, 'Name', { max: 150 });
    const description = f.optionalText(body.description, 'Description', { max: 2000 });
    const categoryId = validate.integer(body.categoryId, 'Category');
    const productCondition = f.oneOf(body.productCondition, 'Condition', CONDITIONS);
    const costPrice = f.money(body.costPrice, 'Cost price');
    const sellPrice = f.money(body.sellPrice, 'Sell price');
    const stock = validate.integer(body.stock === undefined || body.stock === '' ? 0 : body.stock, 'Starting stock', { min: 0, max: 1000000 });
    const threshold = validate.integer(body.threshold, 'Reorder threshold', { min: 0, max: 1000000 });

    return withTransaction(async (tx) => {
      await requireCategory(tx, categoryId);
      // a hidden (flagged) product still reserves its SKU, so do not filter Marked_for_deletion here
      const taken = await tx.query('SELECT Product_id FROM PRODUCT WHERE SKU = @sku', { sku });
      if (taken.recordset.length > 0) throw new HttpError(409, 'That SKU is already in use.', 'DUPLICATE');

      const made = await tx.query(
        `INSERT INTO PRODUCT (SKU, Name, Description, Cost_price, Sell_price, Stock_quantity,
                              Reorder_threshold, Product_condition, Category_id)
         VALUES (@sku, @name, @description, @costPrice, @sellPrice, @stock,
                 @threshold, @productCondition, @categoryId);
         SELECT SCOPE_IDENTITY() AS productId;`,
        { sku, name, description, costPrice, sellPrice, stock, threshold, productCondition, categoryId });
      return { status: 201, body: { productId: made.recordset[0].productId } };
    });
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const productId = validate.integer(body.productId, 'Product');
    const name = validate.text(body.name, 'Name', { max: 150 });
    const description = f.optionalText(body.description, 'Description', { max: 2000 });
    const categoryId = validate.integer(body.categoryId, 'Category');
    const productCondition = f.oneOf(body.productCondition, 'Condition', CONDITIONS);
    const costPrice = f.money(body.costPrice, 'Cost price');
    const threshold = validate.integer(body.threshold, 'Reorder threshold', { min: 0, max: 1000000 });
    const isActive = f.bool(body.isActive, 'Active');

    return withTransaction(async (tx) => {
      await requireCategory(tx, categoryId);
      const changed = await tx.query(
        `UPDATE PRODUCT
         SET    Name = @name, Description = @description, Category_id = @categoryId,
                Product_condition = @productCondition, Cost_price = @costPrice,
                Reorder_threshold = @threshold, Is_active = @isActive
         WHERE  Product_id = @productId AND Marked_for_deletion = 0`,
        { productId, name, description, categoryId, productCondition, costPrice, threshold, isActive });
      if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Product not found.');
      return { productId };
    });
  },
});
