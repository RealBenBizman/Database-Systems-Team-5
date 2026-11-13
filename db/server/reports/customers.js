const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { parsePeriod, dayKey } = require('../../lib/reportPeriods');
const { rewardStatus, numberOrders, rollUp } = require('../../lib/customerMetrics');
const CUSTOMERS_SQL = `
  SELECT v.Customer_id AS customerId, v.Customer_name AS name, v.Tier_name AS tier,
         v.Loyalty_points AS points, v.Orders AS ordersAllTime, v.Total_spent AS spentAllTime,
         ISNULL(b.ordersBefore, 0) AS ordersBefore, b.lastBefore,
         ISNULL(lp.pointsEarned, 0) AS pointsEarned, ISNULL(lp.pointsTakenBack, 0) AS pointsTakenBack
  FROM   VW_REWARDS_REPORT v
  OUTER APPLY (SELECT COUNT(*) AS ordersBefore, MAX(CAST(s.Transaction_date AS DATE)) AS lastBefore
               FROM   SALES_TRANSACTION s
               WHERE  s.Customer_id = v.Customer_id AND s.Status = 'completed' AND s.Marked_for_deletion = 0
                 AND  s.Transaction_date < CAST(@from AS DATE)) b
  OUTER APPLY (SELECT SUM(CASE WHEN lt.Points_change > 0 THEN lt.Points_change ELSE 0 END) AS pointsEarned,
                      SUM(CASE WHEN lt.Points_change < 0 THEN -lt.Points_change ELSE 0 END) AS pointsTakenBack
               FROM   LOYALTY_TRANSACTION lt
               WHERE  lt.Customer_id = v.Customer_id AND lt.Marked_for_deletion = 0
                 AND  lt.Created_at >= CAST(@from AS DATE)
                 AND  lt.Created_at <  DATEADD(DAY, 1, CAST(@to AS DATE))) lp
  ORDER BY v.Customer_name, v.Customer_id`;
const ORDERS_SQL = `
  SELECT s.Transaction_id AS orderId, s.Customer_id AS customerId,
         CAST(s.Transaction_date AS DATE) AS saleDate,
         SUM(ti.Quantity) AS units, SUM(ti.Line_total) AS total
  FROM   SALES_TRANSACTION s
  JOIN   CUSTOMER cu ON cu.Customer_id = s.Customer_id AND cu.Marked_for_deletion = 0
  JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id AND ti.Marked_for_deletion = 0
  WHERE  s.Status = 'completed' AND s.Marked_for_deletion = 0
    AND  s.Transaction_date >= CAST(@from AS DATE)
    AND  s.Transaction_date <  DATEADD(DAY, 1, CAST(@to AS DATE))
  GROUP BY s.Transaction_id, s.Customer_id, CAST(s.Transaction_date AS DATE)
  ORDER BY saleDate, orderId`;
const CATEGORY_SQL = `
  SELECT s.Customer_id AS customerId, c.Name AS category,
         SUM(ti.Quantity) AS units, SUM(ti.Line_total) AS revenue
  FROM   SALES_TRANSACTION s
  JOIN   CUSTOMER cu ON cu.Customer_id = s.Customer_id AND cu.Marked_for_deletion = 0
  JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id AND ti.Marked_for_deletion = 0
  JOIN   PRODUCT p  ON p.Product_id  = ti.Product_id
  JOIN   CATEGORY c ON c.Category_id = p.Category_id
  WHERE  s.Status = 'completed' AND s.Marked_for_deletion = 0
    AND  s.Transaction_date >= CAST(@from AS DATE)
    AND  s.Transaction_date <  DATEADD(DAY, 1, CAST(@to AS DATE))
  GROUP BY s.Customer_id, c.Name`;
const REWARDS_SQL = `
  SELECT d.Discount_id AS rewardId, cu.Customer_id AS customerId, rt.Tier_name AS tier,
         d.Start_date AS issued, d.End_date AS expires,
         u.usedOn, ISNULL(u.saved, 0) AS saved
  FROM   DISCOUNT d
  JOIN   CUSTOMER cu ON cu.Customer_id = TRY_CAST(SUBSTRING(d.Code, 6, 7) AS INT) AND cu.Marked_for_deletion = 0
  JOIN   REWARD_TIER rt ON rt.Tier_id = TRY_CAST(SUBSTRING(d.Code, 14, 7) AS INT)
  OUTER APPLY (SELECT MIN(CAST(s.Transaction_date AS DATE)) AS usedOn, SUM(ti.Discount_amount) AS saved
               FROM   TRANSACTION_ITEM ti
               JOIN   SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
               WHERE  ti.Discount_id = d.Discount_id AND ti.Marked_for_deletion = 0
                 AND  s.Status = 'completed' AND s.Marked_for_deletion = 0) u
  WHERE  d.Code LIKE 'TIER-%' AND d.Marked_for_deletion = 0
    AND  d.Start_date <= CAST(@to AS DATE)
  ORDER BY d.Start_date DESC, d.Discount_id DESC`;
const TIERS_SQL = `
  SELECT Tier_name AS tier, MIN(Min_points) AS minPoints
  FROM   REWARD_TIER
  WHERE  Marked_for_deletion = 0
  GROUP BY Tier_name
  ORDER BY minPoints`;
const withDay = (rows, ...keys) => rows.map((r) => {
  const out = { ...r };
  keys.forEach((k) => { out[k] = dayKey(r[k]); });
  return out;
});
module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const period = parsePeriod(req.query);
    const range = { from: period.from, to: period.to };
    const [customers, orders, categories, rewards, tiers, before] = await Promise.all([
      query(CUSTOMERS_SQL, range),
      query(ORDERS_SQL, range),
      query(CATEGORY_SQL, range),
      query(REWARDS_SQL, { to: period.to }),
      query(TIERS_SQL),
      period.previous ? query(ORDERS_SQL, period.previous) : null,
    ]);
    const people = withDay(customers.recordset, 'lastBefore');
    const sales = numberOrders(withDay(orders.recordset, 'saleDate'), people);
    const rows = rollUp(people, sales, before ? withDay(before.recordset, 'saleDate') : null, categories.recordset);
    const today = dayKey(new Date());
    const cents = rows.reduce((sum, c) => sum + Math.round(c.spent * 100), 0);
    return {
      period,
      tiers: tiers.recordset.map((t) => t.tier),
      customers: rows,
      orders: sales.reverse(),
      categories: categories.recordset,
      rewards: withDay(rewards.recordset, 'issued', 'expires', 'usedOn').map((r) => ({ ...r, status: rewardStatus(r, today) })),
      totals: {
        customers: rows.length,
        buyers: rows.filter((c) => c.orders > 0).length,
        orders: sales.length,
        revenue: cents / 100,
      },
    };
  },
});
