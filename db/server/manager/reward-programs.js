// GET  /api/manager/reward-programs                                  -> list (managers only)
// POST /api/manager/reward-programs  body: { programName, pointsPerDollar, effectiveFrom, effectiveTo }
// PUT  /api/manager/reward-programs  body: { programId, programName, pointsPerDollar, effectiveFrom, effectiveTo }
// Two programs cannot overlap: the trigger TR_REWARD_PROGRAM_NoOverlap rejects it (error 50002, shown as 409).
// The loyalty trigger needs exactly one program on every sale date, so do not leave a gap between programs.
// To change the rate, end the old program and start a new one the next day.
// DELETE /api/manager/reward-programs?id=123  -> remove (flag), refused when the program has loyalty rows or is the one in force today
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

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

  // The loyalty trigger finds the program by the sale date, so a program that earned points stays as
  // history, and the program in force today cannot go (there would be no program for new orders).
  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const programId = validate.integer(req.query && req.query.id, 'Program');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        `SELECT CASE WHEN Effective_from <= CAST(SYSDATETIME() AS DATE)
                      AND ISNULL(Effective_to, CAST('9999-12-31' AS DATE)) >= CAST(SYSDATETIME() AS DATE)
                     THEN 1 ELSE 0 END AS coversToday
         FROM   REWARD_PROGRAM WITH (UPDLOCK, HOLDLOCK)
         WHERE  Program_id = @programId AND Marked_for_deletion = 0`,
        { programId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Reward program not found.', 'NOT_FOUND');

      // any loyalty row counts, flagged or not
      const used = await tx.query('SELECT TOP (1) Loyalty_txn_id FROM LOYALTY_TRANSACTION WHERE Program_id = @programId', { programId });
      if (used.recordset.length > 0) {
        throw new HttpError(409, 'Customers have earned points under this program, so it stays as history. End it with an end date instead.', 'HAS_HISTORY');
      }
      if (found.recordset[0].coversToday) {
        const other = await tx.query(
          `SELECT TOP (1) Program_id FROM REWARD_PROGRAM
           WHERE  Program_id <> @programId AND Marked_for_deletion = 0
             AND  Effective_from <= CAST(SYSDATETIME() AS DATE)
             AND  ISNULL(Effective_to, CAST('9999-12-31' AS DATE)) >= CAST(SYSDATETIME() AS DATE)`,
          { programId });
        if (other.recordset.length === 0) {
          throw new HttpError(409, 'This is the program in force today. Removing it would leave new orders without a reward program. Start another program first.', 'IN_USE');
        }
      }
      await softDelete(tx, 'REWARD_PROGRAM', 'Program_id', programId, 'Reward program');
      return { ok: true };
    });
  },
});
