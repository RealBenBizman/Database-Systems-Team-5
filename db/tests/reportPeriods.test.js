// lib/reportPeriods.js: the date maths every report shares. Pure functions, no database.
const rp = require('../lib/reportPeriods');

describe('plain dates', () => {
  test('isRealDate accepts real dates only', () => {
    expect(rp.isRealDate('2026-11-04')).toBe(true);
    expect(rp.isRealDate('2024-02-29')).toBe(true);
    expect(rp.isRealDate('2026-02-29')).toBe(false);
    expect(rp.isRealDate('2026-99-99')).toBe(false);
    expect(rp.isRealDate('2026-1-4')).toBe(false);
    expect(rp.isRealDate(undefined)).toBe(false);
    expect(rp.isRealDate(20261104)).toBe(false);
  });

  test('addDays and daysInRange cross month and year ends', () => {
    expect(rp.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(rp.addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(rp.daysInRange('2026-11-01', '2026-11-01')).toBe(1);
    expect(rp.daysInRange('2026-11-01', '2026-11-30')).toBe(30);
    expect(rp.daysInRange('2026-12-25', '2027-01-05')).toBe(12);
  });

  test('dayKey turns SQL dates and ISO strings into YYYY-MM-DD', () => {
    expect(rp.dayKey(new Date('2026-11-04T00:00:00.000Z'))).toBe('2026-11-04');
    expect(rp.dayKey('2026-11-04T09:30:00.000Z')).toBe('2026-11-04');
    expect(rp.dayKey(null)).toBeNull();
    expect(rp.dayKey(new Date('nope'))).toBeNull();
  });
});

describe('comparison periods', () => {
  test('previousPeriod is the same number of days just before from', () => {
    expect(rp.previousPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(rp.previousPeriod('2026-11-04', '2026-11-04')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(rp.previousPeriod('2027-01-01', '2027-01-10')).toEqual({ from: '2026-12-22', to: '2026-12-31' });
  });

  test('lastYearPeriod keeps the dates and moves them a year back', () => {
    expect(rp.lastYearPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2025-11-01', to: '2025-11-30' });
  });

  test('lastYearPeriod turns 29 February into 28 February', () => {
    expect(rp.lastYearPeriod('2024-02-29', '2024-03-05')).toEqual({ from: '2023-02-28', to: '2023-03-05' });
    expect(rp.lastYearPeriod('2024-02-01', '2024-02-29')).toEqual({ from: '2023-02-01', to: '2023-02-28' });
  });

  test('comparisonPeriod picks the right one, and none gives null', () => {
    expect(rp.comparisonPeriod('2026-11-01', '2026-11-30', 'previous').to).toBe('2026-10-31');
    expect(rp.comparisonPeriod('2026-11-01', '2026-11-30', 'lastyear').to).toBe('2025-11-30');
    expect(rp.comparisonPeriod('2026-11-01', '2026-11-30', 'none')).toBeNull();
    expect(rp.comparisonPeriod('2026-11-01', '2026-11-30')).toEqual(rp.previousPeriod('2026-11-01', '2026-11-30'));
  });
});

describe('buckets', () => {
  test('day buckets are one per day', () => {
    const b = rp.buckets('2026-11-01', '2026-11-03', 'day');
    expect(b.map((x) => x.key)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(b[1]).toEqual({ key: '2026-11-02', label: '2026-11-02', from: '2026-11-02', to: '2026-11-02' });
  });

  test('weeks start on Monday and the ends are clipped to the range', () => {
    // 2026-11-04 is a Wednesday; Monday of that week is 2026-11-02
    const b = rp.buckets('2026-11-04', '2026-11-17', 'week');
    expect(b.map((x) => x.key)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(b[0].from).toBe('2026-11-04');
    expect(b[0].to).toBe('2026-11-08');
    expect(b[1]).toMatchObject({ from: '2026-11-09', to: '2026-11-15' });
    expect(b[2]).toMatchObject({ from: '2026-11-16', to: '2026-11-17' });
  });

  test('a Sunday belongs to the week that started the Monday before', () => {
    expect(rp.bucketStart('2026-11-08', 'week')).toBe('2026-11-02');
    expect(rp.bucketStart('2026-11-09', 'week')).toBe('2026-11-09');
  });

  test('month buckets start on the 1st and handle February and year ends', () => {
    const b = rp.buckets('2027-01-15', '2027-03-10', 'month');
    expect(b.map((x) => x.key)).toEqual(['2027-01-01', '2027-02-01', '2027-03-01']);
    expect(b.map((x) => x.label)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(b[0]).toMatchObject({ from: '2027-01-15', to: '2027-01-31' });
    expect(b[1]).toMatchObject({ from: '2027-02-01', to: '2027-02-28' });
    expect(b[2]).toMatchObject({ from: '2027-03-01', to: '2027-03-10' });
    expect(rp.buckets('2028-02-10', '2028-03-01', 'month')[0].to).toBe('2028-02-29');
  });

  test('an unknown groupBy falls back to days', () => {
    expect(rp.buckets('2026-11-01', '2026-11-02', 'year')).toHaveLength(2);
  });

  test('every day of the range is in exactly one bucket', () => {
    for (const unit of ['day', 'week', 'month']) {
      const list = rp.buckets('2026-01-03', '2026-12-30', unit);
      let covered = 0;
      for (let i = 0; i < list.length; i++) {
        covered += rp.daysInRange(list[i].from, list[i].to);
        if (i > 0) expect(list[i].from).toBe(rp.addDays(list[i - 1].to, 1));
      }
      expect(covered).toBe(rp.daysInRange('2026-01-03', '2026-12-30'));
    }
  });

  test('fillSeries puts rows into their buckets and fills the gaps with zeros', () => {
    const list = rp.buckets('2026-11-02', '2026-11-22', 'week');
    const rows = [
      { bucket: new Date('2026-11-02T00:00:00Z'), revenue: '10.5', orders: 2 },
      { bucket: '2026-11-16', revenue: 4, orders: null },
    ];
    const series = rp.fillSeries(list, rows, 'bucket', ['revenue', 'orders']);
    expect(series.map((p) => [p.key, p.revenue, p.orders])).toEqual([
      ['2026-11-02', 10.5, 2],
      ['2026-11-09', 0, 0],
      ['2026-11-16', 4, 0],
    ]);
  });
});

describe('bucketSql', () => {
  test('builds the day, week and month expressions', () => {
    expect(rp.bucketSql('s.Transaction_date', 'day')).toBe('CAST(s.Transaction_date AS DATE)');
    expect(rp.bucketSql('s.Transaction_date', 'month')).toBe('DATEFROMPARTS(YEAR(s.Transaction_date), MONTH(s.Transaction_date), 1)');
    const week = rp.bucketSql('s.Transaction_date', 'week');
    expect(week).toContain("DATEDIFF(DAY, '19000101'");
    expect(week).toContain('% 7');
  });

  test('refuses anything that is not a column name', () => {
    expect(() => rp.bucketSql('1; DROP TABLE PRODUCT', 'day')).toThrow();
    expect(() => rp.bucketSql('a.b.c', 'day')).toThrow();
    expect(() => rp.bucketSql("x') --", 'week')).toThrow();
  });

  test('1900-01-01 really was a Monday (the week formula depends on it)', () => {
    expect(new Date('1900-01-01T00:00:00Z').getUTCDay()).toBe(1);
  });
});

describe('resolveGroupBy', () => {
  test('keeps days up to 92 days and switches to weeks beyond', () => {
    expect(rp.resolveGroupBy('2026-01-01', '2026-04-02', 'day')).toEqual({ groupBy: 'day', groupByUsed: 'day', groupByChanged: false }); // 92 days
    expect(rp.resolveGroupBy('2026-01-01', '2026-04-03', 'day')).toEqual({ groupBy: 'week', groupByUsed: 'week', groupByChanged: true }); // 93 days
  });
  test('weeks and months are never changed', () => {
    expect(rp.resolveGroupBy('2025-01-01', '2026-01-01', 'month').groupBy).toBe('month');
    expect(rp.resolveGroupBy('2025-01-01', '2026-01-01', 'week').groupByChanged).toBe(false);
  });
});

describe('parsePeriod', () => {
  const today = new Date('2026-11-10T15:00:00Z');

  test('no parameters: the last 30 days ending today, compared with the 30 before', () => {
    const p = rp.parsePeriod({}, { today });
    expect(p).toMatchObject({ from: '2026-10-12', to: '2026-11-10', days: 30, compare: 'previous', groupBy: 'day', groupByUsed: 'day', groupByChanged: false });
    expect(p.previous).toEqual({ from: '2026-09-12', to: '2026-10-11' });
  });

  test('echoes valid parameters and builds the comparison', () => {
    const p = rp.parsePeriod({ from: '2026-10-01', to: '2026-10-31', compare: 'lastyear', groupBy: 'week' }, { today });
    expect(p).toMatchObject({ from: '2026-10-01', to: '2026-10-31', days: 31, compare: 'lastyear', groupBy: 'week' });
    expect(p.previous).toEqual({ from: '2025-10-01', to: '2025-10-31' });
  });

  test('compare none gives no previous period', () => {
    expect(rp.parsePeriod({ compare: 'none' }, { today }).previous).toBeNull();
  });

  test('a long range with day buckets switches to weeks and says so', () => {
    const p = rp.parsePeriod({ from: '2026-01-01', to: '2026-06-30', groupBy: 'day' }, { today });
    expect(p.groupBy).toBe('week');
    expect(p.groupByUsed).toBe('week');
    expect(p.groupByChanged).toBe(true);
  });

  test.each([
    [{ from: '2026-02-30', to: '2026-03-01' }, /Dates must look like/],
    [{ from: 'yesterday' }, /Dates must look like/],
    [{ from: '2026-11-05', to: '2026-11-01' }, /start date cannot be after/],
    [{ from: '2025-01-01', to: '2026-11-01' }, /longer than 400 days/],
    [{ compare: 'yearly' }, /compare must be/],
    [{ groupBy: 'hour' }, /groupBy must be/],
  ])('%j is refused with a 400', (query, message) => {
    let error;
    try { rp.parsePeriod(query, { today }); } catch (e) { error = e; }
    expect(error).toBeDefined();
    expect(error.status || error.statusCode).toBe(400);
    expect(error.message).toMatch(message);
  });

  test('exactly 400 days is allowed, 401 is not', () => {
    expect(() => rp.parsePeriod({ from: '2025-10-07', to: '2026-11-10' }, { today })).not.toThrow(); // 400 days
    expect(() => rp.parsePeriod({ from: '2025-10-06', to: '2026-11-10' }, { today })).toThrow();     // 401 days
  });
});

describe('changes', () => {
  test('percentChange', () => {
    expect(rp.percentChange(110, 100)).toBeCloseTo(10);
    expect(rp.percentChange(50, 100)).toBeCloseTo(-50);
    expect(rp.percentChange(5, 0)).toBeNull();
    expect(rp.percentChange(5, null)).toBeNull();
    expect(rp.percentChange(null, 5)).toBeNull();
    expect(rp.percentChange(-50, -100)).toBeCloseTo(50);
  });

  test('pointChange', () => {
    expect(rp.pointChange(12.5, 10)).toBeCloseTo(2.5);
    expect(rp.pointChange(0, 4)).toBe(-4);
    expect(rp.pointChange(null, 4)).toBeNull();
  });
});
