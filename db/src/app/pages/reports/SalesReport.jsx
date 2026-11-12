// Sales report (managers only). Written by Terry (Part 2).
// Filters -> KPIs (click to jump) -> charts -> records (order numbers open the order).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Spinner, ErrorBanner } from '../../../shared/ui.jsx';
import {
  ReportPage, ReportSection, FilterBar, DateRangeFilter, ChoiceFilter, SelectFilter, useReportFilters,
  KpiGrid, KpiCard, LineChart, BarChart, HBarChart, SegmentedBar, RecordsTable,
  formatMoney, formatNumber, formatPercent, changeInfo, bucketLabel, shortDate,
  presetRange, rangeProblem, COMPARE_OPTIONS, GROUP_OPTIONS,
} from '../../../shared/reports.jsx';

const DEFAULTS = { ...presetRange('last30'), compare: 'previous', groupBy: 'day', category: '', product: '', method: '' };
const METHOD_NAMES = { credit: 'Credit', debit: 'Debit', unknown: 'Unknown' };

// a card you can click to scroll down to the section behind its number
function JumpTo({ target, children }) {
  const go = (e) => {
    e.preventDefault();
    const el = document.getElementById(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <a href={`#${target}`} onClick={go} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
      {children}
    </a>
  );
}

// a section the cards can jump to (the margin keeps it from hiding under the top menu)
const Anchor = ({ id, children }) => <div id={id} style={{ scrollMarginTop: 80 }}>{children}</div>;

export default function SalesReport() {
  const [filters, setFilters] = useReportFilters(DEFAULTS);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const problem = rangeProblem(filters.from, filters.to);

  useEffect(() => {
    if (problem) return undefined;
    let live = true;
    setLoading(true);
    setError(null);
    api.get('/api/reports/sales', filters)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filters, problem]);

  const compare = filters.compare;
  const options = data ? data.options : { categories: [], products: [] };
  const productOptions = options.products.filter((x) => !filters.category || String(x.categoryId) === filters.category);

  const filterBar = (
    <FilterBar>
      <DateRangeFilter from={filters.from} to={filters.to} onChange={setFilters} />
      <ChoiceFilter label="Compare with" value={compare} options={COMPARE_OPTIONS} onChange={(v) => setFilters({ compare: v })} />
      <ChoiceFilter label="Group by" value={filters.groupBy} options={GROUP_OPTIONS} onChange={(v) => setFilters({ groupBy: v })} />
      <SelectFilter label="Category" value={filters.category} onChange={(v) => setFilters({ category: v, product: '' })}
        options={[{ value: '', label: 'All categories' }, ...options.categories.map((c) => ({ value: String(c.id), label: c.name }))]} />
      <SelectFilter label="Product" value={filters.product} onChange={(v) => setFilters({ product: v })}
        options={[{ value: '', label: 'All products' }, ...productOptions.map((x) => ({ value: String(x.id), label: x.name }))]} />
      <SelectFilter label="Payment method" value={filters.method} onChange={(v) => setFilters({ method: v })}
        options={[{ value: '', label: 'All methods' }, { value: 'credit', label: 'Credit' }, { value: 'debit', label: 'Debit' }]} />
    </FilterBar>
  );

  const page = (body) => (
    <ReportPage title="Sales report">
      {filterBar}
      {body}
    </ReportPage>
  );

  if (error) return page(<ErrorBanner error={error} />);
  if (!data) return page(<Spinner />);

  const t = data.totals;
  const p = data.previousTotals;
  const comparing = compare !== 'none' && p;
  const change = (key, opts = {}) => (comparing ? changeInfo({ current: t[key], previous: p[key], compare, ...opts }) : undefined);
  const before = (key, fmt) => (comparing ? fmt(p[key]) : undefined);
  const prevLabel = compare === 'lastyear' ? 'Last year' : 'Previous period';

  const trendData = data.trend.map((d) => ({ label: bucketLabel(d.label, data.period.groupBy), revenue: d.revenue, previous: d.prevRevenue }));
  const sold = data.products.filter((x) => x.units > 0);
  const worst = [...data.products].sort((a, b) => a.revenue - b.revenue || a.units - b.units).slice(0, 5);
  const orderUnits = data.orders.reduce((s, o) => s + Number(o.units || 0), 0);

  return page(
    <>
      {loading && <Spinner />}

      <KpiGrid>
        <JumpTo target="trend">
          <KpiCard label="Net revenue" value={formatMoney(t.net)} change={change('net')} previous={before('net', formatMoney)} />
        </JumpTo>
        <JumpTo target="orders">
          <KpiCard label="Orders" value={formatNumber(t.orders)} change={change('orders')} previous={before('orders', formatNumber)} />
        </JumpTo>
        <JumpTo target="orders">
          <KpiCard label="Average order value" value={formatMoney(t.avgOrder)} change={change('avgOrder')} previous={before('avgOrder', formatMoney)} />
        </JumpTo>
        <JumpTo target="products">
          <KpiCard label="Units sold" value={formatNumber(t.units)} change={change('units')} previous={before('units', formatNumber)} />
        </JumpTo>
        <JumpTo target="by-category">
          <KpiCard label="Gross profit" value={formatMoney(t.profit)} change={change('profit')} previous={before('profit', formatMoney)} hint={`Cost ${formatMoney(t.cost)}`} />
        </JumpTo>
        <JumpTo target="products">
          <KpiCard label="Profit margin" value={formatPercent(t.margin)} change={change('margin', { kind: 'absolute', unit: 'points' })} previous={before('margin', (v) => formatPercent(v))} />
        </JumpTo>
      </KpiGrid>

      <Anchor id="trend">
        <ReportSection title="Trend" caption={data.period.groupByChanged ? 'Grouped by week (range over 92 days)' : undefined}>
          <LineChart data={trendData} format={formatMoney} caption={`Net revenue per ${data.period.groupBy}`}
            series={[{ key: 'revenue', label: 'This period' }, ...(comparing ? [{ key: 'previous', label: prevLabel, compare: true }] : [])]} />
        </ReportSection>
      </Anchor>

      <Anchor id="by-category">
        <ReportSection title="By category">
          <BarChart data={data.byCategory.map((c) => ({ label: c.category, revenue: c.revenue, profit: c.profit }))} format={formatMoney}
            series={[{ key: 'revenue', label: 'Net revenue' }, { key: 'profit', label: 'Gross profit' }]} />
        </ReportSection>
      </Anchor>

      <Anchor id="sellers">
        <ReportSection title="Best and worst sellers">
          <HBarChart caption="Best sellers (units)" format={formatNumber}
            rows={sold.slice(0, 5).map((x) => ({ label: x.name, value: x.units, note: formatMoney(x.revenue) }))} />
          <HBarChart caption="Worst sellers (revenue)" format={formatMoney} color={1}
            rows={worst.map((x) => ({ label: x.name, value: x.revenue, note: `${formatNumber(x.units)} sold` }))} />
        </ReportSection>
      </Anchor>

      <Anchor id="payments">
        <ReportSection title="Payment methods">
          <SegmentedBar format={formatNumber}
            parts={data.paymentMethods.map((m) => ({ label: METHOD_NAMES[m.method] || m.method, value: m.orders }))} />
        </ReportSection>
      </Anchor>

      <Anchor id="products">
        <RecordsTable
          title="Products"
          noun="products"
          rows={data.products}
          allCount={data.products.length}
          rowKey="productId"
          totalLabel="Total"
          empty="No products match these filters."
          columns={[
            { key: 'name', label: 'Product' },
            { key: 'category', label: 'Category' },
            { key: 'units', label: 'Units', numeric: true, total: formatNumber(t.units) },
            { key: 'revenue', label: 'Net revenue', numeric: true, render: (x) => formatMoney(x.revenue), total: formatMoney(t.net) },
            { key: 'cost', label: 'Cost', numeric: true, render: (x) => formatMoney(x.cost), total: formatMoney(t.cost) },
            { key: 'profit', label: 'Profit', numeric: true, render: (x) => formatMoney(x.profit), total: formatMoney(t.profit) },
            { key: 'margin', label: 'Margin', numeric: true, render: (x) => (x.revenue > 0 ? formatPercent((x.profit / x.revenue) * 100) : '-'), sortValue: (x) => (x.revenue > 0 ? x.profit / x.revenue : null) },
          ]}
        />
      </Anchor>

      <Anchor id="orders">
        <RecordsTable
          title="Orders"
          noun="orders"
          rows={data.orders}
          allCount={data.orders.length}
          rowKey="orderId"
          totalLabel="Total"
          empty="No completed orders match these filters."
          columns={[
            { key: 'orderId', label: 'Order', render: (o) => <Link to={`/staff/reports/sales/orders/${o.orderId}`}>#{o.orderId}</Link> },
            { key: 'saleDate', label: 'Date', render: (o) => shortDate(o.saleDate, true), sortValue: (o) => String(o.saleDate).slice(0, 10) },
            { key: 'customer', label: 'Customer' },
            { key: 'method', label: 'Paid with', render: (o) => METHOD_NAMES[o.method] || '-' },
            { key: 'units', label: 'Units', numeric: true, total: formatNumber(orderUnits) },
            { key: 'net', label: 'Net revenue', numeric: true, render: (o) => formatMoney(o.net), total: formatMoney(t.net) },
            { key: 'profit', label: 'Profit', numeric: true, render: (o) => formatMoney(o.profit), total: formatMoney(t.profit) },
          ]}
        />
      </Anchor>
    </>
  );
}