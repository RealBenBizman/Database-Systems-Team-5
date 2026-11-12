// Returns report: every calculation the page shows, in plain functions (no React, no imports), so they
// can be tested (tests/returnsMetrics.test.js). The page is ReturnsReportPage.jsx; the data comes from
// GET /api/reports/returns.
//
// Definitions (the same ones the report explains on screen):
//   returned units   units on returns that are requested, approved or refunded (denied returns do not count)
//   refunded cash    money on returns whose status is refunded (the tax share is included, as in the refund formula)
//   return rate      returned units / units sold in the same dates
//   days open        refunded: request to refund. Waiting or approved: request until now. Denied: none.

export const SLOW_REFUND_DAYS = 7;     // a refund that takes longer than this counts as slow
export const LONG_WAIT_DAYS = 3;       // a request that has waited longer than this counts as a long wait

export const STATUS_LABEL = {
  requested: 'Waiting for review',
  approved: 'Approved, not refunded',
  denied: 'Denied',
  refunded: 'Refunded',
};
export const STATUSES = ['requested', 'approved', 'refunded', 'denied'];

export const REASON_GROUPS = ['Defective or damaged', 'Wrong item', 'Not as described', 'Changed my mind', 'Other'];

const cents = (n) => Math.round(Number(n || 0) * 100);
const num = (n) => Number(n || 0);

// ---------- reasons ----------

// The customer types the reason, so the report puts each one in a group. First match wins, in this order.
export function reasonGroup(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return 'Other';
  if (/^other\b/.test(t)) return 'Other';
  if (/wrong|incorrect|not what i (ordered|asked)|different (item|product|game)|mixed up/.test(t)) return 'Wrong item';
  if (/not as described|as described|misleading|looks? different|different from (the )?(photo|picture|listing)|not like the (photo|picture)/.test(t)) return 'Not as described';
  if (/defect|damag|broken|broke\b|crushed|cracked|stopped working|doesn.?t work|does not work|not working|won.?t (turn on|work|read)|faulty|malfunction|dead on arrival|scratched/.test(t)) return 'Defective or damaged';
  if (/changed? (of )?(my )?mind|don.?t like|do not like|didn.?t like|no longer|not needed|don.?t need|doesn.?t fit|too (big|small|large)|cheaper|duplicate|already (have|own)|by mistake|didn.?t want|do not want|don.?t want/.test(t)) return 'Changed my mind';
  return 'Other';
}

// ---------- the rows ----------

// Adds what the page needs to every return the endpoint sent.
export function prepare(records) {
  return (records || []).map((r) => {
    const items = r.items || [];
    const units = items.reduce((sum, i) => sum + num(i.quantity), 0);
    const counts = r.status !== 'denied';
    return {
      ...r,
      items,
      units,
      countedUnits: counts ? units : 0,                                  // denied returns do not count as returned units
      refundValue: num(r.refundTotal),
      refundedCash: r.status === 'refunded' ? num(r.refundTotal) : 0,
      reasonGroup: reasonGroup(r.reason),
      day: String(r.requestedAt || '').slice(0, 10),
      productsText: items.map((i) => `${i.name} x${i.quantity}`).join(', '),
    };
  });
}

// status, reason group and a text search (customer, return number, order number, product, reason)
export function filterRows(rows, { status = 'All', reason = 'All', search = '' } = {}, { skipStatus = false } = {}) {
  const text = String(search || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (!skipStatus && status !== 'All' && r.status !== status) return false;
    if (reason !== 'All' && r.reasonGroup !== reason) return false;
    if (!text) return true;
    const hay = [r.customerName, r.id, r.orderId, r.reason, r.productsText].join(' ').toLowerCase();
    return hay.includes(text);
  });
}

// ---------- the numbers ----------

export function summarize(rows, sales) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const refunded = rows.filter((r) => r.status === 'refunded');
  const approved = rows.filter((r) => r.status === 'approved');
  const waiting = rows.filter((r) => r.status === 'requested');
  const denied = count('denied');
  const decided = denied + approved.length + refunded.length;
  const unitsSold = num(sales && sales.units);
  const unitsReturned = rows.reduce((sum, r) => sum + r.countedUnits, 0);
  const refundedCash = refunded.reduce((sum, r) => sum + cents(r.refundedCash), 0) / 100;
  const revenue = num(sales && sales.revenue);
  const daysToRefund = refunded.map((r) => num(r.daysOpen));
  const sinceSale = rows.map((r) => r.daysSinceSale).filter((d) => d !== null && d !== undefined);
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  return {
    returns: rows.length,
    waiting: waiting.length,
    approved: approved.length,
    refunded: refunded.length,
    denied,
    decided,
    deniedShare: decided > 0 ? (denied / decided) * 100 : null,
    unitsReturned,
    unitsSold,
    returnRate: unitsSold > 0 ? (unitsReturned / unitsSold) * 100 : null,
    refundedCash,
    revenue,
    refundShare: revenue > 0 ? (refundedCash / revenue) * 100 : null,
    approvedAmount: approved.reduce((sum, r) => sum + cents(r.refundValue), 0) / 100,
    avgDaysToRefund: mean(daysToRefund),
    slowRefunds: daysToRefund.filter((d) => d > SLOW_REFUND_DAYS).length,
    oldestWait: waiting.length ? Math.max(...waiting.map((r) => num(r.daysOpen))) : null,
    longWaits: waiting.filter((r) => num(r.daysOpen) > LONG_WAIT_DAYS).length,
    avgDaysSinceSale: mean(sinceSale),
  };
}

