// Discounts (managers only). The tier rewards that the database gives to customers are not listed here.
// GET    /api/manager/discounts   -> { discounts, links }  (links = the products and categories that use each discount)
// POST   /api/manager/discounts   body: { name, type, amount, amountType, startDate, endDate, saleEventId,
//                                         targetKind: 'none' | 'product' | 'category', targetId }          -> create
// PUT    /api/manager/discounts   body: { discountId, name, type, amount, amountType, startDate, endDate,
//                                         saleEventId, isActive }                                          -> edit, pause, resume
// PATCH  /api/manager/discounts   body: { discountId, action: 'link' | 'unlink', targetKind, targetId }    -> attach to / detach from a product or category
// DELETE /api/manager/discounts?id=123   -> remove (flag); refused while a visible product or category still uses it
// A fixed amount is taken once per line, not once per unit (discount-rule.md). Past sales keep their Discount_id.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

const TYPES = ['product sale', 'category sale', 'fixed amount'];
const AMOUNT_TYPES = ['percent', 'fixed'];
const TARGETS = { product: { table: 'PRODUCT', id: 'Product_id' }, category: { table: 'CATEGORY', id: 'Category_id' } };

const LIST_SQL = `
  SELECT d.Discount_id AS discountId, d.Discount_name AS name, d.Discount_type AS type,
         d.Amount AS amount, d.Amount_type AS amountType,
         CONVERT(VARCHAR(10), d.Start_date, 23) AS startDate, CONVERT(VARCHAR(10), d.End_date, 23) AS endDate,
         d.Sale_event_id AS saleEventId, e.Event_name AS saleEvent, d.Is_active AS isActive,
         CASE WHEN d.Is_active = 0 THEN 'Paused'
              WHEN d.Start_date > CAST(SYSDATETIME() AS DATE) THEN 'Scheduled'
              WHEN d.End_date < CAST(SYSDATETIME() AS DATE) THEN 'Expired'
              ELSE 'Active' END AS status
  FROM   DISCOUNT d
  LEFT JOIN SALE_EVENT e ON e.Sale_event_id = d.Sale_event_id AND e.Marked_for_deletion = 0
  WHERE  d.Marked_for_deletion = 0 AND d.Discount_type <> 'tier reward'
  ORDER BY d.End_date DESC, d.Discount_name`;

// the products and categories that use a discount; cmp is 'IS NOT NULL' (all) or '= @discountId' (one discount)
const linksSql = (cmp) => `
  SELECT p.Discount_id AS discountId, 'product' AS kind, p.Product_id AS targetId, p.Name AS name
  FROM   PRODUCT p WHERE p.Discount_id ${cmp} AND p.Marked_for_deletion = 0
  UNION ALL
  SELECT c.Discount_id, 'category', c.Category_id, c.Name
  FROM   CATEGORY c WHERE c.Discount_id ${cmp} AND c.Marked_for_deletion = 0`;

function fields(body) {
  const name = validate.text(body.name, 'Name', { max: 100 });
  const type = f.oneOf(body.type, 'Type', TYPES);
  const amountType = f.oneOf(body.amountType, 'Amount type', AMOUNT_TYPES);
  const amount = amountType === 'percent' ? f.decimal(body.amount, 'Percent', { max: 100, places: 2 }) : f.money(body.amount, 'Amount');
  if (amount <= 0) throw new HttpError(400, 'The amount must be more than 0.', 'VALIDATION');
  const from = f.isoDate(body.startDate, 'Start date');
  const to = f.isoDate(body.endDate, 'End date');
  if (to < from) throw new HttpError(400, 'The end date cannot be before the start date.', 'VALIDATION');
  const saleEventId = body.saleEventId === undefined || body.saleEventId === null || body.saleEventId === ''
    ? null : validate.integer(body.saleEventId, 'Sale event');
  return { name, type, amountType, amount, from, to, saleEventId };
}

async function requireSaleEvent(tx, saleEventId) {
  if (saleEventId === null) return;
  const found = await tx.query(
    'SELECT Sale_event_id FROM SALE_EVENT WHERE Sale_event_id = @saleEventId AND Marked_for_deletion = 0', { saleEventId });
  if (found.recordset.length === 0) throw new HttpError(400, 'Choose an existing sale event.', 'VALIDATION');
}

// kind is 'product' or 'category'; the table and column names come from the TARGETS list, never from the request
function targetOf(kind) {
  if (!Object.prototype.hasOwnProperty.call(TARGETS, kind)) throw new HttpError(400, 'Choose a product or a category.', 'VALIDATION');
  return TARGETS[kind];
}

