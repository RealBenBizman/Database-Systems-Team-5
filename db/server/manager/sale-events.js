// Sale events (managers only): a named period that groups discounts, for example "Autumn Sale".
// GET    /api/manager/sale-events   -> list with the number of discounts in each
// POST   /api/manager/sale-events   body: { name, description, startDate, endDate }                  -> create
// PUT    /api/manager/sale-events   body: { saleEventId, name, description, startDate, endDate, isActive } -> edit
// DELETE /api/manager/sale-events?id=123  -> remove (flag); refused while visible discounts still belong to it
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

const LIST_SQL = `
  SELECT e.Sale_event_id AS saleEventId, e.Event_name AS name, e.Description AS description,
         CONVERT(VARCHAR(10), e.Start_date, 23) AS startDate, CONVERT(VARCHAR(10), e.End_date, 23) AS endDate,
         e.Is_active AS isActive,
         CASE WHEN e.Is_active = 0 THEN 'Paused'
              WHEN e.Start_date > CAST(SYSDATETIME() AS DATE) THEN 'Scheduled'
              WHEN e.End_date < CAST(SYSDATETIME() AS DATE) THEN 'Expired'
              ELSE 'Active' END AS status,
         (SELECT COUNT(*) FROM DISCOUNT d
          WHERE d.Sale_event_id = e.Sale_event_id AND d.Marked_for_deletion = 0) AS discountCount
  FROM   SALE_EVENT e
  WHERE  e.Marked_for_deletion = 0
  ORDER BY e.End_date DESC, e.Event_name`;

function fields(body) {
  const name = validate.text(body.name, 'Name', { max: 100 });
  const description = f.optionalText(body.description, 'Description', { max: 500 });
  const from = f.isoDate(body.startDate, 'Start date');
  const to = f.isoDate(body.endDate, 'End date');
  if (to < from) throw new HttpError(400, 'The end date cannot be before the start date.', 'VALIDATION');
  return { name, description, from, to };
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(LIST_SQL);
    return { saleEvents: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const v = fields(readBody(req));
    const made = await query(
      `INSERT INTO SALE_EVENT (Event_name, Description, Start_date, End_date)
       VALUES (@name, @description, CAST(@from AS DATE), CAST(@to AS DATE));
       SELECT SCOPE_IDENTITY() AS saleEventId;`,
      v);
    return { status: 201, body: { saleEventId: made.recordset[0].saleEventId } };
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const saleEventId = validate.integer(body.saleEventId, 'Sale event');
    const v = fields(body);
    const isActive = f.bool(body.isActive, 'Active');
    const changed = await query(
      `UPDATE SALE_EVENT
       SET    Event_name = @name, Description = @description, Start_date = CAST(@from AS DATE),
              End_date = CAST(@to AS DATE), Is_active = @isActive
       WHERE  Sale_event_id = @saleEventId AND Marked_for_deletion = 0`,
      { ...v, isActive, saleEventId });
    if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Sale event not found.', 'NOT_FOUND');
    return { saleEventId };
  },

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const saleEventId = validate.integer(req.query && req.query.id, 'Sale event');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Sale_event_id FROM SALE_EVENT WITH (UPDLOCK, HOLDLOCK) WHERE Sale_event_id = @saleEventId AND Marked_for_deletion = 0',
        { saleEventId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Sale event not found.', 'NOT_FOUND');
      const discounts = await tx.query(
        'SELECT Discount_name AS name FROM DISCOUNT WHERE Sale_event_id = @saleEventId AND Marked_for_deletion = 0',
        { saleEventId });
      if (discounts.recordset.length > 0) {
        const names = discounts.recordset.slice(0, 5).map((r) => r.name).join(', ');
        const more = discounts.recordset.length > 5 ? ` and ${discounts.recordset.length - 5} more` : '';
        throw new HttpError(409, `This sale event still has discounts: ${names}${more}. Remove them or move them to another event first.`, 'IN_USE');
      }
      await softDelete(tx, 'SALE_EVENT', 'Sale_event_id', saleEventId, 'Sale event');
      return { ok: true };
    });
  },
});
