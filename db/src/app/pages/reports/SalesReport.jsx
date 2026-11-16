// Sales report (managers only). Written by Terry (Part 2).
// Filters -> KPIs (click to jump) -> what this means -> charts -> records (order numbers open the order, names open the customer).
// Run button (added by the team): nothing is shown until the manager picks the filters and presses Run report.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Spinner, ErrorBanner, Field } from '../../../shared/ui.jsx';
import {
  ReportPage, ReportSection, FilterBar, DateRangeFilter, ChoiceFilter, SelectFilter, useReportFilters,
  useRunControl, RunButton, RunHint, JumpTo, Anchor,
  KpiGrid, KpiCard, InsightsPanel, LineChart, BarChart, HBarChart, SegmentedBar, RecordsTable,
  formatMoney, formatNumber, formatPercent, changeInfo, changeInsight, bucketLabel, shortDate,
  presetRange, rangeProblem, COMPARE_OPTIONS, GROUP_OPTIONS,
} from '../../../shared/reports.jsx';

// `run` is the mark that the report was already run (it travels in the URL, so Back from an order keeps the report)
const DEFAULTS = { ...presetRange('last30'), compare: 'previous', groupBy: 'day', category: '', product: '', method: '', run: '' };
// the filters that change what the server sends back
const KEYS = ['from', 'to', 'compare', 'groupBy', 'category', 'product', 'method'];
const METHOD_NAMES = { credit: 'Credit', debit: 'Debit', unknown: 'Unknown' };
const cents = (n) => Math.round(Number(n || 0) * 100);
const sumMoney = (list, key) => list.reduce((sum, r) => sum + cents(r[key]), 0) / 100;
const sumNumber = (list, key) => list.reduce((sum, r) => sum + Number(r[key] || 0), 0);
const plural = (n, one, many) => (n === 1 ? one : many);

