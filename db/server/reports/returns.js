// GET /api/reports/returns?from=2026-08-01&to=2026-10-31 -> managers only (REP-4)
// Returns and refunds: every return requested between the two dates with its products, what was sold in
// the same dates (to turn units returned into a rate), the same figures for the period before (to show
// the direction), and the backlog that is waiting right now whatever the dates.
//
// Rules the page relies on:
//   - Removed rows (Marked_for_deletion) are left out. A customer who closed the account keeps their
//     returns in the report, because the refund still happened.
//   - Refunded cash counts only returns whose status is 'refunded'. Returned units count requested,
//     approved and refunded returns (not denied). The page does that arithmetic from `records`.
//   - The records and the numbers come from the same rows, so the table at the bottom adds up to the cards.
//   - Dates use lib/reportPeriods.js (default: the last 90 days, compared with the 90 days before).
const { route } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { parsePeriod } = require('../../lib/reportPeriods');

const MAX_ROWS = 1000;

const RANGE_RETURNS = 'CAST(r.Requested_at AS DATE) BETWEEN CAST(@from AS DATE) AND CAST(@to AS DATE)';
const RANGE_SALES = 'CAST(s.Transaction_date AS DATE) BETWEEN CAST(@from AS DATE) AND CAST(@to AS DATE)';

// one row per return requested in the dates, newest first. daysOpen runs from the request to the refund,
// or to now while the return is still waiting or approved; a denied return has none.
const RETURNS_SQL = `
  SELECT TOP (${MAX_ROWS})
         r.Return_id AS id, r.Transaction_id AS orderId, r.Requested_at AS requestedAt,
         r.Status AS status, r.Reason AS reason, r.Refund_total AS refundTotal, r.Refunded_at AS refundedAt,
         CONCAT(c.First_name, N' ', c.Last_name) AS customerName,
         s.Transaction_date AS soldAt,
         DATEDIFF(DAY, s.Transaction_date, r.Requested_at) AS daysSinceSale,
         CASE WHEN r.Status = 'denied' THEN NULL
              ELSE DATEDIFF(DAY, r.Requested_at, ISNULL(r.Refunded_at, SYSDATETIME())) END AS daysOpen,
         COUNT(*) OVER () AS totalCount
  FROM   PRODUCT_RETURN r
  JOIN   SALES_TRANSACTION s ON s.Transaction_id = r.Transaction_id AND s.Marked_for_deletion = 0
  LEFT JOIN CUSTOMER c ON c.Customer_id = s.Customer_id
  WHERE  r.Marked_for_deletion = 0 AND ${RANGE_RETURNS}
  ORDER BY r.Requested_at DESC, r.Return_id DESC`;

// the products on those returns, in one query (the ids go in as JSON, so nothing is built from user text)
const ITEMS_SQL = `
  SELECT ri.Return_id AS returnId, ri.Product_id AS productId, p.Name AS name, cat.Name AS category,
         ri.Quantity AS quantity, ri.Refund_amount AS refundAmount
  FROM   PRODUCT_RETURN_ITEM ri
  JOIN   PRODUCT p ON p.Product_id = ri.Product_id
  JOIN   CATEGORY cat ON cat.Category_id = p.Category_id
  WHERE  ri.Marked_for_deletion = 0
    AND  ri.Return_id IN (SELECT CAST([value] AS INT) FROM OPENJSON(@ids))
  ORDER BY ri.Return_id, p.Name, ri.Product_id`;

// units sold per product in the dates (completed sales only), to turn returned units into a rate
const SOLD_SQL = `
  SELECT ti.Product_id AS productId, p.Name AS name, cat.Name AS category, SUM(ti.Quantity) AS sold
  FROM   TRANSACTION_ITEM ti
  JOIN   SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
  JOIN   PRODUCT p ON p.Product_id = ti.Product_id
  JOIN   CATEGORY cat ON cat.Category_id = p.Category_id
  WHERE  ti.Marked_for_deletion = 0 AND s.Marked_for_deletion = 0 AND s.Status = 'completed'
    AND  ${RANGE_SALES}
  GROUP BY ti.Product_id, p.Name, cat.Name`;

// orders, revenue (Total, tax included, because refunds include their share of tax) and units in the dates
const SALES_SQL = `
  SELECT (SELECT COUNT(*) FROM SALES_TRANSACTION s
          WHERE s.Marked_for_deletion = 0 AND s.Status = 'completed' AND ${RANGE_SALES}) AS orders,
         (SELECT ISNULL(SUM(s.Total), 0) FROM SALES_TRANSACTION s
          WHERE s.Marked_for_deletion = 0 AND s.Status = 'completed' AND ${RANGE_SALES}) AS revenue,
         (SELECT ISNULL(SUM(ti.Quantity), 0) FROM TRANSACTION_ITEM ti
          JOIN SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
          WHERE ti.Marked_for_deletion = 0 AND s.Marked_for_deletion = 0 AND s.Status = 'completed'
            AND ${RANGE_SALES}) AS units`;

