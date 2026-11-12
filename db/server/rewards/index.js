// GET /api/rewards -> the signed-in customer's loyalty points, tier, next tier and history (customers only).
// { points, tier: { name, minPoints, perk } | null,
//   nextTier: { name, minPoints, perk, pointsToGo } | null,          (null = top tier, or no tiers set up)
//   program: { name, pointsPerDollar } | null,                       (the reward program active today)
//   tiers: [{ name, minPoints, perk, reached }],                     (every tier of that program, lowest first)
//   history: [{ id, date, points, reason, orderId, balanceAfter }] } (newest first, at most 100 rows)
// Points are earned and taken back by database triggers (sales and refunds). This endpoint only reads them.
const db = require('../../lib/db');
const { HttpError, route } = require('../../lib/http');
const { customer } = require('../../lib/storefront');

module.exports = route({
  GET: async (req) => {
    const user = await customer(req);
    const params = { customerId: user.id };

    const [me, active, history] = await Promise.all([
      db.query(`SELECT c.Loyalty_points AS points, t.Tier_id AS tierId, t.Tier_name AS tierName,
          t.Min_points AS tierMin, t.Perk_description AS tierPerk, t.Program_id AS tierProgramId
        FROM CUSTOMER c
        LEFT JOIN REWARD_TIER t ON t.Tier_id = c.Tier_id AND t.Marked_for_deletion = 0
        WHERE c.Customer_id = @customerId AND c.Marked_for_deletion = 0`, params),
      db.query(`SELECT TOP (1) Program_id AS id, Program_name AS name, Points_per_dollar AS pointsPerDollar
        FROM REWARD_PROGRAM
        WHERE Marked_for_deletion = 0 AND CAST(SYSDATETIME() AS DATE) >= Effective_from
          AND (Effective_to IS NULL OR CAST(SYSDATETIME() AS DATE) <= Effective_to)
        ORDER BY Effective_from DESC, Program_id DESC`),
      db.query(`SELECT TOP (100) h.id, h.date, h.points, h.reason, h.orderId, h.balanceAfter
        FROM (SELECT lt.Loyalty_txn_id AS id, lt.Created_at AS date, lt.Points_change AS points, lt.Reason AS reason,
                     lt.Transaction_id AS orderId,
                     SUM(lt.Points_change) OVER (ORDER BY lt.Created_at, lt.Loyalty_txn_id ROWS UNBOUNDED PRECEDING) AS balanceAfter
              FROM LOYALTY_TRANSACTION lt
              WHERE lt.Customer_id = @customerId AND lt.Marked_for_deletion = 0) h
        ORDER BY h.date DESC, h.id DESC`, params),
    ]);

    const row = me.recordset[0];
    if (!row) throw new HttpError(401, 'Please sign in again.');
    const program = active.recordset[0] || null;

    // the tiers of the program the customer's tier belongs to, else of today's program
    const programId = row.tierProgramId || (program && program.id) || null;
    let tiers = [];
    if (programId) {
      const result = await db.query(`SELECT Tier_name AS name, Min_points AS minPoints, Perk_description AS perk
        FROM REWARD_TIER WHERE Program_id = @programId AND Marked_for_deletion = 0
        ORDER BY Min_points, Tier_id`, { programId });
      tiers = result.recordset.map((t) => ({ ...t, reached: Number(row.points) >= Number(t.minPoints) }));
    }

    const points = Number(row.points);
    const next = tiers.find((t) => Number(t.minPoints) > points) || null;
    return {
      points,
      tier: row.tierId ? { name: row.tierName, minPoints: row.tierMin, perk: row.tierPerk } : null,
      nextTier: next ? { name: next.name, minPoints: next.minPoints, perk: next.perk, pointsToGo: Number(next.minPoints) - points } : null,
      program: program ? { name: program.name, pointsPerDollar: program.pointsPerDollar } : null,
      tiers,
      history: history.recordset,
    };
  },
});
