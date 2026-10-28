// GET /api/reports/rewards?top=10 -> rewards program report, managers only. All time.
// Built on the view VW_REWARDS_REPORT (db/core/views.sql): one row per customer.
// { totals: { customers, pointsIssued, pointsTakenBack, pointsOutstanding, totalSpent },
//   tiers: [{ tier, customers, points, minPoints }],          lowest tier first ('No tier' first); a tier nobody holds shows 0
//   topEarners: [{ customerId, name, tier, pointsEarned, pointsTakenBack, balance, orders, totalSpent, lastActivity }] }
// pointsIssued = points earned on purchases; pointsTakenBack = points taken back by refunds;
// pointsOutstanding = what customers hold right now (issued minus taken back); totalSpent is before tax.
// `top` is how many top earners to list (1 to 50, default 10).
const db = require('../../lib/db');
const { route } = require('../../lib/http');
const { requireAuth } = require('../../lib/auth');
const validate = require('../../lib/validate');

const NO_TIER = 'No tier';

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const q = req.query || {};
    let top = 10;
    if (q.top !== undefined && q.top !== '') {
      top = validate.integer(q.top, 'Top', { min: 1, max: 50 });
    }

    const [totals, tierCounts, tierDefs, earners] = await Promise.all([
      db.query(`SELECT COUNT(*) AS customers, ISNULL(SUM(Points_earned), 0) AS pointsIssued,
          ISNULL(SUM(Points_taken_back), 0) AS pointsTakenBack, ISNULL(SUM(Loyalty_points), 0) AS pointsOutstanding,
          CAST(ISNULL(SUM(Total_spent), 0) AS DECIMAL(14,2)) AS totalSpent
        FROM VW_REWARDS_REPORT`),
      db.query(`SELECT Tier_name AS tier, COUNT(*) AS customers, ISNULL(SUM(Loyalty_points), 0) AS points
        FROM VW_REWARDS_REPORT GROUP BY Tier_name`),
      db.query(`SELECT Tier_name AS tier, MIN(Min_points) AS minPoints
        FROM REWARD_TIER WHERE Marked_for_deletion = 0 GROUP BY Tier_name`),
      db.query(`SELECT TOP (@top) Customer_id AS customerId, Customer_name AS name, Tier_name AS tier,
          Points_earned AS pointsEarned, Points_taken_back AS pointsTakenBack, Loyalty_points AS balance,
          Orders AS orders, Total_spent AS totalSpent, Last_activity AS lastActivity
        FROM VW_REWARDS_REPORT WHERE Points_earned > 0
        ORDER BY Points_earned DESC, Customer_id`, { top }),
    ]);

    // every defined tier appears, even with 0 customers; 'No tier' sorts first, then by the tier's minimum points
    const minOf = new Map(tierDefs.recordset.map((t) => [t.tier, Number(t.minPoints)]));
    const byTier = new Map(tierCounts.recordset.map((t) => [t.tier, { tier: t.tier, customers: Number(t.customers), points: Number(t.points) }]));
    for (const name of minOf.keys()) if (!byTier.has(name)) byTier.set(name, { tier: name, customers: 0, points: 0 });
    if (!byTier.has(NO_TIER)) byTier.set(NO_TIER, { tier: NO_TIER, customers: 0, points: 0 });
    const tiers = [...byTier.values()]
      .map((t) => ({ ...t, minPoints: t.tier === NO_TIER ? 0 : (minOf.has(t.tier) ? minOf.get(t.tier) : null) }))
      .sort((a, b) => (a.tier === NO_TIER ? -1 : b.tier === NO_TIER ? 1 : (a.minPoints ?? 0) - (b.minPoints ?? 0)));

    const t = totals.recordset[0];
    return {
      totals: {
        customers: Number(t.customers), pointsIssued: Number(t.pointsIssued), pointsTakenBack: Number(t.pointsTakenBack),
        pointsOutstanding: Number(t.pointsOutstanding), totalSpent: Number(t.totalSpent),
      },
      tiers,
      topEarners: earners.recordset,
    };
  },
});
