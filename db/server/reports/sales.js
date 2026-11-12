// GET /api/reports/sales?from=2026-10-01&to=2026-10-31 -> managers only
// Completed sales only. Revenue = Subtotal (after discounts, before tax).
// Written by Terry (Part 2). Added by the team: the dates must be real calendar dates
// ('2026-99-99' used to pass the pattern and crash in SQL), the start cannot be after the
// end, and the end date is converted with CAST so SQL never guesses the date format.
const { route, HttpError } = require('../../lib/http');
const { query } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// true only for a real date written as YYYY-MM-DD
function realDate(text) {
  if (!DAY.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const q = req.query || {};
    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const from = q.from || monthAgo;
    const to = q.to || today;
    if (!realDate(from) || !realDate(to)) throw new HttpError(400, 'Dates must look like 2026-10-31.');
    if (from > to) throw new HttpError(400, 'The start date cannot be after the end date.');
    const p = { from, to };

    const days = await query(
      `SELECT * FROM VW_SALES_REPORT
       WHERE Sale_date BETWEEN @from AND @to ORDER BY Sale_date`, p);

    const byCategory = await query(
      `SELECT Category_name, SUM(Units) AS Units, SUM(Net_revenue) AS Net_revenue
       FROM VW_SALES_BY_CATEGORY
       WHERE Sale_date BETWEEN @from AND @to
       GROUP BY Category_id, Category_name ORDER BY Net_revenue DESC`, p);

    const top = await query(
      `SELECT TOP 5 p.Name, SUM(ti.Quantity) AS Units, SUM(ti.Line_total) AS Revenue
       FROM TRANSACTION_ITEM ti
       JOIN SALES_TRANSACTION s ON s.Transaction_id = ti.Transaction_id
       JOIN PRODUCT p ON p.Product_id = ti.Product_id
       WHERE s.Status = 'completed' AND s.Marked_for_deletion = 0 AND ti.Marked_for_deletion = 0
         AND s.Transaction_date >= @from AND s.Transaction_date < DATEADD(day, 1, CAST(@to AS DATE))
       GROUP BY p.Product_id, p.Name ORDER BY Units DESC`, p);

    return { from, to, days: days.recordset, byCategory: byCategory.recordset, topProducts: top.recordset };
  },
});
