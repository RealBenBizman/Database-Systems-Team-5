// src/shared/reportFormat.js: wording, scales, presets, URL and CSV helpers used by every report page.
const { loadEsm } = require('./helpers_esm');
const f = loadEsm('src/shared/reportFormat.js');

describe('numbers', () => {
  test('formatMoney', () => {
    expect(f.formatMoney(1234.5)).toBe('$1,234.50');
    expect(f.formatMoney(0)).toBe('$0.00');
    expect(f.formatMoney(null)).toBe('-');
    expect(f.formatMoney(12900, { compact: true })).toBe('$12.9K');
    expect(f.formatMoney(950, { compact: true })).toBe('$950.00');
    expect(f.formatMoney(-25000, { compact: true })).toBe('-$25K');
  });
  test('formatNumber and formatPercent', () => {
    expect(f.formatNumber(1234567)).toBe('1,234,567');
    expect(f.formatNumber(undefined)).toBe('-');
    expect(f.formatPercent(12.345)).toBe('12.3%');
    expect(f.formatPercent(null)).toBe('-');
  });
  test('compactNumber', () => {
    expect(f.compactNumber(1250)).toBe('1,250');
    expect(f.compactNumber(12900)).toBe('12.9K');
    expect(f.compactNumber(4200000)).toBe('4.2M');
  });
  test('dates for axes', () => {
    expect(f.shortDate('2026-11-04')).toBe('Nov 4');
    expect(f.shortDate('2026-11-04T10:00:00Z', true)).toBe('Nov 4, 2026');
    expect(f.shortDate(null)).toBe('');
    expect(f.bucketLabel('2026-11', 'month')).toBe('Nov 2026');
    expect(f.bucketLabel('2026-11-02', 'week')).toBe('Nov 2');
  });
});

describe('changeInfo', () => {
  test('percent: up is good for revenue', () => {
    expect(f.changeInfo({ current: 112.3, previous: 100 })).toEqual({
      direction: 'up', tone: 'good', arrow: '▲', text: 'Up 12.3% on the previous period',
    });
  });
  test('colour follows meaning: a falling refund rate is good, a rising one is bad', () => {
    expect(f.changeInfo({ current: 4, previous: 6, goodWhen: 'down' })).toMatchObject({ direction: 'down', tone: 'good' });
    expect(f.changeInfo({ current: 8, previous: 6, goodWhen: 'down' })).toMatchObject({ direction: 'up', tone: 'bad' });
  });
  test('neutral metrics never get a good or bad colour', () => {
    expect(f.changeInfo({ current: 8, previous: 6, goodWhen: 'neutral' }).tone).toBe('neutral');
  });
  test('the words say last year when that is the comparison', () => {
    expect(f.changeInfo({ current: 50, previous: 100, compare: 'lastyear' }).text).toBe('Down 50.0% on the same period last year');
  });
  test('absolute change in points and days', () => {
    expect(f.changeInfo({ current: 42.5, previous: 40, kind: 'absolute', unit: 'points' }).text).toBe('Up 2.5 points on the previous period');
    expect(f.changeInfo({ current: 5, previous: 8, kind: 'absolute', unit: 'days', goodWhen: 'down' }))
      .toMatchObject({ text: 'Down 3 days on the previous period', tone: 'good' });
  });
  test('flat when nothing moved', () => {
    expect(f.changeInfo({ current: 100, previous: 100 })).toMatchObject({ direction: 'flat', tone: 'neutral' });
    expect(f.changeInfo({ current: 0, previous: 0 }).direction).toBe('flat');
  });
  test('no comparison data', () => {
    expect(f.changeInfo({ current: 5, previous: null })).toMatchObject({ direction: 'none', text: 'No data to compare with' });
    expect(f.changeInfo({ current: null, previous: 5 }).direction).toBe('none');
  });
  test('previous of zero is "new", never a percent of zero', () => {
    const c = f.changeInfo({ current: 5, previous: 0 });
    expect(c.text).toMatch(/^New:/);
    expect(c.tone).toBe('neutral');
  });
});

