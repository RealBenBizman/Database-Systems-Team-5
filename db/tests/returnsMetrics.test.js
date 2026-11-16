// Returns report (REP-4): every number and sentence the page shows, from src/app/pages/reports/returnsMetrics.js.
const { loadEsm } = require('./helpers_esm');

const m = loadEsm('src/app/pages/reports/returnsMetrics.js');

// returns as the endpoint sends them (the page's own sample, small enough to add up by hand)
const base = { customerName: 'Test Customer', daysSinceSale: 5, soldAt: '2026-10-01T10:00:00.000Z' };
const records = [
  { ...base, id: 1, orderId: 11, status: 'refunded', reason: 'Defective or damaged', refundTotal: 30, requestedAt: '2026-08-10T10:00:00.000Z', refundedAt: '2026-08-12T10:00:00.000Z', daysOpen: 2,
    items: [{ productId: 7, name: 'Forza Used', category: 'Video Games', quantity: 1, refundAmount: 30 }] },
  { ...base, id: 2, orderId: 12, status: 'refunded', reason: 'Wrong item received', refundTotal: 25.5, requestedAt: '2026-09-01T10:00:00.000Z', refundedAt: '2026-09-11T10:00:00.000Z', daysOpen: 10,
    items: [{ productId: 7, name: 'Forza Used', category: 'Video Games', quantity: 1, refundAmount: 25.5 }] },
  { ...base, id: 3, orderId: 13, status: 'approved', reason: 'Not as described', refundTotal: 40, requestedAt: '2026-09-20T10:00:00.000Z', refundedAt: null, daysOpen: 6,
    items: [{ productId: 8, name: 'Headset', category: 'Accessories', quantity: 2, refundAmount: 40 }] },
  { ...base, id: 4, orderId: 14, status: 'requested', reason: 'Changed my mind', refundTotal: 12, requestedAt: '2026-10-05T10:00:00.000Z', refundedAt: null, daysOpen: 8,
    items: [{ productId: 9, name: 'Mug', category: 'Merchandise', quantity: 1, refundAmount: 12 }] },
  { ...base, id: 5, orderId: 15, status: 'requested', reason: 'Arrived damaged, the box was crushed', refundTotal: 30, requestedAt: '2026-10-25T10:00:00.000Z', refundedAt: null, daysOpen: 2,
    items: [{ productId: 7, name: 'Forza Used', category: 'Video Games', quantity: 1, refundAmount: 30 }] },
  { ...base, id: 6, orderId: 16, status: 'denied', reason: 'Other: found it cheaper somewhere else', refundTotal: 20, requestedAt: '2026-10-10T10:00:00.000Z', refundedAt: null, daysOpen: null,
    items: [{ productId: 9, name: 'Mug', category: 'Merchandise', quantity: 3, refundAmount: 20 }] },
];
const sold = [
  { productId: 7, name: 'Forza Used', category: 'Video Games', sold: 10 },
  { productId: 8, name: 'Headset', category: 'Accessories', sold: 20 },
  { productId: 9, name: 'Mug', category: 'Merchandise', sold: 30 },
  { productId: 10, name: 'Plush', category: 'Merchandise', sold: 40 },
];
const sales = { orders: 50, units: 100, revenue: 2000 };
const rows = m.prepare(records);
const summary = m.summarize(rows, sales);

describe('reasonGroup', () => {
  test.each([
    ['Defective or damaged', 'Defective or damaged'],
    ['Defective: stopped working after a few days', 'Defective or damaged'],
    ['Arrived damaged, the box was crushed', 'Defective or damaged'],
    ['It does not work', 'Defective or damaged'],
    ["Doesn't work", 'Defective or damaged'],
    ['Wrong item received', 'Wrong item'],
    ['They sent the wrong game', 'Wrong item'],
    ['Not as described', 'Not as described'],
    ['Changed my mind', 'Changed my mind'],
    ["Don't like the game", 'Changed my mind'],
    ['Other: the gift was a duplicate', 'Other'],
    ['Other: found it cheaper somewhere else', 'Other'],
    ['Too small', 'Changed my mind'],
    ['', 'Other'],
    [null, 'Other'],
    ['Something nobody expected', 'Other'],
  ])('%s -> %s', (text, group) => {
    expect(m.reasonGroup(text)).toBe(group);
  });

  test('every group the function can return is in REASON_GROUPS', () => {
    const seen = new Set(records.map((r) => m.reasonGroup(r.reason)));
    seen.forEach((g) => expect(m.REASON_GROUPS).toContain(g));
  });
});

