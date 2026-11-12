// Returns report (REP-4): what gets sent back, why, and how fast we refund it.
// Laid out like the inventory report: filters, "What this means", number cards, summary tables, and the
// records behind every number at the bottom (the returns shown, with a total row that matches the cards).
// All the arithmetic is in returnsMetrics.js; the data comes from GET /api/reports/returns.
// Run button: nothing is shown until the manager picks the dates and presses Run report. Status, Reason and Search
// then narrow the report that is on screen straight away (they work on the returns already loaded).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Banner, ErrorBanner, Field, Spinner, Table } from '../../../shared/ui.jsx';
import {
  ChoiceFilter, COMPARE_OPTIONS, DateRangeFilter, FilterBar, InsightsPanel, KpiCard, KpiGrid, ReportPage,
  ReportSection, RunButton, RunHint, SelectFilter, useReportFilters, useRunControl,
  changeInfo, formatMoney, formatNumber, formatPercent, rangeProblem, shortDate,
} from '../../../shared/reports.jsx';
import RecordsTable from './RecordsTable.jsx';
import {
  LONG_WAIT_DAYS, REASON_GROUPS, SLOW_REFUND_DAYS, STATUSES, STATUS_LABEL,
  byCategory, byMonth, byProduct, byReason, filterRows, insights, prepare, previousSummary, summarize,
} from './returnsMetrics.js';

// the filters that change what the server sends back (the others only narrow the returns already loaded)
const KEYS = ['from', 'to', 'compare'];
const DAY_MS = 86400000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : key;
};
const rate = (n) => (n === null || n === undefined ? 'No sales' : formatPercent(n));
const days = (n) => `${Number(n).toFixed(1)} days`;

