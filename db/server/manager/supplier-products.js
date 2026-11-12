// The products a supplier sells (SUPPLIER_PRODUCT), managers only.
// GET    /api/manager/supplier-products?supplierId=123  -> { links, products }  (products = what can still be linked)
// POST   /api/manager/supplier-products  body: { supplierId, productId, supplierSku, unitCost, leadTimeDays }
// PUT    /api/manager/supplier-products  body: { supplierId, productId, supplierSku, unitCost, leadTimeDays }
// DELETE /api/manager/supplier-products?supplierId=123&productId=456  -> remove (flag) the link
// The key has two columns, so the flag is written here by hand (not with lib/softDelete.js), and adding a
// link that was removed before turns the old row back on instead of inserting (the primary key would refuse).
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');

const LINKS_SQL = `
  SELECT sp.Product_id AS productId, p.SKU AS sku, p.Name AS name, sp.Supplier_sku AS supplierSku,
         sp.Unit_cost AS unitCost, sp.Lead_time_days AS leadTimeDays
  FROM   SUPPLIER_PRODUCT sp
  JOIN   PRODUCT p ON p.Product_id = sp.Product_id AND p.Marked_for_deletion = 0
  WHERE  sp.Supplier_id = @supplierId AND sp.Marked_for_deletion = 0
  ORDER BY p.Name`;

const FREE_PRODUCTS_SQL = `
  SELECT p.Product_id AS productId, p.SKU AS sku, p.Name AS name, p.Cost_price AS costPrice
  FROM   PRODUCT p
  WHERE  p.Marked_for_deletion = 0
    AND  NOT EXISTS (SELECT 1 FROM SUPPLIER_PRODUCT sp
                     WHERE sp.Supplier_id = @supplierId AND sp.Product_id = p.Product_id AND sp.Marked_for_deletion = 0)
  ORDER BY p.Name`;

function linkFields(body) {
  return {
    supplierSku: validate.text(body.supplierSku, 'Supplier SKU', { max: 50 }),
    unitCost: f.money(body.unitCost, 'Unit cost'),
    leadTimeDays: validate.integer(body.leadTimeDays, 'Lead time (days)', { min: 0, max: 365 }),
  };
}

async function requireSupplier(tx, supplierId) {
  const found = await tx.query(
    'SELECT Supplier_id FROM SUPPLIER WHERE Supplier_id = @supplierId AND Marked_for_deletion = 0',
    { supplierId });
  if (found.recordset.length === 0) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const supplierId = validate.integer(req.query && req.query.supplierId, 'Supplier');
    const links = await query(LINKS_SQL, { supplierId });
    const products = await query(FREE_PRODUCTS_SQL, { supplierId });
    return { links: links.recordset, products: products.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const supplierId = validate.integer(body.supplierId, 'Supplier');
    const productId = validate.integer(body.productId, 'Product');
    const v = linkFields(body);
    return withTransaction(async (tx) => {
      await requireSupplier(tx, supplierId);
      const product = await tx.query(
        'SELECT Product_id FROM PRODUCT WHERE Product_id = @productId AND Marked_for_deletion = 0',
        { productId });
      if (product.recordset.length === 0) throw new HttpError(400, 'Choose an existing product.', 'VALIDATION');

      const old = await tx.query(
        'SELECT Marked_for_deletion AS removed FROM SUPPLIER_PRODUCT WITH (UPDLOCK, HOLDLOCK) WHERE Supplier_id = @supplierId AND Product_id = @productId',
        { supplierId, productId });
      if (old.recordset.length > 0 && !old.recordset[0].removed) {
        throw new HttpError(409, 'That product is already linked to this supplier. Edit the link instead.', 'DUPLICATE');
      }
      if (old.recordset.length > 0) {
        // the link was removed before: turn the old row back on with the new values
        await tx.query(
          `UPDATE SUPPLIER_PRODUCT
           SET    Supplier_sku = @supplierSku, Unit_cost = @unitCost, Lead_time_days = @leadTimeDays, Marked_for_deletion = 0
           WHERE  Supplier_id = @supplierId AND Product_id = @productId`,
          { ...v, supplierId, productId });
      } else {
        await tx.query(
          `INSERT INTO SUPPLIER_PRODUCT (Supplier_id, Product_id, Supplier_sku, Unit_cost, Lead_time_days)
           VALUES (@supplierId, @productId, @supplierSku, @unitCost, @leadTimeDays)`,
          { ...v, supplierId, productId });
      }
      return { status: 201, body: { supplierId, productId } };
    });
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const supplierId = validate.integer(body.supplierId, 'Supplier');
    const productId = validate.integer(body.productId, 'Product');
    const v = linkFields(body);
    const changed = await query(
      `UPDATE SUPPLIER_PRODUCT
       SET    Supplier_sku = @supplierSku, Unit_cost = @unitCost, Lead_time_days = @leadTimeDays
       WHERE  Supplier_id = @supplierId AND Product_id = @productId AND Marked_for_deletion = 0`,
      { ...v, supplierId, productId });
    if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Link not found.', 'NOT_FOUND');
    return { supplierId, productId };
  },

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const supplierId = validate.integer(req.query && req.query.supplierId, 'Supplier');
    const productId = validate.integer(req.query && req.query.productId, 'Product');
    const changed = await query(
      `UPDATE SUPPLIER_PRODUCT SET Marked_for_deletion = 1
       WHERE  Supplier_id = @supplierId AND Product_id = @productId AND Marked_for_deletion = 0`,
      { supplierId, productId });
    if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Link not found.', 'NOT_FOUND');
    return { ok: true };
  },
});
