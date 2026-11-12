
/*
 * REP-4: Returns and Refunds Report
 * GET /api/reports/returns
 *
 * Manager-only report showing return statistics
 * and individual return transactions.
 */

const { route, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

// Validate YYYY-MM-DD calendar dates.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function realDate(text) {
  if (typeof text !== 'string' || !DAY.test(text)) return false;

  const d = new Date(`${text}T00:00:00Z`);

  return !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === text;
}

module.exports = route({
  GET: async (req) => {
    // Only managers can access this report.
    requireAuth(req, ['manager']);

    const q = req.query || {};

    // Default to the last 30 days.
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(
      Date.now() - 30 * 86400000
    ).toISOString().slice(0, 10);

    const from = q.from || monthAgo;
    const to = q.to || today;
    const status = q.status || 'all';
    const search = q.search || '';

    // Validate date filters.
    if (!realDate(from) || !realDate(to)) {
      throw new HttpError(400, 'Invalid date format.');
    }

    if (from > to) {
      throw new HttpError(400, 'Start date cannot be after end date.');
    }

    const validStatuses = [
      'all', 'requested', 'approved', 'denied', 'refunded'
    ];

    if (!validStatuses.includes(status)) {
      throw new HttpError(400, 'Invalid return status.');
    }

    if (typeof search !== 'string' || search.length > 100) {
      throw new HttpError(400, 'Invalid search value.');
    }

    const params = { from, to, status, search };

    // Statistics for the selected date range.
    // Status/search filters apply to the table, not the KPIs.
    const summary = await query(
      `SELECT
         COUNT(DISTINCT Return_id) AS Total_Returns,

         COUNT(DISTINCT CASE
           WHEN Status = 'refunded' THEN Return_id
         END) AS Refunded_Returns,

         COUNT(DISTINCT CASE
           WHEN Status = 'requested' THEN Return_id
         END) AS Requested_Returns,

         COUNT(DISTINCT CASE
           WHEN Status = 'approved' THEN Return_id
         END) AS Approved_Returns,

         COUNT(DISTINCT CASE
           WHEN Status = 'denied' THEN Return_id
         END) AS Denied_Returns,

         COALESCE(SUM(CASE
           WHEN Status = 'refunded' THEN Refund_amount
           ELSE 0
         END), 0) AS Total_Refunded_Cash

       FROM dbo.VW_RETURNS_ANALYSIS
       WHERE Request_date BETWEEN CAST(@from AS DATE)
                              AND CAST(@to AS DATE)`,
      params
    );

    // Individual return items for the bottom table.
    const transactions = await query(
      `SELECT
         Return_id,
         Transaction_id,
         Product_id,
         Product_name,
         Category_name,
         Request_date,
         Status,
         Reason,
         Quantity,
         Refund_amount

       FROM dbo.VW_RETURNS_ANALYSIS

       WHERE Request_date BETWEEN CAST(@from AS DATE)
                              AND CAST(@to AS DATE)

         AND (@status = 'all' OR Status = @status)

         AND (
           @search = ''
           OR Product_name LIKE '%' + @search + '%'
           OR CAST(Return_id AS VARCHAR(20)) LIKE '%' + @search + '%'
         )

       ORDER BY Request_date DESC, Return_id DESC`,
      params
    );

    return {
      from,
      to,
      status,
      search,
      summary: summary.recordset[0],
      transactions: transactions.recordset
    };
  }
});