export default function ReturnsReportPage() {
  // the dates start as the last 90 days compared with the 90 days before; `run` marks that the report was already run
  const defaults = useMemo(() => {
    const today = Date.parse(`${ymd(Date.now())}T00:00:00Z`);
    return { from: ymd(today - 89 * DAY_MS), to: ymd(today), compare: 'previous', status: 'All', reason: 'All', search: '', run: '' };
  }, []);
  const [filters, setFilters] = useReportFilters(defaults);
  const { from, to, compare } = filters;
  const problem = rangeProblem(from, to);
  const { applied, run, stale } = useRunControl(filters, setFilters, KEYS);

  const [data, setData] = useState(null);   // null = loading
  const [error, setError] = useState('');

  // fetched only when Run is pressed (`applied` changes), never while the dates are being chosen
  useEffect(() => {
    if (!applied) return undefined;
    let ignore = false;
    setData(null);
    setError('');
    api.get('/api/reports/returns', applied)
      .then((d) => { if (!ignore) setData(d); })
      .catch((e) => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, [applied]);

  return (
    <ReportPage
      title="Returns report"
      subtitle="What gets sent back, why, and how fast we refund it. Every number comes from the returns listed at the bottom."
    >
      <FilterBar>
        <DateRangeFilter from={from} to={to} onChange={setFilters} />
        <ChoiceFilter label="Compare with" value={compare} options={COMPARE_OPTIONS} onChange={(v) => setFilters({ compare: v })} />
        <SelectFilter
          label="Status" value={filters.status} onChange={(v) => setFilters({ status: v })}
          options={[{ value: 'All', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
        />
        <SelectFilter
          label="Reason" value={filters.reason} onChange={(v) => setFilters({ reason: v })}
          options={[{ value: 'All', label: 'All' }, ...REASON_GROUPS.map((g) => ({ value: g, label: g }))]}
        />
        <Field
          label="Search" type="search" placeholder="Customer, return #, order #, product" value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
        <RunButton onClick={run} disabled={Boolean(problem)} loading={Boolean(applied) && data === null && !error} />
      </FilterBar>
      <p className="card-muted" style={{ margin: '12px 0 24px' }}>
        Returns are counted by the day they were requested. Returned units leave out denied returns. Refunded cash counts
        only returns whose status is Refunded, and includes their share of tax.
      </p>
      <RunHint applied={applied} stale={stale} problem={problem} />
      {!applied ? null : error ? <ErrorBanner>{error}</ErrorBanner> : data === null ? <Spinner /> : (
        <ReturnsContent data={data} filters={{ ...filters, compare: applied.compare }} />
      )}
    </ReportPage>
  );
}

function ReturnsContent({ data, filters }) {
  const { status, reason, search, compare } = filters;
  const { period, records, sales, backlog } = data;

  const all = useMemo(() => prepare(records.rows), [records]);
  const rows = filterRows(all, { status, reason, search });
  const ofAnyStatus = filterRows(all, { status, reason, search }, { skipStatus: true });

  const summary = summarize(rows, sales.current);
  const states = summarize(ofAnyStatus, sales.current);
  const filtered = status !== 'All' || reason !== 'All' || search.trim() !== '';
  // the direction only means something when no filter narrows the returns being compared
  const before = !filtered && compare !== 'none' ? previousSummary(data.previous, sales.previous) : null;

  const reasons = byReason(rows);
  const products = byProduct(rows, data.soldByProduct);
  const categories = byCategory(rows, data.soldByProduct);
  const months = byMonth(rows);
  const notes = insights({ summary, before, reasons, products, backlog, period, filtered });

  const move = (key, kind, goodWhen, unit) => (before && before[key] !== null && before[key] !== undefined && summary[key] !== null
    ? changeInfo({ current: summary[key], previous: before[key], kind, goodWhen, compare, unit })
    : undefined);
  const wasMoney = (key) => (before && before[key] !== null && before[key] !== undefined ? formatMoney(before[key]) : undefined);

  const recordColumns = [
    { key: 'day', label: 'Requested', render: (r) => shortDate(r.day, true), sortValue: (r) => r.requestedAt, csv: (r) => r.day },
    { key: 'id', label: 'Return #' },
    { key: 'orderId', label: 'Order #' },
    { key: 'customerName', label: 'Customer' },
    { key: 'productsText', label: 'Products and units' },
    { key: 'reasonGroup', label: 'Reason group' },
    { key: 'reason', label: 'What the customer wrote' },
    { key: 'status', label: 'Status', render: (r) => STATUS_LABEL[r.status], sortValue: (r) => STATUS_LABEL[r.status], csv: (r) => STATUS_LABEL[r.status] },
    { key: 'daysSinceSale', label: 'Days since the sale', numeric: true },
    {
      key: 'daysOpen', label: 'Days open', numeric: true,
      render: (r) => {
        if (r.daysOpen === null || r.daysOpen === undefined) return '';
        const late = r.status === 'refunded' ? r.daysOpen > SLOW_REFUND_DAYS : r.daysOpen > LONG_WAIT_DAYS;
        const text = r.status === 'refunded' ? `${r.daysOpen} days` : `${r.daysOpen} days waiting`;
        return late ? <strong style={{ color: 'var(--color-danger)' }}>{text}</strong> : text;
      },
      csv: (r) => r.daysOpen,
    },
    { key: 'countedUnits', label: 'Units', numeric: true, total: summary.unitsReturned },
    { key: 'refundValue', label: 'Refund amount', numeric: true, render: (r) => formatMoney(r.refundValue), csv: (r) => r.refundValue },
    {
      key: 'refundedCash', label: 'Refunded cash', numeric: true,
      render: (r) => (r.status === 'refunded' ? formatMoney(r.refundedCash) : ''),
      csv: (r) => r.refundedCash,
      total: formatMoney(summary.refundedCash),
    },
    {
      key: 'refundedAt', label: 'Refunded on', render: (r) => (r.refundedAt ? shortDate(r.refundedAt, true) : ''),
      sortValue: (r) => r.refundedAt || null, csv: (r) => (r.refundedAt ? String(r.refundedAt).slice(0, 10) : ''),
    },
  ];

  return (
    <>
      {records.truncated && (
        <Banner kind="info">Showing the first {records.rows.length} of {records.total} returns. Narrow the dates to see them all.</Banner>
      )}

      <InsightsPanel insights={notes} />

      <div style={{ height: 24 }} />
      <KpiGrid>
        <KpiCard
          label="Returns requested" value={formatNumber(summary.returns)}
          change={move('returns', 'percent', 'down')} previous={before ? formatNumber(before.returns) : undefined}
          hint={`${period.from} to ${period.to}`}
        />
        <KpiCard
          label="Return rate" value={rate(summary.returnRate)}
          change={move('returnRate', 'absolute', 'down', 'points')} previous={before && before.returnRate !== null ? formatPercent(before.returnRate) : undefined}
          hint={`Returned units / units sold (${formatNumber(summary.unitsSold)} units sold).`}
        />
        <KpiCard
          label="Units returned" value={formatNumber(summary.unitsReturned)}
          change={move('unitsReturned', 'percent', 'down')} previous={before ? formatNumber(before.unitsReturned) : undefined}
          hint="Requested, approved and refunded; not denied."
        />
        <KpiCard
          label="Refunded cash" value={formatMoney(summary.refundedCash)}
          change={move('refundedCash', 'percent', 'down')} previous={wasMoney('refundedCash')}
          hint="Status Refunded only, tax included."
        />
        <KpiCard
          label="Refunds as share of sales" value={summary.refundShare === null ? 'No sales' : formatPercent(summary.refundShare)}
          change={move('refundShare', 'absolute', 'down', 'points')} previous={before && before.refundShare !== null ? formatPercent(before.refundShare) : undefined}
          hint={`Refunded cash / sales with tax (${formatMoney(summary.revenue)}).`}
        />
        <KpiCard
          label="Average days to refund" value={summary.avgDaysToRefund === null ? 'None refunded' : days(summary.avgDaysToRefund)}
          change={move('avgDaysToRefund', 'absolute', 'down', 'days')} previous={before && before.avgDaysToRefund !== null ? days(before.avgDaysToRefund) : undefined}
          hint={summary.slowRefunds > 0 ? `${summary.slowRefunds} took more than ${SLOW_REFUND_DAYS} days.` : 'From the request to the refund.'}
        />
      </KpiGrid>

      <div style={{ height: 24 }} />
      <ReportSection
        title="Where the returns stand"
        caption="Counts every status for the returns in these dates. The Status filter does not change these four cards."
      >
        <KpiGrid>
          <KpiCard
            label={STATUS_LABEL.requested} value={formatNumber(states.waiting)}
            hint={states.waiting > 0 ? `Oldest has waited ${states.oldestWait} days; ${states.longWaits} waited more than ${LONG_WAIT_DAYS}.` : 'Nothing is waiting.'}
          />
          <KpiCard
            label={STATUS_LABEL.approved} value={formatNumber(states.approved)}
            hint={states.approved > 0 ? `${formatMoney(states.approvedAmount)} still to refund.` : 'Nothing is waiting to be refunded.'}
          />
          <KpiCard label={STATUS_LABEL.refunded} value={formatNumber(states.refunded)} hint={`${formatMoney(states.refundedCash)} refunded.`} />
          <KpiCard
            label={STATUS_LABEL.denied} value={formatNumber(states.denied)}
            hint={states.deniedShare === null ? 'Nothing decided yet.' : `${formatPercent(states.deniedShare, 0)} of decided returns.`}
          />
        </KpiGrid>
      </ReportSection>

      <div style={{ height: 24 }} />
      <ReportSection title="Returns by reason" caption="Customers type the reason; each one is put in a group by its key words.">
        <Table rowKey="reason" rows={reasons} empty="No returns match these filters." columns={[
          { key: 'reason', label: 'Reason group' },
          { key: 'returns', label: 'Returns', numeric: true },
          { key: 'share', label: 'Share of returns', numeric: true, render: (r) => `${r.share}%` },
          { key: 'units', label: 'Units returned', numeric: true },
          { key: 'refundedCash', label: 'Refunded cash', numeric: true, render: (r) => formatMoney(r.refundedCash) },
        ]} />
      </ReportSection>

      <div style={{ height: 24 }} />
      <ReportSection
        title="Most returned products"
        caption="Return rate = units returned / units sold in the same dates. A product with few sales can show a high rate after one return."
      >
        <Table rowKey="productId" rows={products.slice(0, 10)} empty="No returns match these filters." columns={[
          { key: 'name', label: 'Product' },
          { key: 'category', label: 'Category' },
          { key: 'sold', label: 'Units sold', numeric: true },
          { key: 'returned', label: 'Units returned', numeric: true },
          { key: 'rate', label: 'Return rate', numeric: true, render: (p) => rate(p.rate) },
          { key: 'refundedCash', label: 'Refunded cash', numeric: true, render: (p) => formatMoney(p.refundedCash) },
        ]} />
        {products.length > 10 && <p className="card-muted">Showing the 10 most returned of {products.length} products.</p>}
      </ReportSection>

      <div style={{ height: 24 }} />
      <ReportSection title="Returns by category">
        <Table rowKey="category" rows={categories} empty="No sales or returns in these dates." columns={[
          { key: 'category', label: 'Category' },
          { key: 'sold', label: 'Units sold', numeric: true },
          { key: 'returned', label: 'Units returned', numeric: true },
          { key: 'rate', label: 'Return rate', numeric: true, render: (c) => rate(c.rate) },
          { key: 'refundedCash', label: 'Refunded cash', numeric: true, render: (c) => formatMoney(c.refundedCash) },
        ]} />
      </ReportSection>

      <div style={{ height: 24 }} />
      <ReportSection title="Returns by month" caption="By the month the return was requested, oldest first: is it going up or down?">
        <Table rowKey="month" rows={months} empty="No returns match these filters." columns={[
          { key: 'month', label: 'Month', render: (m) => monthLabel(m.month) },
          { key: 'returns', label: 'Returns', numeric: true },
          { key: 'units', label: 'Units returned', numeric: true },
          { key: 'refundedCash', label: 'Refunded cash', numeric: true, render: (m) => formatMoney(m.refundedCash) },
        ]} />
      </ReportSection>

      <div style={{ height: 24 }} />
      <RecordsTable
        title="Returns in this report"
        noun="returns"
        rows={rows}
        allCount={all.length}
        columns={recordColumns}
        rowKey="id"
        totalLabel={`Total of ${rows.length} ${rows.length === 1 ? 'return' : 'returns'}`}
        empty="No returns match these filters."
        csvName="returns-records.csv"
        note="These are the returns behind every number above. The Units total leaves out denied returns and is the Units returned card; the Refunded cash total is the Refunded cash card. This table follows the Status filter; the four status cards do not."
      />
    </>
  );
}
