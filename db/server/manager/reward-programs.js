// GET  /api/manager/reward-programs                                  -> list (managers only)
// POST /api/manager/reward-programs  body: { programName, pointsPerDollar, effectiveFrom, effectiveTo }
// PUT  /api/manager/reward-programs  body: { programId, programName, pointsPerDollar, effectiveFrom, effectiveTo }
// Two programs cannot overlap: the trigger TR_REWARD_PROGRAM_NoOverlap rejects it (error 50002, shown as 409).
// The loyalty trigger needs exactly one program on every sale date, so do not leave a gap between programs.
// To change the rate, end the old program and start a new one the next day.
const { route, HttpError, readBody } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');

const LIST_SQL = `
  SELECT p.Program_id AS programId, p.Program_name AS programName, p.Points_per_dollar AS pointsPerDollar,
         CONVERT(VARCHAR(10), p.Effective_from, 23) AS effectiveFrom,
         CONVERT(VARCHAR(10), p.Effective_to, 23) AS effectiveTo,
         (SELECT COUNT(*) FROM REWARD_TIER t
          WHERE t.Program_id = p.Program_id AND t.Marked_for_deletion = 0) AS tierCount
  FROM   REWARD_PROGRAM p
  WHERE  p.Marked_for_deletion = 0
  ORDER BY p.Effective_from DESC`;

function fields(body) {
  const programName = validate.text(body.programName, 'Program name', { max: 100 });
  const pointsPerDollar = f.decimal(body.pointsPerDollar, 'Points per dollar', { max: 9999.99, places: 2 });
  const from = f.isoDate(body.effectiveFrom, 'Start date');
  const to = f.optionalDate(body.effectiveTo, 'End date');
  if (to !== null && to < from) throw new HttpError(400, 'The end date cannot be before the start date.', 'VALIDATION');
  return { programName, pointsPerDollar, from, to };
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const result = await query(LIST_SQL);
    return { programs: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const { programName, pointsPerDollar, from, to } = fields(body);
    // Redemption_rate is not used (points are earn-only) but the column is NOT NULL
    const made = await query(
      `INSERT INTO REWARD_PROGRAM (Program_name, Points_per_dollar, Redemption_rate, Effective_from, Effective_to)
       VALUES (@programName, @pointsPerDollar, 0, CAST(@from AS DATE), CAST(@to AS DATE));
       SELECT SCOPE_IDENTITY() AS programId;`,
      { programName, pointsPerDollar, from, to });
    return { status: 201, body: { programId: made.recordset[0].programId } };
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const programId = validate.integer(body.programId, 'Program');
    const { programName, pointsPerDollar, from, to } = fields(body);
    const changed = await query(
      `UPDATE REWARD_PROGRAM
       SET    Program_name = @programName, Points_per_dollar = @pointsPerDollar,
              Effective_from = CAST(@from AS DATE), Effective_to = CAST(@to AS DATE)
       WHERE  Program_id = @programId AND Marked_for_deletion = 0`,
      { programId, programName, pointsPerDollar, from, to });
    if (changed.rowsAffected[0] === 0) throw new HttpError(404, 'Reward program not found.');
    return { programId };
  },
});
