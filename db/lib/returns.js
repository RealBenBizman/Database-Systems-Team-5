/*
    lib/returns.js - the pieces of Part 3 (returns) that more than one endpoint uses

    refundFor(...)     the refund for q of n units, to the cent, exactly as the database guard allows
    eligibility(...)   can this customer return this order, and how many of each product is left to return
    loadReturns(...)   returns with their items, for the customer list and for the staff queue

    Everything here runs through lib/db.js with @parameters.
*/
const db = require('./db');

const RETURN_STATUSES = ['requested', 'approved', 'denied', 'refunded'];

/*
    refund = round( (L + T * L / S) * q / n , 2 )
      L = the product's line total (after its discount, before tax)   T = the sale's tax   S = the sale's subtotal
      q = units being returned                                         n = units bought

    TR_PRODUCT_RETURN_ITEM_Guard accepts a Refund_amount R when 2*L*(S+T)*q + S*n >= 2*R*S*n (all in cents),
    so the largest R it accepts is floor((2*L*(S+T)*q + S*n) / (2*S*n)). That is the rounded formula, with no
    floating point, and it can never be above what the guard allows. If S = 0 the tax share is 0 (as in the guard).
    Money in, money out in dollars; the arithmetic is done in whole cents with BigInt.
*/
function toCents(value) {
  return BigInt(Math.round(Number(value || 0) * 100));
}

function refundFor({ lineTotal, subtotal, tax, purchased, quantity }) {
  const L = toCents(lineTotal);
  const S = toCents(subtotal);
  const T = toCents(tax);
  const n = BigInt(purchased);
  const q = BigInt(quantity);
  if (n <= 0n || q <= 0n) return 0;
  const cents = S === 0n
    ? (2n * L * q + n) / (2n * n)
    : (2n * L * (S + T) * q + S * n) / (2n * S * n);
  return Number(cents) / 100;
}

/*
    The customer's own order, as far as returns are concerned. `run` is db.query or tx.query, so the same
    check can run inside the transaction that creates the return. Returns null when the order is not the
    customer's, does not exist, or is still open.

    Units already on other returns count unless that return was denied, the same way the guard counts them
    (soft-deleted rows included, on purpose: whatever the guard counts, we count).
*/
async function eligibility(run, orderId, customerId) {
  const params = { orderId, customerId };
  const saleResult = await run(`SELECT s.Transaction_id AS id, s.Status AS status, s.Transaction_date AS date,
      s.Subtotal AS subtotal, s.Tax_amount AS tax, s.Total AS total,
      CONVERT(VARCHAR(10), DATEADD(DAY, 30, s.Transaction_date), 23) AS deadline,
      DATEDIFF(DAY, CAST(SYSDATETIME() AS DATE), CAST(DATEADD(DAY, 30, s.Transaction_date) AS DATE)) AS daysLeft,
      CAST(CASE WHEN SYSDATETIME() > DATEADD(DAY, 30, s.Transaction_date) THEN 1 ELSE 0 END AS BIT) AS expired
    FROM SALES_TRANSACTION s
    WHERE s.Transaction_id = @orderId AND s.Customer_id = @customerId
      AND s.Status <> 'open' AND s.Marked_for_deletion = 0`, params);
  const sale = saleResult.recordset[0];
  if (!sale) return null;

  const lineResult = await run(`SELECT ti.Product_id AS productId, p.Name AS name, ti.Quantity AS purchased,
      ti.Line_total AS lineTotal,
      ISNULL((SELECT SUM(x.Quantity)
              FROM PRODUCT_RETURN_ITEM x
              JOIN PRODUCT_RETURN rx ON rx.Return_id = x.Return_id
              WHERE rx.Transaction_id = ti.Transaction_id AND x.Product_id = ti.Product_id
                AND rx.Status <> 'denied'), 0) AS returned
    FROM TRANSACTION_ITEM ti
    JOIN PRODUCT p ON p.Product_id = ti.Product_id
    WHERE ti.Transaction_id = @orderId AND ti.Marked_for_deletion = 0
    ORDER BY p.Name, ti.Product_id`, { orderId });

  const lines = lineResult.recordset.map((line) => {
    const purchased = Number(line.purchased);
    const returned = Number(line.returned);
    const available = Math.max(0, purchased - returned);
    const refunds = [];
    for (let q = 1; q <= available; q += 1) {
      refunds.push(refundFor({ lineTotal: line.lineTotal, subtotal: sale.subtotal, tax: sale.tax, purchased, quantity: q }));
    }
    return { productId: line.productId, name: line.name, purchased, returned, available, lineTotal: line.lineTotal, refunds };
  });

  const blockedReason = sale.status !== 'completed' ? 'voided'
    : sale.expired ? 'expired'
    : lines.every((line) => line.available === 0) ? 'nothing_left'
    : null;

  return { sale: { ...sale, expired: !!sale.expired, canReturn: blockedReason === null, blockedReason }, lines };
}

/*
    Returns with their items. `where` is fixed SQL written in the endpoint (never user text); the values go in
    `params`. The query joins SALES_TRANSACTION and CUSTOMER, so `where` can use r. (return), s. (sale) and c. (customer).
    `orderBy` must also be fixed SQL from the endpoint.
*/
async function loadReturns(where, params, orderBy = 'r.Requested_at DESC, r.Return_id DESC', limit = 200) {
  const head = await db.query(`SELECT TOP (${Number(limit)}) r.Return_id AS id, r.Transaction_id AS orderId,
      r.Requested_at AS requestedAt, r.Status AS status, r.Reason AS reason, r.Refund_total AS refundTotal,
      r.Refunded_at AS refundedAt, c.Customer_id AS customerId, CONCAT(c.First_name, N' ', c.Last_name) AS customerName,
      e.FirstName AS handledBy
    FROM PRODUCT_RETURN r
    JOIN SALES_TRANSACTION s ON s.Transaction_id = r.Transaction_id AND s.Marked_for_deletion = 0
    JOIN CUSTOMER c ON c.Customer_id = s.Customer_id AND c.Marked_for_deletion = 0
    LEFT JOIN EMPLOYEE e ON e.Employee_id = r.Employee_id
    WHERE r.Marked_for_deletion = 0 AND ${where}
    ORDER BY ${orderBy}`, params);
  const returns = head.recordset;
  if (returns.length === 0) return [];

  const items = await db.query(`SELECT ri.Return_id AS returnId, ri.Product_id AS productId, p.Name AS name,
      ri.Quantity AS quantity, ri.Refund_amount AS refundAmount
    FROM PRODUCT_RETURN_ITEM ri
    JOIN PRODUCT p ON p.Product_id = ri.Product_id
    WHERE ri.Marked_for_deletion = 0
      AND ri.Return_id IN (SELECT CAST([value] AS INT) FROM OPENJSON(@ids))
    ORDER BY ri.Return_id, p.Name, ri.Product_id`, { ids: JSON.stringify(returns.map((r) => r.id)) });

  const byReturn = new Map();
  for (const item of items.recordset) {
    const { returnId, ...rest } = item;
    if (!byReturn.has(returnId)) byReturn.set(returnId, []);
    byReturn.get(returnId).push(rest);
  }
  return returns.map((r) => ({ ...r, items: byReturn.get(r.id) || [] }));
}

// SQL Server's error number, wherever the driver put it.
function sqlNumber(err) {
  return err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
}

module.exports = { RETURN_STATUSES, refundFor, eligibility, loadReturns, sqlNumber };
