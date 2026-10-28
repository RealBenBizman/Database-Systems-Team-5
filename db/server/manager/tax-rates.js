// GET  /api/manager/tax-rates                                   -> list (managers only)
// POST /api/manager/tax-rates  body: { categoryId, state, rate, effectiveFrom, effectiveTo }  -> create
// PUT  /api/manager/tax-rates  body: { taxRateId, rate, effectiveFrom, effectiveTo }          -> edit
// rate is a fraction (0.0825 = 8.25%). There is no trigger that stops two rates for the same
// category and state from overlapping, so this file checks it, inside the same transaction.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');

const LIST_SQL = `
  SELECT t.Tax_rate_id AS taxRateId, t.Category_id AS categoryId, c.Name AS category, t.State AS state,
         t.Rate AS rate,
         CONVERT(VARCHAR(10), t.Effective_from, 23) AS effectiveFrom,
         CONVERT(VARCHAR(10), t.Effective_to, 23) AS effectiveTo
  FROM   TAX_RATE t
  JOIN   CATEGORY c ON c.Category_id = t.Category_id AND c.Marked_for_deletion = 0
  WHERE  t.Marked_for_deletion = 0
  ORDER BY c.Name, t.State, t.Effective_from DESC`;

// another visible rate for the same category and state whose dates touch [from, to]
const OVERLAP_SQL = `
  SELECT Tax_rate_id FROM TAX_RATE WITH (UPDLOCK, HOLDLOCK)
  WHERE  Category_id = @categoryId AND State = @state AND Marked_for_deletion = 0
    AND  Tax_rate_id <> @selfId
    AND  Effective_from <= ISNULL(CAST(@to AS DATE), CAST('9999-12-31' AS DATE))
    AND  ISNULL(Effective_to, CAST('9999-12-31' AS DATE)) >= CAST(@from AS DATE)`;

function rateValue(value) {
  return f.decimal(value, 'Rate', { max: 1, places: 4 });
}

function dateRange(body) {
  const from = f.isoDate(body.effectiveFrom, 'Start date');
  const to = f.optionalDate(body.effectiveTo, 'End date');
  if (to !== null && to < from) throw new HttpError(400, 'The end date cannot be before the start date.', 'VALIDATION');
  return { from, to };
}

async function assertNoOverlap(tx, { categoryId, state, from, to, selfId }) {
  const clash = await tx.query(OVERLAP_SQL, { categoryId, state, from, to, selfId });
  if (clash.recordset.length > 0) {
    throw new HttpError(409, 'That category already has a tax rate for this state in those dates. End the old rate first.', 'RULE_VIOLATION');
  }
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(LIST_SQL);
    return { taxRates: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const categoryId = validate.integer(body.categoryId, 'Category');
    const state = f.stateCode(body.state);
    const rate = rateValue(body.rate);
    const { from, to } = dateRange(body);

    return withTransaction(async (tx) => {
      const cat = await tx.query(
        'SELECT Category_id FROM CATEGORY WHERE Category_id = @categoryId AND Marked_for_deletion = 0',
        { categoryId });
      if (cat.recordset.length === 0) throw new HttpError(400, 'Choose an existing category.', 'VALIDATION');
      await assertNoOverlap(tx, { categoryId, state, from, to, selfId: 0 });

      const made = await tx.query(
        `INSERT INTO TAX_RATE (Category_id, Rate, Effective_from, Effective_to, State)
         VALUES (@categoryId, @rate, CAST(@from AS DATE), CAST(@to AS DATE), @state);
         SELECT SCOPE_IDENTITY() AS taxRateId;`,
        { categoryId, rate, from, to, state });
      return { status: 201, body: { taxRateId: made.recordset[0].taxRateId } };
    });
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const taxRateId = validate.integer(body.taxRateId, 'Tax rate');
    const rate = rateValue(body.rate);
    const { from, to } = dateRange(body);

    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Category_id AS categoryId, State AS state FROM TAX_RATE WHERE Tax_rate_id = @taxRateId AND Marked_for_deletion = 0',
        { taxRateId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Tax rate not found.');
      const { categoryId, state } = found.recordset[0];
      await assertNoOverlap(tx, { categoryId, state, from, to, selfId: taxRateId });

      await tx.query(
        `UPDATE TAX_RATE SET Rate = @rate, Effective_from = CAST(@from AS DATE), Effective_to = CAST(@to AS DATE)
         WHERE Tax_rate_id = @taxRateId`,
        { taxRateId, rate, from, to });
      return { taxRateId };
    });
  },
});