describe('niceScale', () => {
  test('rounds the maximum up to a clean number', () => {
    expect(f.niceScale(87)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(f.niceScale(1234).max).toBe(1500);
    expect(f.niceScale(9)).toEqual({ max: 10, ticks: [0, 2.5, 5, 7.5, 10] });
    expect(f.niceScale(4).ticks).toEqual([0, 1, 2, 3, 4]);
  });
  test('zero or bad data still gives a usable axis', () => {
    expect(f.niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(f.niceScale(NaN).ticks).toEqual([0, 1]);
  });
  test('the top tick is never below the data', () => {
    for (const v of [0.3, 1, 7, 99, 100, 101, 5555, 123456]) expect(f.niceScale(v).max).toBeGreaterThanOrEqual(v);
  });
  test('signed scale includes zero and the negatives', () => {
    const s = f.niceScaleSigned(-30, 90);
    expect(s.min).toBeLessThanOrEqual(-30);
    expect(s.max).toBeGreaterThanOrEqual(90);
    expect(s.ticks).toContain(0);
    const flat = f.niceScaleSigned(0, 50);
    expect(flat.min).toBe(0);
    expect(flat.max).toBeGreaterThanOrEqual(50);
  });
});

describe('presets', () => {
  const today = new Date('2026-11-10T12:00:00Z');   // a Tuesday
  test('each preset', () => {
    expect(f.presetRange('last7', today)).toEqual({ from: '2026-11-04', to: '2026-11-10' });
    expect(f.presetRange('last30', today)).toEqual({ from: '2026-10-12', to: '2026-11-10' });
    expect(f.presetRange('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-10' });
    expect(f.presetRange('quarter', today)).toEqual({ from: '2026-10-01', to: '2026-11-10' });
    expect(f.presetRange('ytd', today)).toEqual({ from: '2026-01-01', to: '2026-11-10' });
  });
  test('accepts a date string and crosses a month end', () => {
    expect(f.presetRange('last7', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  });
  test('activePreset finds the matching button', () => {
    expect(f.activePreset('2026-11-01', '2026-11-10', today)).toBe('month');
    expect(f.activePreset('2026-10-12', '2026-11-10', today)).toBe('last30');
    expect(f.activePreset('2026-11-02', '2026-11-10', today)).toBeNull();
  });
});

describe('rangeProblem', () => {
  test('a good range has no problem', () => {
    expect(f.rangeProblem('2026-10-01', '2026-10-31')).toBe('');
    expect(f.rangeProblem('2026-10-01', '2026-10-01')).toBe('');
  });
  test('says what is wrong', () => {
    expect(f.rangeProblem('', '2026-10-31')).toMatch(/Pick a start and an end date/);
    expect(f.rangeProblem('2026-11-01', '2026-10-31')).toMatch(/cannot be after/);
    expect(f.rangeProblem('2025-01-01', '2026-10-31')).toMatch(/at most 400 days/);
    expect(f.rangeProblem('2025-10-07', '2026-11-10')).toBe('');
  });
});

describe('filters in the URL', () => {
  const defaults = { from: '2026-10-12', to: '2026-11-10', compare: 'previous', category: '' };
  test('readFilters fills in defaults and ignores unknown keys', () => {
    const p = new URLSearchParams('compare=lastyear&evil=1&category=');
    expect(f.readFilters(p, defaults)).toEqual({ from: '2026-10-12', to: '2026-11-10', compare: 'lastyear', category: '' });
  });
  test('writeFilters leaves defaults out', () => {
    const p = f.writeFilters({ ...defaults, compare: 'none', category: '3' }, defaults);
    expect(p.toString()).toBe('compare=none&category=3');
  });
  test('writeFilters keeps unrelated parameters from `extra`', () => {
    const p = f.writeFilters({ ...defaults, compare: 'none' }, defaults, 'tab=2');
    expect(p.get('tab')).toBe('2');
    expect(p.get('compare')).toBe('none');
  });
  test('a round trip returns the same filters', () => {
    const filters = { from: '2026-01-01', to: '2026-02-01', compare: 'none', category: '7' };
    expect(f.readFilters(f.writeFilters(filters, defaults), defaults)).toEqual(filters);
  });
});

describe('CSV', () => {
  test('quotes commas, quotes and new lines', () => {
    expect(f.csvCell('a,b')).toBe('"a,b"');
    expect(f.csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(f.csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(f.csvCell(null)).toBe('');
    expect(f.csvCell(12.5)).toBe('12.5');
  });
  test('text that looks like a spreadsheet formula is defused, numbers are not', () => {
    expect(f.csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(f.csvCell('@cmd')).toBe("'@cmd");
    expect(f.csvCell(-5)).toBe('-5');
    expect(f.csvCell('-5')).toBe('-5');
  });
  test('toCsv writes a header row and one line per row', () => {
    const csv = f.toCsv([{ label: 'Name', value: (r) => r.n }, { label: 'Units', value: (r) => r.u }], [{ n: 'Zelda, HD', u: 3 }, { n: 'Mario', u: 0 }]);
    expect(csv).toBe('Name,Units\r\n"Zelda, HD",3\r\nMario,0\r\n');
  });
});