async function link(tx, discountId, kind, targetId) {
  const t = targetOf(kind);
  const found = await tx.query(
    `SELECT Name AS name, Discount_id AS discountId FROM ${t.table} WITH (UPDLOCK) WHERE ${t.id} = @targetId AND Marked_for_deletion = 0`,
    { targetId });
  if (found.recordset.length === 0) throw new HttpError(400, `Choose an existing ${kind}.`, 'VALIDATION');
  const current = found.recordset[0];
  if (current.discountId && current.discountId !== discountId) {
    throw new HttpError(409, `"${current.name}" already uses another discount. Unlink that one first.`, 'RULE_VIOLATION');
  }
  if (!current.discountId) {
    await tx.query(`UPDATE ${t.table} SET Discount_id = @discountId WHERE ${t.id} = @targetId`, { discountId, targetId });
  }
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const list = await query(LIST_SQL);
    const links = await query(linksSql('IS NOT NULL'));
    return { discounts: list.recordset, links: links.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const v = fields(body);
    const kind = body.targetKind === undefined || body.targetKind === 'none' ? 'none' : body.targetKind;
    const targetId = kind === 'none' ? null : validate.integer(body.targetId, kind === 'product' ? 'Product' : 'Category');
    if (kind !== 'none') targetOf(kind);

    return withTransaction(async (tx) => {
      await requireSaleEvent(tx, v.saleEventId);
      const made = await tx.query(
        `INSERT INTO DISCOUNT (Discount_name, Discount_type, Amount, Amount_type, Start_date, End_date, Sale_event_id)
         VALUES (@name, @type, @amount, @amountType, CAST(@from AS DATE), CAST(@to AS DATE), @saleEventId);
         SELECT SCOPE_IDENTITY() AS discountId;`,
        v);
      const discountId = made.recordset[0].discountId;
      if (kind !== 'none') await link(tx, discountId, kind, targetId);
      return { status: 201, body: { discountId } };
    });
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const discountId = validate.integer(body.discountId, 'Discount');
    const v = fields(body);
    const isActive = f.bool(body.isActive, 'Active');
    return withTransaction(async (tx) => {
      await requireSaleEvent(tx, v.saleEventId);
      const changed = await tx.query(
        `UPDATE DISCOUNT
         SET    Discount_name = @name, Discount_type = @type, Amount = @amount, Amount_type = @amountType,
                Start_date = CAST(@from AS DATE), End_date = CAST(@to AS DATE), Sale_event_id = @saleEventId, Is_active = @isActive
         WHERE  Discount_id = @discountId AND Marked_for_deletion = 0 AND Discount_type <> 'tier reward'`,
        { ...v, isActive, discountId });
      if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Discount not found.', 'NOT_FOUND');
      return { discountId };
    });
  },

  PATCH: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const discountId = validate.integer(body.discountId, 'Discount');
    const action = f.oneOf(body.action, 'Action', ['link', 'unlink']);
    const kind = body.targetKind;
    const t = targetOf(kind);
    const targetId = validate.integer(body.targetId, kind === 'product' ? 'Product' : 'Category');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        `SELECT Discount_id FROM DISCOUNT WITH (UPDLOCK) WHERE Discount_id = @discountId AND Marked_for_deletion = 0 AND Discount_type <> 'tier reward'`,
        { discountId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Discount not found.', 'NOT_FOUND');
      if (action === 'link') {
        await link(tx, discountId, kind, targetId);
      } else {
        const changed = await tx.query(
          `UPDATE ${t.table} SET Discount_id = NULL WHERE ${t.id} = @targetId AND Discount_id = @discountId`,
          { targetId, discountId });
        if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'That discount is not linked to it.', 'NOT_FOUND');
      }
      return { ok: true };
    });
  },

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const discountId = validate.integer(req.query && req.query.id, 'Discount');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        `SELECT Discount_id FROM DISCOUNT WITH (UPDLOCK, HOLDLOCK)
         WHERE Discount_id = @discountId AND Marked_for_deletion = 0 AND Discount_type <> 'tier reward'`,
        { discountId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Discount not found.', 'NOT_FOUND');
      const used = await tx.query(linksSql('= @discountId'), { discountId });
      if (used.recordset.length > 0) {
        const names = used.recordset.slice(0, 5).map((r) => r.name).join(', ');
        const more = used.recordset.length > 5 ? ` and ${used.recordset.length - 5} more` : '';
        throw new HttpError(409, `Unlink it first. It is still used by: ${names}${more}.`, 'IN_USE');
      }
      await softDelete(tx, 'DISCOUNT', 'Discount_id', discountId, 'Discount');
      return { ok: true };
    });
  },
});