describe('prepare and filterRows', () => {
  test('adds units, counted units, cash, group and text', () => {
    const second = rows.find((r) => r.id === 3);
    expect(second).toMatchObject({ units: 2, countedUnits: 2, refundValue: 40, refundedCash: 0, reasonGroup: 'Not as described', day: '2026-09-20', productsText: 'Headset x2' });
    const denied = rows.find((r) => r.id === 6);
    expect(denied).toMatchObject({ units: 3, countedUnits: 0, refundedCash: 0 });
    expect(rows.find((r) => r.id === 1).refundedCash).toBe(30);
  });

  test('a missing list gives an empty list', () => {
    expect(m.prepare(undefined)).toEqual([]);
  });

  test('filters by status, reason group and text, and they combine', () => {
    expect(m.filterRows(rows, { status: 'requested' }).map((r) => r.id)).toEqual([4, 5]);
    expect(m.filterRows(rows, { reason: 'Defective or damaged' }).map((r) => r.id)).toEqual([1, 5]);
    expect(m.filterRows(rows, { status: 'requested', reason: 'Defective or damaged' }).map((r) => r.id)).toEqual([5]);
    expect(m.filterRows(rows, { search: 'headset' }).map((r) => r.id)).toEqual([3]);
    expect(m.filterRows(rows, { search: '1001' })).toEqual([]);
    expect(m.filterRows(rows, { search: '15' }).map((r) => r.id)).toEqual([5]);        // order number 15
  });

  test('skipStatus leaves the status filter out (the four status cards)', () => {
    expect(m.filterRows(rows, { status: 'denied' }, { skipStatus: true })).toHaveLength(6);
  });
});

describe('summarize', () => {
  test('counts by status', () => {
    expect(summary).toMatchObject({ returns: 6, waiting: 2, approved: 1, refunded: 2, denied: 1, decided: 4 });
  });

  test('returned units leave out denied returns', () => {
    expect(summary.unitsReturned).toBe(1 + 1 + 2 + 1 + 1);       // 6; the denied return of 3 mugs does not count
    expect(summary.unitsSold).toBe(100);
    expect(summary.returnRate).toBeCloseTo(6, 5);
  });

  test('refunded cash counts only refunded returns, to the cent', () => {
    expect(summary.refundedCash).toBe(55.5);
    expect(summary.refundShare).toBeCloseTo((55.5 / 2000) * 100, 8);
    expect(summary.approvedAmount).toBe(40);
  });

  test('refund speed and waiting', () => {
    expect(summary.avgDaysToRefund).toBe(6);                          // (2 + 10) / 2
    expect(summary.slowRefunds).toBe(1);                              // the 10 day refund is over 7 days
    expect(summary.oldestWait).toBe(8);
    expect(summary.longWaits).toBe(1);                                // 8 days is over 3, 2 days is not
  });

  test('the denied share is of decided returns', () => {
    expect(summary.deniedShare).toBe(25);
  });

  test('no sales or no returns give null, not NaN or Infinity', () => {
    const empty = m.summarize([], { units: 0, revenue: 0 });
    expect(empty).toMatchObject({ returns: 0, returnRate: null, refundShare: null, avgDaysToRefund: null, oldestWait: null, deniedShare: null, refundedCash: 0 });
    expect(m.summarize(rows, null).returnRate).toBeNull();
  });

  test('cents never drift: 0.1 + 0.2 style sums are exact', () => {
    const two = m.prepare([
      { ...records[0], id: 91, refundTotal: 0.1 }, { ...records[0], id: 92, refundTotal: 0.2 },
    ]);
    expect(m.summarize(two, sales).refundedCash).toBe(0.3);
  });

  test('the table footer adds up to the cards (same rows feed both)', () => {
    expect(rows.reduce((s, r) => s + r.countedUnits, 0)).toBe(summary.unitsReturned);
    expect(rows.reduce((s, r) => s + Math.round(r.refundedCash * 100), 0) / 100).toBe(summary.refundedCash);
  });
});

