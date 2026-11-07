// The supplier directory (managers only). Supplier orders use /api/manager/suppliers (a short list).
// GET    /api/manager/supplier-directory               -> every supplier with its product and open-order counts
// POST   /api/manager/supplier-directory  body: { name, email, phone, street, apt, city, state, zip }  -> create
// PUT    /api/manager/supplier-directory  body: { supplierId, ...same fields }                         -> edit
// DELETE /api/manager/supplier-directory?id=123        -> remove (flag) a supplier with no open supplier order
// A removed supplier keeps its past orders, and its email stays reserved (the column is unique).
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

const LIST_SQL = `
  SELECT s.Supplier_id AS supplierId, s.Supplier_name AS name, s.Supplier_email AS email,
         s.Supplier_phone AS phone, s.Street_address AS street, s.Apt_number AS apt,
         s.City AS city, s.State AS state, s.Zip_code AS zip,
         (SELECT COUNT(*) FROM SUPPLIER_PRODUCT sp
          WHERE sp.Supplier_id = s.Supplier_id AND sp.Marked_for_deletion = 0) AS productCount,
         (SELECT COUNT(*) FROM SUPPLIER_ORDER o
          WHERE o.Supplier_id = s.Supplier_id AND o.Marked_for_deletion = 0
            AND o.Status IN ('Pending', 'Ordered')) AS openOrders
  FROM   SUPPLIER s
  WHERE  s.Marked_for_deletion = 0
  ORDER BY s.Supplier_name`;

function fields(body) {
  return {
    name: validate.text(body.name, 'Name', { max: 100 }),
    email: validate.email(body.email, 'Email'),
    phone: f.digits(body.phone, 'Phone', { min: 10 }),
    street: validate.text(body.street, 'Street', { max: 200 }),
    apt: f.optionalText(body.apt, 'Apt', { max: 10 }),
    city: validate.text(body.city, 'City', { max: 50 }),
    state: f.stateCode(body.state),
    zip: f.digits(body.zip, 'Zip code', { min: 5, max: 10 }),
  };
}

// the email column is unique even for removed suppliers, so say which case it is
async function assertEmailFree(tx, email, selfId) {
  const taken = await tx.query(
    'SELECT Marked_for_deletion AS removed FROM SUPPLIER WHERE Supplier_email = @email AND Supplier_id <> @selfId',
    { email, selfId });
  if (taken.recordset.length > 0) {
    throw new HttpError(409,
      taken.recordset[0].removed
        ? 'That email belongs to a removed supplier and cannot be used again.'
        : 'That email is already used by another supplier.',
      'DUPLICATE');
  }
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(LIST_SQL);
    return { suppliers: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const v = fields(readBody(req));
    return withTransaction(async (tx) => {
      await assertEmailFree(tx, v.email, 0);
      const made = await tx.query(
        `INSERT INTO SUPPLIER (Supplier_name, Supplier_email, Supplier_phone, Street_address, Apt_number, City, State, Zip_code)
         VALUES (@name, @email, @phone, @street, @apt, @city, @state, @zip);
         SELECT SCOPE_IDENTITY() AS supplierId;`,
        v);
      return { status: 201, body: { supplierId: made.recordset[0].supplierId } };
    });
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const supplierId = validate.integer(body.supplierId, 'Supplier');
    const v = fields(body);
    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Supplier_id FROM SUPPLIER WITH (UPDLOCK) WHERE Supplier_id = @supplierId AND Marked_for_deletion = 0',
        { supplierId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
      await assertEmailFree(tx, v.email, supplierId);
      await tx.query(
        `UPDATE SUPPLIER
         SET    Supplier_name = @name, Supplier_email = @email, Supplier_phone = @phone, Street_address = @street,
                Apt_number = @apt, City = @city, State = @state, Zip_code = @zip
         WHERE  Supplier_id = @supplierId`,
        { ...v, supplierId });
      return { supplierId };
    });
  },

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const supplierId = validate.integer(req.query && req.query.id, 'Supplier');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Supplier_id FROM SUPPLIER WITH (UPDLOCK, HOLDLOCK) WHERE Supplier_id = @supplierId AND Marked_for_deletion = 0',
        { supplierId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Supplier not found.', 'NOT_FOUND');
      const open = await tx.query(
        `SELECT TOP (1) Order_id FROM SUPPLIER_ORDER
         WHERE Supplier_id = @supplierId AND Status IN ('Pending', 'Ordered') AND Marked_for_deletion = 0`,
        { supplierId });
      if (open.recordset.length > 0) {
        throw new HttpError(409, 'This supplier has supplier orders that are still open. Cancel or receive them first.', 'ON_ORDER');
      }
      await softDelete(tx, 'SUPPLIER', 'Supplier_id', supplierId, 'Supplier');
      return { ok: true };
    });
  },
});
