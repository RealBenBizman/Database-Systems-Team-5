// The tiers of a reward program (managers only).
// GET    /api/manager/reward-tiers?programId=123  -> tiers of that program, with how many customers hold each
// POST   /api/manager/reward-tiers  body: { programId, tierName, minPoints, perk }  -> create
// PUT    /api/manager/reward-tiers  body: { tierId, tierName, minPoints, perk }     -> edit
// DELETE /api/manager/reward-tiers?id=123  -> remove (flag) a tier that no customer holds
// The pair (program, minimum points) is unique even for removed tiers, so a removed tier keeps its
// minimum reserved. Customer tiers are set by the loyalty trigger from the points balance, never here.
const { route, HttpError, readBody } = require('../../lib/http');
const { query, withTransaction } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');
const f = require('../../lib/fields');
const { softDelete } = require('../../lib/softDelete');

const LIST_SQL = `
  SELECT t.Tier_id AS tierId, t.Program_id AS programId, t.Tier_name AS tierName, t.Min_points AS minPoints,
         t.Perk_description AS perk,
         (SELECT COUNT(*) FROM CUSTOMER c WHERE c.Tier_id = t.Tier_id AND c.Marked_for_deletion = 0) AS customers
  FROM   REWARD_TIER t
  WHERE  t.Program_id = @programId AND t.Marked_for_deletion = 0
  ORDER BY t.Min_points`;

function fields(body) {
  return {
    tierName: validate.text(body.tierName, 'Tier name', { max: 50 }),
    minPoints: validate.integer(body.minPoints, 'Minimum points', { min: 0, max: 100000000 }),
    perk: f.optionalText(body.perk, 'Perk', { max: 200 }),
  };
}

async function assertMinFree(tx, programId, minPoints, selfId) {
  const clash = await tx.query(
    'SELECT Marked_for_deletion AS removed FROM REWARD_TIER WHERE Program_id = @programId AND Min_points = @minPoints AND Tier_id <> @selfId',
    { programId, minPoints, selfId });
  if (clash.recordset.length > 0) {
    throw new HttpError(409,
      clash.recordset[0].removed
        ? 'A removed tier of this program used that minimum, and it cannot be used again. Choose another number of points.'
        : 'Another tier of this program already starts at that many points.',
      'DUPLICATE');
  }
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const programId = validate.integer(req.query && req.query.programId, 'Program');
    const result = await query(LIST_SQL, { programId });
    return { tiers: result.recordset };
  },

  POST: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const programId = validate.integer(body.programId, 'Program');
    const v = fields(body);
    return withTransaction(async (tx) => {
      const program = await tx.query(
        'SELECT Program_id FROM REWARD_PROGRAM WHERE Program_id = @programId AND Marked_for_deletion = 0',
        { programId });
      if (program.recordset.length === 0) throw new HttpError(404, 'Reward program not found.', 'NOT_FOUND');
      await assertMinFree(tx, programId, v.minPoints, 0);
      const made = await tx.query(
        `INSERT INTO REWARD_TIER (Program_id, Tier_name, Min_points, Perk_description)
         VALUES (@programId, @tierName, @minPoints, @perk);
         SELECT SCOPE_IDENTITY() AS tierId;`,
        { ...v, programId });
      return { status: 201, body: { tierId: made.recordset[0].tierId } };
    });
  },

  PUT: async (req) => {
    requireAuth(req, ['manager']);
    const body = readBody(req);
    const tierId = validate.integer(body.tierId, 'Tier');
    const v = fields(body);
    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Program_id AS programId FROM REWARD_TIER WITH (UPDLOCK) WHERE Tier_id = @tierId AND Marked_for_deletion = 0',
        { tierId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Tier not found.', 'NOT_FOUND');
      await assertMinFree(tx, found.recordset[0].programId, v.minPoints, tierId);
      await tx.query(
        'UPDATE REWARD_TIER SET Tier_name = @tierName, Min_points = @minPoints, Perk_description = @perk WHERE Tier_id = @tierId',
        { ...v, tierId });
      return { tierId };
    });
  },

  DELETE: async (req) => {
    requireAuth(req, ['manager']);
    const tierId = validate.integer(req.query && req.query.id, 'Tier');
    return withTransaction(async (tx) => {
      const found = await tx.query(
        'SELECT Tier_id FROM REWARD_TIER WITH (UPDLOCK, HOLDLOCK) WHERE Tier_id = @tierId AND Marked_for_deletion = 0',
        { tierId });
      if (found.recordset.length === 0) throw new HttpError(404, 'Tier not found.', 'NOT_FOUND');
      const holders = await tx.query(
        'SELECT COUNT(*) AS n FROM CUSTOMER WHERE Tier_id = @tierId AND Marked_for_deletion = 0',
        { tierId });
      const n = holders.recordset[0].n;
      if (n > 0) {
        throw new HttpError(409, `${n} customer${n === 1 ? ' holds' : 's hold'} this tier right now, so it cannot be removed.`, 'IN_USE');
      }
      await softDelete(tx, 'REWARD_TIER', 'Tier_id', tierId, 'Tier');
      return { ok: true };
    });
  },
});