// the same returns figures for the previous period, so the page can say up or down
const PREVIOUS_SQL = `
  SELECT COUNT(*) AS requested,
         ISNULL(SUM(CASE WHEN r.Status <> 'denied' THEN u.units ELSE 0 END), 0) AS units,
         ISNULL(SUM(CASE WHEN r.Status = 'refunded' THEN r.Refund_total ELSE 0 END), 0) AS refundedCash,
         ISNULL(SUM(CASE WHEN r.Status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded,
         ISNULL(SUM(CASE WHEN r.Status = 'denied' THEN 1 ELSE 0 END), 0) AS denied,
         ISNULL(SUM(CASE WHEN r.Status IN ('approved', 'denied', 'refunded') THEN 1 ELSE 0 END), 0) AS decided,
         AVG(CASE WHEN r.Status = 'refunded'
                  THEN CAST(DATEDIFF(DAY, r.Requested_at, r.Refunded_at) AS FLOAT) END) AS avgDaysToRefund
  FROM   PRODUCT_RETURN r
  JOIN   SALES_TRANSACTION s ON s.Transaction_id = r.Transaction_id AND s.Marked_for_deletion = 0
  OUTER APPLY (SELECT ISNULL(SUM(x.Quantity), 0) AS units
               FROM PRODUCT_RETURN_ITEM x
               WHERE x.Return_id = r.Return_id AND x.Marked_for_deletion = 0) u
  WHERE  r.Marked_for_deletion = 0 AND ${RANGE_RETURNS}`;

// what is waiting right now, whatever the dates
const BACKLOG_SQL = `
  SELECT ISNULL(SUM(CASE WHEN r.Status = 'requested' THEN 1 ELSE 0 END), 0) AS waiting,
         MAX(CASE WHEN r.Status = 'requested' THEN DATEDIFF(DAY, r.Requested_at, SYSDATETIME()) END) AS oldestDays,
         ISNULL(SUM(CASE WHEN r.Status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
         ISNULL(SUM(CASE WHEN r.Status = 'approved' THEN r.Refund_total ELSE 0 END), 0) AS approvedAmount
  FROM   PRODUCT_RETURN r
  WHERE  r.Marked_for_deletion = 0`;

const first = (result, fallback = {}) => (result && result.recordset && result.recordset[0]) || fallback;
const list = (result) => (result && result.recordset) || [];

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const period = parsePeriod(req.query, { defaultDays: 90 });
    const current = { from: period.from, to: period.to };
    const before = period.previous;   // { from, to } or null when compare=none

    // these do not depend on each other, so they run together
    const [head, sold, salesNow, salesBefore, returnsBefore, backlog] = await Promise.all([
      query(RETURNS_SQL, current),
      query(SOLD_SQL, current),
      query(SALES_SQL, current),
      before ? query(SALES_SQL, before) : null,
      before ? query(PREVIOUS_SQL, before) : null,
      query(BACKLOG_SQL),
    ]);

    const rows = list(head);
    const total = rows.length ? Number(rows[0].totalCount) || rows.length : 0;

    // the products, grouped under their return
    const byReturn = new Map();
    if (rows.length) {
      const items = await query(ITEMS_SQL, { ids: JSON.stringify(rows.map((r) => r.id)) });
      list(items).forEach((item) => {
        const { returnId, ...rest } = item;
        if (!byReturn.has(returnId)) byReturn.set(returnId, []);
        byReturn.get(returnId).push(rest);
      });
    }

    const salesTotals = (result) => {
      const s = first(result, null);
      return s ? { orders: Number(s.orders) || 0, units: Number(s.units) || 0, revenue: Number(s.revenue) || 0 } : null;
    };

    return {
      period: { from: period.from, to: period.to, days: period.days, previous: before },
      records: {
        rows: rows.map(({ totalCount, ...r }) => ({ ...r, items: byReturn.get(r.id) || [] })),
        total,
        truncated: total > rows.length,
      },
      soldByProduct: list(sold),
      sales: { current: salesTotals(salesNow), previous: salesTotals(salesBefore) },
      previous: before ? { returns: first(returnsBefore, null) } : null,
      backlog: first(backlog, { waiting: 0, oldestDays: null, approved: 0, approvedAmount: 0 }),
    };
  },
});