// The same numbers for the previous period, from what the endpoint sent. Null when there is none.
export function previousSummary(previous, sales) {
  if (!previous || !previous.returns) return null;
  const p = previous.returns;
  const unitsSold = num(sales && sales.units);
  const revenue = num(sales && sales.revenue);
  return {
    returns: num(p.requested),
    unitsReturned: num(p.units),
    unitsSold,
    returnRate: unitsSold > 0 ? (num(p.units) / unitsSold) * 100 : null,
    refundedCash: num(p.refundedCash),
    refundShare: revenue > 0 ? (num(p.refundedCash) / revenue) * 100 : null,
    avgDaysToRefund: p.avgDaysToRefund === null || p.avgDaysToRefund === undefined ? null : num(p.avgDaysToRefund),
    deniedShare: num(p.decided) > 0 ? (num(p.denied) / num(p.decided)) * 100 : null,
  };
}

// ---------- the tables ----------

// returns by reason group: how many, share, units, refunded cash
export function byReason(rows) {
  return REASON_GROUPS.map((g) => {
    const mine = rows.filter((r) => r.reasonGroup === g);
    return {
      reason: g,
      returns: mine.length,
      share: rows.length ? Math.round((mine.length / rows.length) * 100) : 0,
      units: mine.reduce((sum, r) => sum + r.countedUnits, 0),
      refundedCash: mine.reduce((sum, r) => sum + cents(r.refundedCash), 0) / 100,
    };
  }).filter((r) => r.returns > 0).sort((a, b) => b.returns - a.returns || a.reason.localeCompare(b.reason));
}

// Per product: units sold, units returned and the rate. `sold` is the endpoint's soldByProduct list.
export function byProduct(rows, sold) {
  const map = new Map();
  const get = (id, name, category) => {
    if (!map.has(id)) map.set(id, { productId: id, name, category, sold: 0, returned: 0, returns: 0, refundedCash: 0 });
    return map.get(id);
  };
  (sold || []).forEach((s) => { get(s.productId, s.name, s.category).sold = num(s.sold); });
  rows.forEach((r) => {
    r.items.forEach((i) => {
      const p = get(i.productId, i.name, i.category);
      if (r.status !== 'denied') {
        p.returned += num(i.quantity);
        p.returns += 1;
      }
      if (r.status === 'refunded') p.refundedCash += cents(i.refundAmount);
    });
  });
  return [...map.values()]
    .filter((p) => p.returned > 0)
    .map((p) => ({ ...p, refundedCash: p.refundedCash / 100, rate: p.sold > 0 ? (p.returned / p.sold) * 100 : null }))
    .sort((a, b) => b.returned - a.returned || (b.rate || 0) - (a.rate || 0) || a.name.localeCompare(b.name));
}

// Per category, the same idea. Categories that sold something are listed even when nothing came back.
export function byCategory(rows, sold) {
  const map = new Map();
  const get = (name) => {
    if (!map.has(name)) map.set(name, { category: name, sold: 0, returned: 0, refundedCash: 0 });
    return map.get(name);
  };
  (sold || []).forEach((s) => { get(s.category).sold += num(s.sold); });
  rows.forEach((r) => {
    r.items.forEach((i) => {
      const c = get(i.category);
      if (r.status !== 'denied') c.returned += num(i.quantity);
      if (r.status === 'refunded') c.refundedCash += cents(i.refundAmount);
    });
  });
  return [...map.values()]
    .map((c) => ({ ...c, refundedCash: c.refundedCash / 100, rate: c.sold > 0 ? (c.returned / c.sold) * 100 : null }))
    .sort((a, b) => b.returned - a.returned || a.category.localeCompare(b.category));
}

// returns by calendar month of the request, oldest first (the trend)
export function byMonth(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.day.slice(0, 7);
    if (!key) return;
    if (!map.has(key)) map.set(key, { month: key, returns: 0, units: 0, refundedCash: 0 });
    const m = map.get(key);
    m.returns += 1;
    m.units += r.countedUnits;
    m.refundedCash += cents(r.refundedCash);
  });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, refundedCash: m.refundedCash / 100 }));
}

