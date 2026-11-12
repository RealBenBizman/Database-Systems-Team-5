// Plain helpers shared by every report page (REP-7). No React in here, so they are easy to test
// (tests/reportFormat.test.js). The components that use them are in reports.jsx and charts.jsx.

// ---------- numbers ----------

const isNum = (n) => n !== null && n !== undefined && n !== '' && !Number.isNaN(Number(n));

export function formatNumber(n) {
  return isNum(n) ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '-';
}

export function formatMoney(n, { compact = false } = {}) {
  if (!isNum(n)) return '-';
  const v = Number(n);
  if (compact && Math.abs(v) >= 10000) return `${v < 0 ? '-' : ''}$${compactNumber(Math.abs(v))}`;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// A value that is already a percent (12.5 -> '12.5%')
export function formatPercent(n, digits = 1) {
  return isNum(n) ? `${Number(n).toFixed(digits)}%` : '-';
}

// 1,250 -> '1,250'   12,900 -> '12.9K'   4,200,000 -> '4.2M'
export function compactNumber(n) {
  const v = Math.abs(Number(n));
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e6) return `${sign}${trim(v / 1e6)}M`;
  if (v >= 1e4) return `${sign}${trim(v / 1e3)}K`;
  return `${sign}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
const trim = (x) => String(Math.round(x * 10) / 10);

// 'YYYY-MM-DD' (or a SQL date) -> 'Nov 4' (or 'Nov 4, 2026' when withYear)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(value, withYear = false) {
  if (!value) return '';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(value);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

// Bucket label for an axis: a day or a week start as 'Nov 4', a month as 'Nov 2026'.
export function bucketLabel(label, groupBy) {
  if (groupBy === 'month') {
    const [y, m] = String(label).split('-').map(Number);
    return y && m ? `${MONTHS[m - 1]} ${y}` : String(label);
  }
  return shortDate(label);
}

// ---------- changes between periods ----------

export function compareLabel(compare) {
  if (compare === 'lastyear') return 'the same period last year';
  return 'the previous period';
}

/*
  The words, arrow and colour for "how did this move?".
    current, previous   the two values (previous may be null or 0)
    kind                'percent'  -> "Up 12.3%"   (relative change)
                        'absolute' -> "Up 3 days"  (difference in the unit given, e.g. 'points' for a rate)
    goodWhen            'up' | 'down' | 'neutral'  which way is good news (a falling refund rate is good)
    compare             'previous' | 'lastyear'    only used for the wording
    unit                text after an absolute change ('points', 'days')
  Returns { direction: 'up'|'down'|'flat'|'none', tone: 'good'|'bad'|'neutral', arrow, text }.
  The colour (tone) follows the meaning, never the sign, and the words are always there.
*/
export function changeInfo({ current, previous, kind = 'percent', goodWhen = 'up', compare = 'previous', unit = '' }) {
  const basis = compareLabel(compare);
  if (!isNum(current) || !isNum(previous)) {
    return { direction: 'none', tone: 'neutral', arrow: '', text: 'No data to compare with' };
  }
  const c = Number(current);
  const p = Number(previous);
  const diff = c - p;
  let shown;          // the number printed after Up/Down
  let isFlat;
  if (kind === 'percent') {
    if (p === 0) {
      if (c === 0) return { direction: 'flat', tone: 'neutral', arrow: '=', text: `No change on ${basis}` };
      return { direction: c > 0 ? 'up' : 'down', tone: 'neutral', arrow: c > 0 ? '▲' : '▼', text: `New: nothing to compare with in ${basis}` };
    }
    const pct = (diff / Math.abs(p)) * 100;
    shown = `${Math.abs(pct).toFixed(1)}%`;
    isFlat = Math.abs(pct) < 0.05;
  } else {
    const digits = Math.abs(diff) >= 10 || Number.isInteger(diff) ? 0 : 1;
    shown = `${Math.abs(diff).toFixed(digits)}${unit ? ` ${unit}` : ''}`;
    isFlat = Math.abs(diff) < (digits === 0 ? 0.5 : 0.05);
  }
  if (isFlat) return { direction: 'flat', tone: 'neutral', arrow: '=', text: `No change on ${basis}` };
  const direction = diff > 0 ? 'up' : 'down';
  let tone = 'neutral';
  if (goodWhen === 'up') tone = direction === 'up' ? 'good' : 'bad';
  if (goodWhen === 'down') tone = direction === 'down' ? 'good' : 'bad';
  return {
    direction, tone,
    arrow: direction === 'up' ? '▲' : '▼',
    text: `${direction === 'up' ? 'Up' : 'Down'} ${shown} on ${basis}`,
  };
}

// ---------- chart scales ----------

// A round maximum and tick values for an axis that starts at 0: niceScale(87) -> { max: 100, ticks: [0, 25, 50, 75, 100] }
export function niceScale(maxValue, wanted = 4) {
  const max = Number(maxValue);
  if (!Number.isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] };
  const rough = max / wanted;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

// Like niceScale, for data that can go below zero. Returns { min, max, ticks }.
export function niceScaleSigned(minValue, maxValue, wanted = 4) {
  if (Number(minValue) >= 0) return { min: 0, ...niceScale(maxValue, wanted) };
  const hi = Math.max(Number(maxValue), 0);
  const lo = Math.abs(Number(minValue));
  const span = hi + lo;
  const rough = span / wanted;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  const min = -Math.ceil(lo / step) * step;
  const max = Math.max(Math.ceil(hi / step) * step, step);
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min, max, ticks };
}

// ---------- date presets and the URL ----------

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const PRESETS = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'ytd', label: 'Year to date' },
];

// { from, to } for a preset button. `today` is a Date or 'YYYY-MM-DD'.
export function presetRange(id, today = new Date()) {
  const t = typeof today === 'string' ? new Date(`${today}T00:00:00Z`) : today;
  const to = ymd(t);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const shift = (days) => ymd(new Date(Date.UTC(y, m, t.getUTCDate() - days)));
  switch (id) {
    case 'last7': return { from: shift(6), to };
    case 'month': return { from: `${y}-${pad(m + 1)}-01`, to };
    case 'quarter': return { from: `${y}-${pad(Math.floor(m / 3) * 3 + 1)}-01`, to };
    case 'ytd': return { from: `${y}-01-01`, to };
    case 'last30':
    default: return { from: shift(29), to };
  }
}

// which preset (if any) the current dates match, so its button can look pressed
export function activePreset(from, to, today = new Date()) {
  const found = PRESETS.find((p) => {
    const r = presetRange(p.id, today);
    return r.from === from && r.to === to;
  });
  return found ? found.id : null;
}

// The reason a date range cannot be reported on, or '' when it is fine. Pages call this before they
// fetch, so a half-typed range never reaches the server.
export function rangeProblem(from, to, maxDays = 400) {
  const ok = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '') && !Number.isNaN(Date.parse(`${t}T00:00:00Z`));
  if (!ok(from) || !ok(to)) return 'Pick a start and an end date.';
  if (from > to) return 'The start date cannot be after the end date.';
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > maxDays) return `Pick at most ${maxDays} days.`;
  return '';
}

// URL query -> filters. Only the keys in `defaults` are read; a missing key takes its default.
export function readFilters(params, defaults) {
  const out = {};
  for (const key of Object.keys(defaults)) {
    const v = params.get(key);
    out[key] = v === null || v === '' ? defaults[key] : v;
  }
  return out;
}

// filters -> URL query. A value equal to its default is left out, so a shared link stays short.
export function writeFilters(filters, defaults, extra) {
  const params = new URLSearchParams(extra || '');
  for (const key of Object.keys(defaults)) {
    const v = filters[key];
    if (v === undefined || v === null || v === '' || String(v) === String(defaults[key])) params.delete(key);
    else params.set(key, String(v));
  }
  return params;
}

// ---------- CSV ----------

// One CSV cell. Text that starts with = + - @ would be read as a formula by Excel, so it gets a ' in front.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ label, value(row) }]  rows: the rows to write
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
