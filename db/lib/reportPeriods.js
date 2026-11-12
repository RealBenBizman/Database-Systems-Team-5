/*
    lib/reportPeriods.js - date ranges for every report (REP-7, shared)

    Every report page has the same date controls: from, to, compare (previous, lastyear, none) and
    groupBy (day, week, month). This file is the one place that turns those into dates, so the four
    reports always agree on what "the previous period" or "this week" means.

    Dates are plain 'YYYY-MM-DD' strings. All the maths is done in UTC, so the server's time zone
    never moves a day. Weeks start on Monday.

    Typical use in an endpoint:

        const { parsePeriod, bucketSql, buckets, fillSeries } = require('../../lib/reportPeriods');
        const period = parsePeriod(req.query);          // throws HttpError(400) for a bad value
        // period = { from, to, days, compare, groupBy, groupByUsed, groupByChanged, previous }
        const weekKey = bucketSql('s.Transaction_date', period.groupBy);
        // ... GROUP BY ${weekKey}, then:
        const trend = fillSeries(buckets(period.from, period.to, period.groupBy), rows, 'bucket', ['revenue']);

    The function names previousPeriod, lastYearPeriod and buckets are the ones the REP guides promised,
    so a report that kept its own copy can replace it with a one-line re-export of this file.
*/
const { HttpError } = require('./http');

const DAY_MS = 86400000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const COMPARE_VALUES = ['previous', 'lastyear', 'none'];
const GROUP_VALUES = ['day', 'week', 'month'];
const MAX_DAYS = 400;          // longest range a report accepts
const AUTO_WEEK_AFTER = 92;    // day buckets over a longer range are switched to week buckets

// ---------- plain dates ----------