describe('previousSummary', () => {
  test('turns the endpoint figures into the same numbers', () => {
    const before = m.previousSummary(
      { returns: { requested: 4, units: 5, refundedCash: 80, refunded: 2, denied: 1, decided: 3, avgDaysToRefund: 4.5 } },
      { units: 50, revenue: 1000 },
    );
    expect(before).toEqual({ returns: 4, unitsReturned: 5, unitsSold: 50, returnRate: 10, refundedCash: 80, refundShare: 8, avgDaysToRefund: 4.5, deniedShare: (1 / 3) * 100 });
  });
  test('null when there is no comparison', () => {
    expect(m.previousSummary(null, sales)).toBeNull();
    expect(m.previousSummary({ returns: null }, sales)).toBeNull();
  });
  test('nothing refunded before gives null days, not 0', () => {
    const before = m.previousSummary({ returns: { requested: 1, units: 1, refundedCash: 0, refunded: 0, denied: 0, decided: 0, avgDaysToRefund: null } }, { units: 10, revenue: 100 });
    expect(before.avgDaysToRefund).toBeNull();
    expect(before.deniedShare).toBeNull();
  });
});

describe('the tables', () => {
  test('byReason: groups, counts add up to the rows, most common first', () => {
    const list = m.byReason(rows);
    expect(list.map((r) => r.reason)).toEqual(['Defective or damaged', 'Changed my mind', 'Not as described', 'Other', 'Wrong item']);
    expect(list.reduce((s, r) => s + r.returns, 0)).toBe(rows.length);
    expect(list[0]).toMatchObject({ returns: 2, share: 33, units: 2, refundedCash: 30 });
    expect(list.find((r) => r.reason === 'Other')).toMatchObject({ returns: 1, units: 0 });   // the denied return
  });

  test('byProduct: units, rate, most returned first, denied units do not count', () => {
    const list = m.byProduct(rows, sold);
    expect(list.map((p) => p.name)).toEqual(['Forza Used', 'Headset', 'Mug']);
    expect(list[0]).toMatchObject({ returned: 3, sold: 10, returns: 3, refundedCash: 55.5 });
    expect(list[0].rate).toBeCloseTo(30, 8);
    expect(list.find((p) => p.name === 'Mug')).toMatchObject({ returned: 1, returns: 1 });     // 3 denied units left out
    expect(list.some((p) => p.name === 'Plush')).toBe(false);                                   // sold, never returned
  });

  test('byProduct: a product returned but not sold in the dates has no rate', () => {
    const list = m.byProduct(rows, []);
    expect(list[0].rate).toBeNull();
    expect(list[0].sold).toBe(0);
  });

  test('byCategory: lists categories that sold even with no returns', () => {
    const list = m.byCategory(rows, sold);
    const merch = list.find((c) => c.category === 'Merchandise');
    expect(merch).toMatchObject({ sold: 70, returned: 1 });
    expect(list.find((c) => c.category === 'Video Games')).toMatchObject({ sold: 10, returned: 3, refundedCash: 55.5 });
    expect(list.reduce((s, c) => s + c.returned, 0)).toBe(summary.unitsReturned);
  });

  test('byPeriod: one point per day for a short range, zeros where nothing was requested', () => {
    const t = m.byPeriod(rows, '2026-10-01', '2026-10-31');
    expect(t.by).toBe('day');
    expect(t.points).toHaveLength(31);
    expect(t.points.map((x) => x.label).slice(0, 2)).toEqual(['2026-10-01', '2026-10-02']);
    const day = (d) => t.points.find((x) => x.label === d);
    expect(day('2026-10-05')).toMatchObject({ returns: 1, units: 1 });
    expect(day('2026-10-10')).toMatchObject({ returns: 1, units: 0 });   // denied: counts as a return, not as units
    expect(day('2026-10-06')).toMatchObject({ returns: 0, units: 0 });
    // the returns of September and August are outside these dates
    expect(t.points.reduce((sum, x) => sum + x.returns, 0)).toBe(3);
  });

  test('byPeriod: weeks starting on Monday for a long range', () => {
    const t = m.byPeriod(rows, '2026-08-01', '2026-10-31');   // 92 days
    expect(t.by).toBe('week');
    expect(t.points[0].label).toBe('2026-07-27');            // the Monday of the week of Aug 1 (a Saturday)
    expect(t.points.every((x) => new Date(`${x.label}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(t.points.reduce((sum, x) => sum + x.returns, 0)).toBe(rows.length);
  });

  test('byPeriod: a bad range gives no points', () => {
    expect(m.byPeriod(rows, '2026-10-31', '2026-10-01').points).toEqual([]);
  });

  test('byMonth: oldest first, counts add up', () => {
    const list = m.byMonth(rows);
    expect(list.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(list.reduce((s, x) => s + x.returns, 0)).toBe(rows.length);
    expect(list[1]).toMatchObject({ returns: 2, units: 3, refundedCash: 25.5 });
  });
});

describe('insights', () => {
  const period = { from: '2026-08-01', to: '2026-10-31', days: 92 };
  const make = (over = {}) => m.insights({
    summary, before: null, reasons: m.byReason(rows), products: m.byProduct(rows, sold),
    backlog: { waiting: 2, oldestDays: 8, approved: 1, approvedAmount: 40 }, period, filtered: false, ...over,
  });

  test('says how many returns, the rate, cash, the top reason and the product', () => {
    const text = make().join('\n');
    expect(text).toMatch(/6 returns were requested from 2026-08-01 to 2026-10-31/);
    expect(text).toMatch(/6 units came back, 6\.0% of the 100 units sold/);
    expect(text).toMatch(/Refunded cash is \$55\.50, 2\.8% of sales including tax/);
    expect(text).toMatch(/1 approved return worth \$40\.00 still has to be refunded/);
    expect(text).toMatch(/most common reason is "Defective or damaged": 2 of 6 returns \(33%\)/);
    expect(text).toMatch(/Forza Used comes back most: 3 of 10 units sold \(30\.0%\)\. That is 5\.0 times the store average/);
    expect(text).toMatch(/2 returns are waiting for review right now \(all dates\); the oldest has waited 8 days/);
    expect(text).toMatch(/Refunds take 6\.0 days on average from the request, and 1 took more than 7 days/);
  });

  test('adds the direction when there is a comparison, and only then', () => {
    const before = { returns: 3, unitsReturned: 3, unitsSold: 100, returnRate: 3, refundedCash: 10, refundShare: 1, avgDaysToRefund: 4, deniedShare: 0 };
    expect(make({ before }).join('\n')).toMatch(/up 100\.0% on the period before/);
    expect(make({ before: { ...before, returns: 12 } }).join('\n')).toMatch(/down 50\.0% on the period before/);
    expect(make({ before: { ...before, returns: 6 } }).join('\n')).toMatch(/the same as in the period before/);
    expect(make({ before: { ...before, returns: 0 } }).join('\n')).toMatch(/none in the period before/);
    expect(make().join('\n')).not.toMatch(/period before/);
  });

  test('no returns says so, with or without filters', () => {
    const none = m.summarize([], sales);
    expect(m.insights({ summary: none, before: null, reasons: [], products: [], backlog: { waiting: 0 }, period, filtered: false }))
      .toEqual(['No returns were requested from 2026-08-01 to 2026-10-31.']);
    expect(m.insights({ summary: none, before: null, reasons: [], products: [], backlog: { waiting: 0 }, period, filtered: true })[0])
      .toMatch(/No returns match these filters/);
  });

  test('a backlog from before the dates is still mentioned', () => {
    const none = m.summarize([], sales);
    const text = m.insights({ summary: none, before: null, reasons: [], products: [], backlog: { waiting: 4, oldestDays: 31 }, period, filtered: false }).join('\n');
    expect(text).toMatch(/4 returns are waiting for review right now/);
    expect(text).toMatch(/oldest has waited 31 days/);
  });

  test('a product with one or two returns is not called a problem', () => {
    const small = m.prepare([records[3]]);
    const text = m.insights({
      summary: m.summarize(small, sales), before: null, reasons: m.byReason(small), products: m.byProduct(small, sold),
      backlog: { waiting: 0 }, period, filtered: false,
    }).join('\n');
    expect(text).not.toMatch(/comes back most/);
  });

  test('always says something', () => {
    const quiet = m.prepare([{ ...records[0], id: 70, status: 'denied', refundTotal: 0, reason: 'x', daysOpen: null }]);
    expect(m.insights({
      summary: m.summarize(quiet, { units: 0, revenue: 0 }), before: null, reasons: [], products: [], backlog: null, period, filtered: false,
    }).length).toBeGreaterThan(0);
  });
});