export default function SalesReport() {
  const [filters, setFilters] = useReportFilters(DEFAULTS);
  const { applied, run, stale } = useRunControl(filters, setFilters, KEYS);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // quick filters above the two tables: they narrow the rows already loaded, so they work without pressing Run
  const [productKind, setProductKind] = useState('All');
  const [productSearch, setProductSearch] = useState('');
  const [orderKind, setOrderKind] = useState('All');
  const [orderSearch, setOrderSearch] = useState('');
  // the category and product lists for the two dropdowns, read once before the first run (one day, nothing is shown)
  const [lists, setLists] = useState({ categories: [], products: [] });
  const problem = rangeProblem(filters.from, filters.to);

  useEffect(() => {
    let live = true;
    const today = new Date().toISOString().slice(0, 10);
    api.get('/api/reports/sales', { from: today, to: today, compare: 'none' })
      .then((d) => { if (live) setLists(d.options); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // the report is fetched only when Run is pressed (`applied` changes), never while the filters are being chosen
  useEffect(() => {
    if (!applied) return undefined;
    let live = true;
    setLoading(true);
    setError(null);
    setData(null);
    api.get('/api/reports/sales', applied)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied]);

  const compare = applied ? applied.compare : filters.compare;
  const options = data ? data.options : lists;
  const productOptions = options.products.filter((x) => !filters.category || String(x.categoryId) === filters.category);

  const filterBar = (
    <FilterBar>
      <DateRangeFilter from={filters.from} to={filters.to} onChange={setFilters} />
      <ChoiceFilter label="Compare with" value={filters.compare} options={COMPARE_OPTIONS} onChange={(v) => setFilters({ compare: v })} />
      <ChoiceFilter label="Group by" value={filters.groupBy} options={GROUP_OPTIONS} onChange={(v) => setFilters({ groupBy: v })} />
      <SelectFilter label="Category" value={filters.category} onChange={(v) => setFilters({ category: v, product: '' })}
        options={[{ value: '', label: 'All categories' }, ...options.categories.map((c) => ({ value: String(c.id), label: c.name }))]} />
      <SelectFilter label="Product" value={filters.product} onChange={(v) => setFilters({ product: v })}
        options={[{ value: '', label: 'All products' }, ...productOptions.map((x) => ({ value: String(x.id), label: x.name }))]} />
      <SelectFilter label="Payment method" value={filters.method} onChange={(v) => setFilters({ method: v })}
        options={[{ value: '', label: 'All methods' }, { value: 'credit', label: 'Credit' }, { value: 'debit', label: 'Debit' }]} />
      <RunButton onClick={run} disabled={Boolean(problem)} loading={loading} />
    </FilterBar>
  );

  const page = (body) => (
    <ReportPage
      title="Sales report"
      subtitle="How much we sold, how much we kept, and what sells best. Every number comes from the products and orders listed at the bottom."
    >
      {filterBar}
      <p className="card-muted" style={{ margin: '12px 0 24px' }}>
        Completed sales only, counted by the day of the sale. Net revenue is after discounts and refunds, before tax.
        Cost uses each product's current cost price.
      </p>
      <RunHint applied={applied} stale={stale} problem={problem} />
      {body}
    </ReportPage>
  );

  if (!applied) return page(null);
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

  // the rows of the two tables after the quick filters (the totals under each table add up these rows)
  const pText = productSearch.trim().toLowerCase();
  const productRows = data.products
    .filter((x) => productKind === 'All' || (productKind === 'Sold' ? x.units > 0 : x.units === 0))
    .filter((x) => !pText || x.name.toLowerCase().includes(pText) || x.category.toLowerCase().includes(pText));
  const oText = orderSearch.trim().toLowerCase();
  const orderRows = data.orders
    .filter((o) => orderKind === 'All' || (orderKind === 'Refunds' ? o.refunded > 0 : !(o.refunded > 0)))
    .filter((o) => !oText || String(o.orderId).includes(oText) || String(o.customer).toLowerCase().includes(oText));

  // "What this means": a few plain sentences, most important first
  const notes = [];
  const gone = data.products.filter((x) => x.units === 0).length;
  const top = data.byCategory[0];
  if (comparing) notes.push(changeInsight({ label: 'Net revenue', current: t.net, previous: p.net, format: formatMoney, compare }));
  else notes.push(`Net revenue is ${formatMoney(t.net)} from ${formatNumber(t.orders)} ${plural(t.orders, 'order', 'orders')}.`);
  if (t.margin !== null) {
    notes.push((comparing && changeInsight({ label: 'Profit margin', current: t.margin, previous: p.margin, format: (v) => formatPercent(v), compare, kind: 'absolute', unit: 'points' }))
      || `We kept ${formatMoney(t.profit)} as gross profit after cost, a margin of ${formatPercent(t.margin)}.`);
  }
  if (top && t.net > 0) notes.push(`${top.category} brought in the most: ${formatMoney(top.revenue)}, ${formatPercent((top.revenue / t.net) * 100, 0)} of net revenue.`);
  if (sold[0]) notes.push(`Best seller: ${sold[0].name}, ${formatNumber(sold[0].units)} ${plural(sold[0].units, 'unit', 'units')}.`);
  if (t.refunded > 0 && t.gross > 0) {
    const share = (t.refunded / t.gross) * 100;
    notes.push({ tone: share >= 5 ? 'bad' : 'neutral', text: `Refunds took back ${formatMoney(t.refunded)}, ${formatPercent(share)} of gross sales.` });
  } else if (gone > 0) {
    notes.push({ tone: 'bad', text: `${formatNumber(gone)} of ${formatNumber(data.products.length)} products did not sell at all in these dates.` });
  }
  const insights = notes.filter(Boolean).slice(0, 5);

  return page(
    <>
      <KpiGrid>
        <JumpTo target="trend">
          <KpiCard label="Net revenue" value={formatMoney(t.net)} change={change('net')} previous={before('net', formatMoney)} hint="After discounts and refunds, before tax." />
        </JumpTo>
        <JumpTo target="orders">
          <KpiCard label="Orders" value={formatNumber(t.orders)} change={change('orders')} previous={before('orders', formatNumber)} hint="Completed orders." />
        </JumpTo>
        <JumpTo target="orders">
          <KpiCard label="Average order value" value={formatMoney(t.avgOrder)} change={change('avgOrder')} previous={before('avgOrder', formatMoney)} hint="Net revenue divided by orders." />
        </JumpTo>
        <JumpTo target="products">
          <KpiCard label="Units sold" value={formatNumber(t.units)} change={change('units')} previous={before('units', formatNumber)} hint="Before refunds." />
        </JumpTo>
        <JumpTo target="by-category">
          <KpiCard label="Gross profit" value={formatMoney(t.profit)} change={change('profit')} previous={before('profit', formatMoney)} hint={`Net revenue minus cost (${formatMoney(t.cost)}).`} />
        </JumpTo>
        <JumpTo target="products">
          <KpiCard label="Profit margin" value={formatPercent(t.margin)} change={change('margin', { kind: 'absolute', unit: 'points' })} previous={before('margin', (v) => formatPercent(v))} hint="Gross profit divided by net revenue." />
        </JumpTo>
      </KpiGrid>

      <div style={{ marginTop: 24 }}>
        <InsightsPanel insights={insights} />
      </div>

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

      <div style={{ height: 24 }} />
      <Anchor id="products">
        <RecordsTable
          title="Products in this report"
          noun="products"
          rows={productRows}
          allCount={data.products.length}
          rowKey="productId"
          totalLabel={`Total of ${productRows.length} ${plural(productRows.length, 'product', 'products')}`}
          empty="No products match these filters."
          csvName="sales-products.csv"
          controls={(
            <>
              <Field label="Products" as="select" value={productKind} onChange={(e) => setProductKind(e.target.value)}>
                <option value="All">All</option>
                <option value="Sold">Sold in these dates</option>
                <option value="Unsold">Not sold</option>
              </Field>
              <Field label="Search" type="search" placeholder="Product or category" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
            </>
          )}
          columns={[
            { key: 'name', label: 'Product' },
            { key: 'category', label: 'Category' },
            { key: 'units', label: 'Units', numeric: true, total: formatNumber(sumNumber(productRows, 'units')) },
            { key: 'revenue', label: 'Net revenue', numeric: true, render: (x) => formatMoney(x.revenue), total: formatMoney(sumMoney(productRows, 'revenue')) },
            { key: 'cost', label: 'Cost', numeric: true, render: (x) => formatMoney(x.cost), total: formatMoney(sumMoney(productRows, 'cost')) },
            { key: 'profit', label: 'Profit', numeric: true, render: (x) => formatMoney(x.profit), total: formatMoney(sumMoney(productRows, 'profit')) },
            {
              key: 'margin', label: 'Margin', numeric: true,
              render: (x) => (x.revenue > 0 ? formatPercent((x.profit / x.revenue) * 100) : '-'),
              sortValue: (x) => (x.revenue > 0 ? x.profit / x.revenue : null),
              csv: (x) => (x.revenue > 0 ? Math.round((x.profit / x.revenue) * 1000) / 10 : ''),
            },
          ]}
          note="These are the products behind the cards above, including the ones that sold nothing. With Products set to All, the Units, Net revenue and Profit totals match the Units sold, Net revenue and Gross profit cards."
        />
      </Anchor>

      <div style={{ height: 24 }} />
      <Anchor id="orders">
        <RecordsTable
          title="Orders in this report"
          noun="orders"
          rows={orderRows}
          allCount={data.orders.length}
          rowKey="orderId"
          totalLabel={`Total of ${orderRows.length} ${plural(orderRows.length, 'order', 'orders')}`}
          empty="No completed orders match these filters."
          csvName="sales-orders.csv"
          controls={(
            <>
              <Field label="Orders" as="select" value={orderKind} onChange={(e) => setOrderKind(e.target.value)}>
                <option value="All">All</option>
                <option value="Refunds">With refunds</option>
                <option value="None">Without refunds</option>
              </Field>
              <Field label="Search" type="search" placeholder="Order # or customer" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} />
            </>
          )}
          columns={[
            { key: 'orderId', label: 'Order', render: (o) => <Link to={`/staff/reports/sales/orders/${o.orderId}`}>#{o.orderId}</Link> },
            { key: 'saleDate', label: 'Date', render: (o) => shortDate(o.saleDate, true), sortValue: (o) => String(o.saleDate).slice(0, 10) },
            { key: 'customer', label: 'Customer', render: (o) => <Link to={`/staff/reports/customers/${o.customerId}`}>{o.customer}</Link> },
            { key: 'method', label: 'Paid with', render: (o) => METHOD_NAMES[o.method] || '-' },
            { key: 'units', label: 'Units', numeric: true, total: formatNumber(sumNumber(orderRows, 'units')) },
            { key: 'net', label: 'Net revenue', numeric: true, render: (o) => formatMoney(o.net), total: formatMoney(sumMoney(orderRows, 'net')) },
            { key: 'profit', label: 'Profit', numeric: true, render: (o) => formatMoney(o.profit), total: formatMoney(sumMoney(orderRows, 'profit')) },
          ]}
          note="Completed orders placed in the chosen dates. With Orders set to All, the Units, Net revenue and Profit totals match the Units sold, Net revenue and Gross profit cards. Click an order number to open the order."
        />
      </Anchor>
    </>
  );
}