// ---------- "What this means" ----------

const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (n, digits = 1) => `${Number(n).toFixed(digits)}%`;

const ACTION = {
  'Defective or damaged': 'Most of them are about faulty or damaged goods: check the condition of the most returned products and talk to their suppliers.',
  'Wrong item': 'Most of them are about the wrong item arriving: check how orders are picked and packed.',
  'Not as described': 'Most of them are about items that were not as described: review the descriptions and photos of the most returned products.',
  'Changed my mind': 'Most of them are changes of mind, which is normal for a shop, so no action is needed unless the number grows.',
  Other: 'Most of them give other reasons: read the reasons in the table at the bottom to see what they have in common.',
};

/*
  Plain sentences worked out from the numbers above, each with what to do about it.
    summary     summarize(rows, sales)       before   previousSummary(...) or null (null when a filter is on)
    reasons     byReason(rows)               products byProduct(rows, sold)
    backlog     the endpoint's all-dates backlog { waiting, oldestDays, approved, approvedAmount }
    period      { from, to, days }           filtered  true when the status, reason or search filter is on
*/
export function insights({ summary, before, reasons, products, backlog, period, filtered }) {
  const notes = [];
  const where = `from ${period.from} to ${period.to}`;

  if (summary.returns === 0) {
    notes.push(filtered ? `No returns match these filters ${where}.` : `No returns were requested ${where}.`);
  } else {
    let line = `${plural(summary.returns, 'return was', 'returns were')} requested ${where}`;
    if (before && before.returns !== null && !filtered) {
      if (before.returns === 0) line += ', and there were none in the period before';
      else {
        const change = ((summary.returns - before.returns) / before.returns) * 100;
        line += Math.abs(change) < 0.05
          ? ', the same as in the period before'
          : `, ${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} on the period before`;
      }
    }
    line += '.';
    if (summary.returnRate !== null) {
      line += ` ${plural(summary.unitsReturned, 'unit', 'units')} came back, ${pct(summary.returnRate)} of the ${summary.unitsSold} units sold in the same dates.`;
    }
    notes.push(line);
  }

  if (summary.refunded > 0 || summary.approved > 0) {
    let line = `Refunded cash is ${money(summary.refundedCash)}`;
    if (summary.refundShare !== null) line += `, ${pct(summary.refundShare)} of sales including tax`;
    line += '.';
    if (summary.approved > 0) line += ` ${plural(summary.approved, 'approved return', 'approved returns')} worth ${money(summary.approvedAmount)} still ${summary.approved === 1 ? 'has' : 'have'} to be refunded.`;
    notes.push(line);
  }

  if (reasons.length > 0 && summary.returns >= 3) {
    const top = reasons[0];
    notes.push(`The most common reason is "${top.reason}": ${top.returns} of ${summary.returns} returns (${top.share}%). ${ACTION[top.reason]}`);
  }

  if (products.length > 0) {
    const top = products[0];
    const overall = summary.returnRate;
    if (top.rate !== null && top.returned >= 3 && (overall === null || overall === 0 || top.rate >= 2 * overall)) {
      const times = overall ? ` That is ${(top.rate / overall).toFixed(1)} times the store average.` : '';
      notes.push(`${top.name} comes back most: ${top.returned} of ${top.sold} units sold (${pct(top.rate)}).${times} Check its condition and description, and the supplier behind it.`);
    } else if (top.returned >= 2) {
      notes.push(`${top.name} is the most returned product, with ${top.returned} units.`);
    }
  }

  const waitingNow = backlog && Number(backlog.waiting) > 0 ? Number(backlog.waiting) : 0;
  if (waitingNow > 0) {
    let line = `${plural(waitingNow, 'return is', 'returns are')} waiting for review right now (all dates)`;
    if (backlog.oldestDays !== null && backlog.oldestDays !== undefined) line += `; the oldest has waited ${plural(Number(backlog.oldestDays), 'day', 'days')}`;
    notes.push(`${line}. Open the Returns queue to approve or deny them.`);
  }

  if (summary.avgDaysToRefund !== null) {
    let line = `Refunds take ${summary.avgDaysToRefund.toFixed(1)} days on average from the request`;
    if (summary.slowRefunds > 0) line += `, and ${summary.slowRefunds} took more than ${SLOW_REFUND_DAYS} days`;
    notes.push(`${line}.`);
  }

  if (summary.denied > 0 && summary.decided >= 5) {
    notes.push(`${summary.denied} of ${summary.decided} decided returns ${summary.denied === 1 ? 'was' : 'were'} denied (${pct(summary.deniedShare, 0)}).`);
  }

  if (notes.length === 0) notes.push('Nothing needs attention for the returns shown.');
  return notes;
}