// true only for a real calendar date written as YYYY-MM-DD ('2026-02-30' is not)
function isRealDate(text) {
  if (typeof text !== 'string' || !DAY_RE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

const toMs = (text) => Date.parse(`${text}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

// the date n days after (or before, when n is negative)
function addDays(text, n) {
  return fromMs(toMs(text) + n * DAY_MS);
}

// how many days the range covers, both ends included (2026-11-01 to 2026-11-01 is 1 day)
function daysInRange(from, to) {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

// A Date, an ISO string or a 'YYYY-MM-DD' string -> 'YYYY-MM-DD' (what SQL DATE columns turn into)
function dayKey(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// ---------- comparison periods ----------

// The period of equal length immediately before `from`.
//   previousPeriod('2026-11-01', '2026-11-30') -> { from: '2026-10-02', to: '2026-10-31' }
function previousPeriod(from, to) {
  const days = daysInRange(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

// the same calendar date one year earlier (29 February becomes 28 February)
function yearBefore(text) {
  const [y, m, d] = text.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(y - 1).padStart(4, '0')}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

// The same dates one year earlier.
//   lastYearPeriod('2026-11-01', '2026-11-30') -> { from: '2025-11-01', to: '2025-11-30' }
function lastYearPeriod(from, to) {
  return { from: yearBefore(from), to: yearBefore(to) };
}

// compare = 'previous' | 'lastyear' | 'none'  ->  { from, to } or null (no comparison)
function comparisonPeriod(from, to, compare = 'previous') {
  if (compare === 'none') return null;
  if (compare === 'lastyear') return lastYearPeriod(from, to);
  return previousPeriod(from, to);
}

// ---------- buckets (the points of a trend) ----------

// first day of the bucket that holds `text`: the day itself, its Monday, or the 1st of its month
function bucketStart(text, groupBy) {
  if (groupBy === 'month') return `${text.slice(0, 8)}01`;
  if (groupBy === 'week') {
    const weekday = new Date(`${text}T00:00:00Z`).getUTCDay();   // 0 = Sunday
    return addDays(text, -((weekday + 6) % 7));
  }
  return text;
}

// last day of the bucket that starts on `start`
function bucketEnd(start, groupBy) {
  if (groupBy === 'week') return addDays(start, 6);
  if (groupBy === 'month') {
    const [y, m] = start.split('-').map(Number);
    return fromMs(Date.UTC(y, m, 0));
  }
  return start;
}

// Every bucket between from and to, oldest first, with no gaps.
//   [{ key, label, from, to }]
//   key    the first day of the bucket ('2026-11-02' for the week starting Monday 2 November); this is
//          the value bucketSql() produces, so SQL rows and buckets line up
//   label  what to print on an axis: the date, or '2026-11' for a month
//   from/to  the days of the bucket that fall inside the range (the first and last bucket can be partial)
function buckets(from, to, groupBy = 'day') {
  const unit = GROUP_VALUES.includes(groupBy) ? groupBy : 'day';
  const out = [];
  let start = bucketStart(from, unit);
  while (start <= to) {
    const end = bucketEnd(start, unit);
    out.push({
      key: start,
      label: unit === 'month' ? start.slice(0, 7) : start,
      from: start < from ? from : start,
      to: end > to ? to : end,
    });
    start = addDays(end, 1);
  }
  return out;
}

// Merge SQL rows into a continuous series: one entry per bucket, zeros where nothing happened.
//   rows     [{ bucket: <date or 'YYYY-MM-DD'>, revenue: 12.5, orders: 2 }, ...]
//   keyField the column holding the bucket start ('bucket')
//   fields   the numeric columns to carry over (missing ones become 0)
function fillSeries(bucketList, rows, keyField, fields) {
  const byKey = new Map();
  for (const row of rows || []) byKey.set(dayKey(row[keyField]), row);
  return bucketList.map((b) => {
    const row = byKey.get(b.key);
    const point = { key: b.key, label: b.label, from: b.from, to: b.to };
    for (const f of fields) point[f] = row && row[f] != null ? Number(row[f]) : 0;
    return point;
  });
}

// T-SQL that turns a date column into the same bucket key (a DATE) that buckets() uses.
// Weeks start on Monday whatever SET DATEFIRST says: 1900-01-01 was a Monday.
// `column` must be a plain column name such as s.Transaction_date (it is put into the SQL text).
function bucketSql(column, groupBy = 'day') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error(`bucketSql: "${column}" is not a column name.`);
  }
  const d = `CAST(${column} AS DATE)`;
  if (groupBy === 'month') return `DATEFROMPARTS(YEAR(${column}), MONTH(${column}), 1)`;
  if (groupBy === 'week') return `DATEADD(DAY, -(DATEDIFF(DAY, '19000101', ${d}) % 7), ${d})`;
  return d;
}

// day buckets over a long range are too many points: use weeks instead
function resolveGroupBy(from, to, groupBy = 'day') {
  const asked = GROUP_VALUES.includes(groupBy) ? groupBy : 'day';
  if (asked === 'day' && daysInRange(from, to) > AUTO_WEEK_AFTER) {
    return { groupBy: 'week', groupByUsed: 'week', groupByChanged: true };
  }
  return { groupBy: asked, groupByUsed: asked, groupByChanged: false };
}

// ---------- reading the query string ----------

// Check from, to, compare and groupBy exactly the way every report guide asks.
// Returns { from, to, days, compare, groupBy, groupByUsed, groupByChanged, previous }
//   previous is { from, to } for the comparison period, or null when compare is 'none'.
// Throws HttpError(400) for anything wrong. `today` can be passed in for tests.
function parsePeriod(query, { today = new Date(), defaultDays = 30, maxDays = MAX_DAYS } = {}) {
  const q = query || {};
  const todayText = dayKey(today);
  const to = q.to || todayText;
  const from = q.from || addDays(to, -(defaultDays - 1));
  const bad = rangeError(from, to, maxDays);
  if (bad) throw new HttpError(400, bad);

  const compare = q.compare == null || q.compare === '' ? 'previous' : q.compare;
  if (!COMPARE_VALUES.includes(compare)) throw new HttpError(400, 'compare must be previous, lastyear or none.');
  const asked = q.groupBy == null || q.groupBy === '' ? 'day' : q.groupBy;
  if (!GROUP_VALUES.includes(asked)) throw new HttpError(400, 'groupBy must be day, week or month.');

  return {
    from, to, days: daysInRange(from, to), compare,
    ...resolveGroupBy(from, to, asked),
    previous: comparisonPeriod(from, to, compare),
  };
}

// the message for a bad range, or null when the range is fine
function rangeError(from, to, maxDays = MAX_DAYS) {
  if (!isRealDate(from) || !isRealDate(to)) return 'Dates must look like 2026-10-31.';
  if (from > to) return 'The start date cannot be after the end date.';
  if (daysInRange(from, to) > maxDays) return `The date range cannot be longer than ${maxDays} days.`;
  return null;
}

// ---------- changes between two numbers ----------

// How much `current` moved from `previous`, in percent. null when there is nothing to compare with
// (no previous value, or previous is 0: a percentage of zero means nothing).
function percentChange(current, previous) {
  if (current == null || previous == null) return null;
  const c = Number(current);
  const p = Number(previous);
  if (Number.isNaN(c) || Number.isNaN(p) || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

// Difference in plain units (percentage points for a rate). null when either side is missing.
function pointChange(current, previous) {
  if (current == null || previous == null) return null;
  const c = Number(current);
  const p = Number(previous);
  if (Number.isNaN(c) || Number.isNaN(p)) return null;
  return c - p;
}

module.exports = {
  COMPARE_VALUES, GROUP_VALUES, MAX_DAYS,
  isRealDate, addDays, daysInRange, dayKey,
  previousPeriod, lastYearPeriod, comparisonPeriod,
  bucketStart, buckets, fillSeries, bucketSql, resolveGroupBy,
  parsePeriod, rangeError,
  percentChange, pointChange,
};
