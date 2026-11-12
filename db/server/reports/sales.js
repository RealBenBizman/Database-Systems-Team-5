// GET /api/reports/sales -> managers only
// Query: from, to, compare (previous | lastyear | none), groupBy (day | week | month),
//        category (id), product (id), method (credit | debit)
// Completed sales only. Revenue = line totals after discounts, before tax.
// Net revenue = revenue minus refunded returns (counted on the day of the original sale, like VW_SALES_REPORT).
// Cost = units kept x the product's CURRENT Cost_price (TRANSACTION_ITEM has no cost snapshot).
// Written by Terry (Part 2).
const { route, HttpError } = require('../../lib/http');
const { query, sql } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { parsePeriod, bucketSql, buckets, fillSeries } = require('../../lib/reportPeriods');

const METHODS = ['credit', 'debit'];

function idParam(value, name) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be an id.`);
  return n;
}
function methodParam(value) {
  if (value == null || value === '') return null;
  if (!METHODS.includes(value)) throw new HttpError(400, 'method must be credit or debit.');
  return value;
}

// Every completed sale line in the range that passes the filters, with its refund and cost.
function linesCte(groupBy) {
  return `
  WITH lines AS (
    SELECT s.Transaction_id,
           CAST(s.Transaction_date AS DATE) AS Sale_date,
           ${bucketSql('s.Transaction_date', groupBy)} AS Bucket,
           s.Customer_id,
           ti.Product_id,
           c.Category_id, c.Name AS Category_name,
           pm.Method,
           ti.Quantity,
           ti.Line_total,
           ti.Discount_amount,
           ROUND(ti.Line_total * r.Qty / ti.Quantity, 2) AS Refunded,
           (ti.Quantity - r.Qty) * p.Cost_price          AS Cost
    FROM   SALES_TRANSACTION s
    JOIN   TRANSACTION_ITEM ti ON ti.Transaction_id = s.Transaction_id AND ti.Marked_for_deletion = 0
    JOIN   PRODUCT p  ON p.Product_id  = ti.Product_id
    JOIN   CATEGORY c ON c.Category_id = p.Category_id
    OUTER APPLY (SELECT TOP (1) pay.Method FROM PAYMENT pay
                 WHERE pay.Transaction_id = s.Transaction_id AND pay.Marked_for_deletion = 0
                 ORDER BY pay.Payment_id) pm
    CROSS APPLY (SELECT ISNULL(SUM(ri.Quantity), 0) AS Qty
                 FROM   PRODUCT_RETURN pr
                 JOIN   PRODUCT_RETURN_ITEM ri ON ri.Return_id = pr.Return_id
                 WHERE  pr.Transaction_id = ti.Transaction_id AND ri.Product_id = ti.Product_id
                   AND  pr.Status = 'refunded' AND pr.Marked_for_deletion = 0 AND ri.Marked_for_deletion = 0) r
    WHERE  s.Status = 'completed' AND s.Marked_for_deletion = 0
      AND  s.Transaction_date >= CAST(@from AS DATE)
      AND  s.Transaction_date <  DATEADD(DAY, 1, CAST(@to AS DATE))
      AND  (@category IS NULL OR c.Category_id = @category)
      AND  (@product  IS NULL OR ti.Product_id = @product)
      AND  (@method   IS NULL OR pm.Method = @method)
  )`;
}

const TOTALS_SQL = `
  SELECT COUNT(DISTINCT Transaction_id) AS orders, COUNT(DISTINCT Customer_id) AS customers,
         ISNULL(SUM(Quantity), 0) AS units, ISNULL(SUM(Line_total), 0) AS gross,
         ISNULL(SUM(Refunded), 0) AS refunded, ISNULL(SUM(Cost), 0) AS cost,
         ISNULL(SUM(Discount_amount), 0) AS discounts
  FROM   lines`;

const TREND_SQL = `
  SELECT Bucket AS bucket,
         SUM(Line_total - Refunded)        AS revenue,
         SUM(Line_total - Refunded - Cost) AS profit,
         COUNT(DISTINCT Transaction_id)    AS orders
  FROM   lines
  GROUP BY Bucket`;

const CATEGORY_SQL = `
  SELECT Category_id AS categoryId, Category_name AS category,
         SUM(Quantity) AS units,
         SUM(Line_total - Refunded)        AS revenue,
         SUM(Line_total - Refunded - Cost) AS profit
  FROM   lines
  GROUP BY Category_id, Category_name
  ORDER BY revenue DESC`;

// every active product (so products that sold nothing show up as the worst performers)
const PRODUCT_SQL = `,
  sold AS (
    SELECT Product_id, SUM(Quantity) AS units, SUM(Line_total - Refunded) AS revenue, SUM(Cost) AS cost
    FROM   lines GROUP BY Product_id
  )
  SELECT p.Product_id AS productId, p.Name AS name, c.Name AS category,
         ISNULL(x.units, 0) AS units, ISNULL(x.revenue, 0) AS revenue, ISNULL(x.cost, 0) AS cost,
         ISNULL(x.revenue, 0) - ISNULL(x.cost, 0) AS profit
  FROM   PRODUCT p
  JOIN   CATEGORY c ON c.Category_id = p.Category_id
  LEFT JOIN sold x ON x.Product_id = p.Product_id
  WHERE  p.Marked_for_deletion = 0 AND (p.Is_active = 1 OR x.Product_id IS NOT NULL)
    AND  (@category IS NULL OR p.Category_id = @category)
    AND  (@product  IS NULL OR p.Product_id = @product)
  ORDER BY units DESC, revenue DESC, p.Name`;

const METHOD_SQL = `
  SELECT ISNULL(Method, 'unknown') AS method,
         COUNT(DISTINCT Transaction_id) AS orders,
         SUM(Line_total - Refunded)     AS revenue
  FROM   lines
  GROUP BY Method`;

const ORDERS_SQL = `
  SELECT l.Transaction_id AS orderId, MIN(l.Sale_date) AS saleDate,
         CONCAT(cu.First_name, N' ', cu.Last_name) AS customer, MAX(l.Method) AS method,
         SUM(l.Quantity) AS units, SUM(l.Line_total) AS gross, SUM(l.Refunded) AS refunded, SUM(l.Cost) AS cost
  FROM   lines l
  JOIN   CUSTOMER cu ON cu.Customer_id = l.Customer_id
  GROUP BY l.Transaction_id, cu.First_name, cu.Last_name
  ORDER BY saleDate DESC, orderId DESC`;

const CATEGORY_LIST_SQL = `SELECT Category_id AS id, Name AS name FROM CATEGORY WHERE Marked_for_deletion = 0 ORDER BY Name`;
const PRODUCT_LIST_SQL = `SELECT Product_id AS id, Name AS name, Category_id AS categoryId FROM PRODUCT WHERE Marked_for_deletion = 0 ORDER BY Name`;

const round2 = (x) => Math.round(x * 100) / 100;
const num = (v) => Number(v) || 0;

// the KPI numbers from one TOTALS_SQL row
function summarize(r) {
  const net = round2(num(r.gross) - num(r.refunded));
  const cost = round2(num(r.cost));
  const profit = round2(net - cost);
  const orders = num(r.orders);
  return {
    orders, customers: num(r.customers), units: num(r.units),
    gross: round2(num(r.gross)), refunded: round2(num(r.refunded)), discounts: round2(num(r.discounts)),
    net, cost, profit,
    margin: net > 0 ? Math.round((profit / net) * 1000) / 10 : null,
    avgOrder: orders ? round2(net / orders) : null,
  };
}

module.exports = route({
  GET: async (req) => {
    requireAuth(req, ['manager']);
    const q = req.query || {};
    const period = parsePeriod(q);
    const f = {
      category: idParam(q.category, 'category'),
      product: idParam(q.product, 'product'),
      method: methodParam(q.method),
    };
    const cte = linesCte(period.groupBy);
    const params = (range) => ({
      from: range.from, to: range.to,
      category: { type: sql.Int, value: f.category },
      product: { type: sql.Int, value: f.product },
      method: { type: sql.VarChar(10), value: f.method },
    });
    const cur = params(period);
    const prev = period.previous ? params(period.previous) : null;

    // all at once instead of one after another (the TA said the app is slow)
    const [totals, trend, byCategory, products, methods, orders, prevTotals, prevTrend, cats, prods] = await Promise.all([
      query(cte + TOTALS_SQL, cur),
      query(cte + TREND_SQL, cur),
      query(cte + CATEGORY_SQL, cur),
      query(cte + PRODUCT_SQL, cur),
      query(cte + METHOD_SQL, cur),
      query(cte + ORDERS_SQL, cur),
      prev ? query(cte + TOTALS_SQL, prev) : null,
      prev ? query(cte + TREND_SQL, prev) : null,
      query(CATEGORY_LIST_SQL),
      query(PRODUCT_LIST_SQL),
    ]);

    // one point per day/week/month with zeros where nothing sold, plus the comparison line
    const series = fillSeries(buckets(period.from, period.to, period.groupBy), trend.recordset, 'bucket', ['revenue', 'profit', 'orders']);
    const prevSeries = prev
      ? fillSeries(buckets(period.previous.from, period.previous.to, period.groupBy), prevTrend.recordset, 'bucket', ['revenue'])
      : [];
    series.forEach((pt, i) => { pt.prevRevenue = prev && prevSeries[i] ? prevSeries[i].revenue : null; });

    return {
      period,
      totals: summarize(totals.recordset[0]),
      previousTotals: prev ? summarize(prevTotals.recordset[0]) : null,
      trend: series,
      byCategory: byCategory.recordset.map((r) => ({ ...r, revenue: round2(num(r.revenue)), profit: round2(num(r.profit)) })),
      products: products.recordset.map((r) => ({ ...r, revenue: round2(num(r.revenue)), cost: round2(num(r.cost)), profit: round2(num(r.profit)) })),
      paymentMethods: methods.recordset,
      orders: orders.recordset.map((o) => {
        const net = round2(num(o.gross) - num(o.refunded));
        return { ...o, net, cost: round2(num(o.cost)), profit: round2(net - num(o.cost)) };
      }),
      options: { categories: cats.recordset, products: prods.recordset },
    };
  },
});
