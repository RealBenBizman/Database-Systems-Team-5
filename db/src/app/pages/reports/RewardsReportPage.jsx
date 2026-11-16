// Customer behavior and loyalty report (Part 3, Ben's version; it replaces the old Rewards report at the same route).
// Filters -> KPI cards -> What this means -> new and returning customers -> members and non-members -> what they buy
// -> tier rewards -> the records tables. Data: GET /api/reports/customers.
// Run button (added by the team): nothing is shown until the manager picks the dates and presses Run report. The
// tier, type, category, search and order filters then narrow the report on screen straight away.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { ErrorBanner, Field, Spinner, Table } from '../../../shared/ui.jsx';
import {
  ReportPage, ReportSection, FilterBar, DateRangeFilter, ChoiceFilter, SelectFilter, useReportFilters, useRunControl, RunButton, RunHint, JumpTo, Anchor,
  KpiGrid, KpiCard, InsightsPanel, StackedBars, SegmentedBar, RecordsTable,
  formatMoney, formatNumber, formatPercent, changeInfo, bucketLabel, shortDate, rangeProblem, COMPARE_OPTIONS,
} from '../../../shared/reports.jsx';


const count = (n) => Number(n || 0).toLocaleString('en-US');
const TYPES = ['New', 'Returning', 'Did not return', 'No orders yet'];
const NO_TIER = 'No tier';
const LOW_REPEAT = 30;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
// `run` is the mark that the report was already run (it travels in the URL); KEYS are the filters the server needs
const DEFAULTS = { from: daysAgo(29), to: daysAgo(0), compare: 'previous', run: '' };
const KEYS = ['from', 'to', 'compare'];
const cents = (n) => Math.round(Number(n || 0) * 100);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);
const perEach = (n) => (n == null ? '-' : n.toFixed(2));
const add = (list, key) => list.reduce((sum, r) => sum + Number(r[key] || 0), 0);
const addMoney = (list, key) => list.reduce((sum, r) => sum + cents(r[key]), 0) / 100;
function measure(list, ordersKey = 'orders', spentKey = 'spent') {
  const buyers = list.filter((c) => c[ordersKey] > 0);
  const orders = add(buyers, ordersKey);
  const revenue = addMoney(buyers, spentKey);
  return {
    customers: list.length,
    buyers: buyers.length,
    orders,
    revenue,
    perCustomer: buyers.length ? orders / buyers.length : null,
    avgOrder: orders ? revenue / orders : null,
    spendEach: buyers.length ? revenue / buyers.length : null,
  };
}
function repeatRate(list) {
  const buyers = list.filter((c) => c.orders > 0);
  return pct(buyers.filter((c) => c.ordersBefore + c.orders > 1).length, buyers.length);
}


export default function RewardsReportPage() {
  const [filters, setFilters] = useReportFilters(DEFAULTS);
  const { applied, run, stale } = useRunControl(filters, setFilters, KEYS);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState('All');
  const [type, setType] = useState('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [orderKind, setOrderKind] = useState('All');
  const problem = rangeProblem(filters.from, filters.to);
  // fetched only when Run is pressed (`applied` changes), never while the dates are being chosen
  useEffect(() => {
    if (!applied) return undefined;
    let live = true;
    setLoading(true);
    setError(null);
    setData(null);
    api.get('/api/reports/customers', applied)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied]);
  const tiers = data ? data.tiers : [];
  const categories = data ? [...new Set(data.categories.map((r) => r.category))].sort() : [];

  const page = (body) => (
    <ReportPage title="Customer behavior and loyalty report" subtitle="Who buys, who comes back, what they buy, and whether loyalty members act differently. Every number comes from the rows shown below it.">
      <FilterBar>
        <DateRangeFilter from={filters.from} to={filters.to} onChange={setFilters} />
        <ChoiceFilter label="Compare with" value={filters.compare} options={COMPARE_OPTIONS} onChange={(v) => setFilters({ compare: v })} />
        <SelectFilter
          label="Loyalty tier" value={tier} onChange={setTier}
          options={[
            { value: 'All', label: 'All' },
            { value: 'Members', label: 'Members (any tier)' },
            { value: NO_TIER, label: 'Non-members (no tier)' },
            ...tiers.map((t) => ({ value: t, label: t })),
          ]}
        />
        <SelectFilter
          label="Customer type" value={type} onChange={setType}
          options={[{ value: 'All', label: 'All' }, ...TYPES.map((t) => ({ value: t, label: t }))]}
        />
        <SelectFilter
          label="Buys most" value={category} onChange={setCategory}
          options={[{ value: 'All', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]}
        />
        <Field label="Search" type="search" placeholder="Customer name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <RunButton onClick={run} disabled={Boolean(problem)} loading={loading} />
      </FilterBar>
      <RunHint applied={applied} stale={stale} problem={problem} />
      {body}
    </ReportPage>
  );
  if (!applied) return page(null);
  if (error) return page(<ErrorBanner error={error} />);
  if (!data) return page(<Spinner />);
  const { period } = data;
  const compare = period.compare;
  const comparing = period.previous != null;
  const text = search.trim().toLowerCase();
  const rows = data.customers
    .filter((c) => tier === 'All' || (tier === 'Members' ? c.tier !== NO_TIER : c.tier === tier))
    .filter((c) => type === 'All' || c.type === type)
    .filter((c) => category === 'All' || c.favorite === category)
    .filter((c) => !text || c.name.toLowerCase().includes(text));
  const byId = {};
  rows.forEach((c) => { byId[c.customerId] = c; });
  const allOrders = data.orders
    .filter((o) => byId[o.customerId])
    .map((o) => ({ ...o, customer: byId[o.customerId].name, tier: byId[o.customerId].tier }));
  const bought = data.categories.filter((r) => byId[r.customerId]);
  const rewards = data.rewards.filter((r) => byId[r.customerId]);
  const now = measure(rows);
  const was = comparing ? measure(rows, 'prevOrders', 'prevSpent') : null;
  const ofType = (t) => rows.filter((c) => c.type === t);
  const fresh = ofType('New');
  const back = ofType('Returning');
  const lost = ofType('Did not return');
  const repeat = repeatRate(rows);
  const retention = pct(back.length, back.length + lost.length);
  const used = rewards.filter((r) => r.status === 'Used');
  const redemption = pct(used.length, rewards.length);
  const pointsEarned = add(rows, 'pointsEarned');
  const pointsBack = add(rows, 'pointsTakenBack');
  const pointsHeld = add(rows, 'points');
  const change = (key) => (comparing ? changeInfo({ current: now[key], previous: was[key], compare }) : undefined);
  const before = (key, fmt) => (comparing ? fmt(was[key]) : undefined);

  const months = [...new Set(allOrders.map((o) => o.saleDate.slice(0, 7)))].sort();
  const trend = months.map((m) => {
    const inMonth = allOrders.filter((o) => o.saleDate.slice(0, 7) === m);
    const everyone = new Set(inMonth.map((o) => o.customerId));
    const first = new Set(inMonth.filter((o) => o.orderNo === 1).map((o) => o.customerId));
    return { label: bucketLabel(m, 'month'), fresh: first.size, back: everyone.size - first.size };
  });

  const typeRows = TYPES.map((t) => {
    const m = measure(ofType(t));
    return { type: t, customers: m.customers, orders: m.orders, revenue: m.revenue, avgOrder: m.avgOrder, share: pct(m.revenue, now.revenue) };
  });

  const members = rows.filter((c) => c.tier !== NO_TIER);
  const others = rows.filter((c) => c.tier === NO_TIER);
  const mem = { group: 'Members (have a tier)', ...measure(members), repeat: repeatRate(members) };
  const non = { group: 'Non-members (no tier)', ...measure(others), repeat: repeatRate(others) };
  const memberBuys = bought.filter((r) => byId[r.customerId].tier !== NO_TIER);
  const otherBuys = bought.filter((r) => byId[r.customerId].tier === NO_TIER);
  const only = (list, c) => list.filter((r) => r.category === c);
  const catRows = categories.map((c) => {
    const mine = only(bought, c);
    const revenue = addMoney(mine, 'revenue');
    return {
      category: c,
      customers: mine.length,
      units: add(mine, 'units'),
      revenue,
      share: pct(revenue, now.revenue),
      members: pct(addMoney(only(memberBuys, c), 'revenue'), addMoney(memberBuys, 'revenue')),
      others: pct(addMoney(only(otherBuys, c), 'revenue'), addMoney(otherBuys, 'revenue')),
    };
  }).filter((r) => r.customers > 0).sort((a, b) => b.revenue - a.revenue);
  const topFor = (key) => [...catRows].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
  const rewardRows = tiers.filter((t) => rewards.some((r) => r.tier === t)).map((t) => {
    const mine = rewards.filter((r) => r.tier === t);
    const count = (s) => mine.filter((r) => r.status === s).length;
    return {
      tier: t,
      issued: mine.length,
      used: count('Used'),
      available: count('Available'),
      expired: count('Expired'),
      rate: pct(count('Used'), mine.length),
      saved: addMoney(mine, 'saved'),
    };
  });

  const notes = [];
  if (comparing && was.buyers > 0 && now.buyers !== was.buyers) {
    const up = now.buyers > was.buyers;
    notes.push({
      tone: up ? 'good' : 'bad',
      text: `${now.buyers} customers bought in this period, ${up ? 'up' : 'down'} from ${was.buyers} in ${compare === 'lastyear' ? 'the same period last year' : 'the previous period'}.`,
    });
  }
  if (repeat != null) {
    notes.push(repeat < LOW_REPEAT
      ? { tone: 'bad', text: `Only ${formatPercent(repeat)} of the customers who bought have ordered more than once. An offer on the second order would give first-time buyers a reason to come back.` }
      : { tone: 'good', text: `${formatPercent(repeat)} of the customers who bought have ordered more than once.` });
  }
  if (lost.length) {
    notes.push({
      tone: 'bad',
      text: `${lost.length} customer(s) who bought before did not order in this period. They have spent ${formatMoney(addMoney(lost, 'spentAllTime'))} with the store so far, so they are worth a win-back offer.`,
    });
  }
  if (mem.buyers > 0 && non.buyers > 0) {
    notes.push(`Members placed ${perEach(mem.perCustomer)} orders each and spent ${formatMoney(mem.avgOrder)} per order. Non-members placed ${perEach(non.perCustomer)} and spent ${formatMoney(non.avgOrder)}.`);
    const a = topFor('members');
    const b = topFor('others');
    if (a && b) {
      notes.push(a.category === b.category
        ? `${a.category} is the top category for members and non-members alike.`
        : `Members spend most on ${a.category} while non-members spend most on ${b.category}, so offers can be aimed at each group.`);
    }
  }
  if (rewards.length) {
    const open = rewards.filter((r) => r.status === 'Available').length;
    notes.push({
      tone: open > used.length ? 'bad' : 'neutral',
      text: `${used.length} of ${rewards.length} tier reward(s) have been used. Still unused and in date: ${open}.`,
    });
  }

  const customerColumns = [
    { key: 'name', label: 'Customer', render: (c) => <Link to={`/staff/reports/customers/${c.customerId}`}>{c.name}</Link> },
    { key: 'tier', label: 'Tier' },
    {
      key: 'type', label: 'Type',
      render: (c) => (c.type === 'Did not return'
        ? <strong style={{ color: 'var(--color-danger)' }}>{c.type}</strong>
        : c.type),
    },
    { key: 'orders', label: 'Orders', numeric: true, total: formatNumber(now.orders) },
    { key: 'spent', label: 'Spent', numeric: true, render: (c) => formatMoney(c.spent), total: formatMoney(now.revenue) },
    {
      key: 'ordersToDate', label: 'Orders to date', numeric: true,
      render: (c) => c.ordersBefore + c.orders,
      sortValue: (c) => c.ordersBefore + c.orders,
    },
    { key: 'favorite', label: 'Buys most', render: (c) => c.favorite || '' },
    {
      key: 'lastOrder', label: 'Last order',
      render: (c) => (c.lastOrder ? shortDate(c.lastOrder, true) : 'None on record'),
      sortValue: (c) => c.lastOrder,
    },
    { key: 'pointsEarned', label: 'Points earned', numeric: true, render: (c) => formatNumber(c.pointsEarned), total: formatNumber(pointsEarned) },
    { key: 'points', label: 'Points held', numeric: true, render: (c) => formatNumber(c.points), total: formatNumber(pointsHeld) },
  ];

  const orders = allOrders.filter((o) => orderKind === 'All' || (orderKind === 'First' ? o.orderNo === 1 : o.orderNo > 1));
  const orderColumns = [
    { key: 'orderId', label: 'Order', render: (o) => <Link to={`/staff/reports/sales/orders/${o.orderId}`}>#{o.orderId}</Link>, sortValue: (o) => o.orderId },
    { key: 'saleDate', label: 'Date', render: (o) => shortDate(o.saleDate, true) },
    { key: 'customer', label: 'Customer', render: (o) => <Link to={`/staff/reports/customers/${o.customerId}`}>{o.customer}</Link> },
    { key: 'tier', label: 'Tier' },
    {
      key: 'orderNo', label: "Customer's order",
      render: (o) => (o.orderNo === 1 ? 'First order' : `Repeat (no. ${o.orderNo})`),
      sortValue: (o) => o.orderNo,
      csv: (o) => (o.orderNo === 1 ? 'First order' : `Repeat (no. ${o.orderNo})`),
    },
    { key: 'units', label: 'Units', numeric: true, total: formatNumber(add(orders, 'units')) },
    { key: 'total', label: 'Total', numeric: true, render: (o) => formatMoney(o.total), total: formatMoney(addMoney(orders, 'total')) },
  ];


  const groupColumns = [
    { key: 'group', label: 'Group' },
    { key: 'customers', label: 'Customers', numeric: true },
    { key: 'buyers', label: 'Bought', numeric: true },
    { key: 'orders', label: 'Orders', numeric: true },
    { key: 'perCustomer', label: 'Orders per customer', numeric: true, render: (g) => perEach(g.perCustomer) },
    { key: 'avgOrder', label: 'Avg order', numeric: true, render: (g) => formatMoney(g.avgOrder) },
    { key: 'spendEach', label: 'Spend per customer', numeric: true, render: (g) => formatMoney(g.spendEach) },
    { key: 'repeat', label: 'Repeat rate', numeric: true, render: (g) => formatPercent(g.repeat) },
  ];

  return page(
    <>
      <p className="card-muted" style={{ marginBottom: 16 }}>
        Showing {rows.length} of {data.customers.length} customers. {now.buyers} of them bought
        between {shortDate(period.from, true)} and {shortDate(period.to, true)}:
        {' '}{formatNumber(now.orders)} orders worth {formatMoney(now.revenue)}.
      </p>
      <KpiGrid>
        <JumpTo target="customers">
          <KpiCard label="Active customers" value={formatNumber(now.buyers)} change={change('buyers')} previous={before('buyers', formatNumber)}
            hint={`${fresh.length} new, ${back.length} returning`} />
        </JumpTo>
        <JumpTo target="customers">
          <KpiCard label="Orders per customer" value={perEach(now.perCustomer)} change={change('perCustomer')} previous={before('perCustomer', perEach)}
            hint="Orders divided by the customers who bought." />
        </JumpTo>
        <JumpTo target="orders">
          <KpiCard label="Average order value" value={formatMoney(now.avgOrder)} change={change('avgOrder')} previous={before('avgOrder', formatMoney)}
            hint="After discounts, before tax." />
        </JumpTo>
        <JumpTo target="customers">
          <KpiCard label="Spend per customer" value={formatMoney(now.spendEach)} change={change('spendEach')} previous={before('spendEach', formatMoney)}
            hint="The Spent column divided by the customers who bought." />
        </JumpTo>
        <JumpTo target="members">
          <KpiCard label="Repeat customer rate" value={formatPercent(repeat)}
            hint="Buyers with more than one order to date." />
        </JumpTo>
        <JumpTo target="new-returning">
          <KpiCard label="Retention rate" value={formatPercent(retention)}
            hint={`${back.length} of ${back.length + lost.length} earlier customers ordered again.`} />
        </JumpTo>
        <JumpTo target="tier-rewards">
          <KpiCard label="Reward redemption rate" value={formatPercent(redemption)}
            hint={rewards.length ? `${used.length} of ${rewards.length} tier rewards used.` : 'No tier rewards issued yet.'} />
        </JumpTo>
        <JumpTo target="customers">
          <KpiCard label="Points earned" value={formatNumber(pointsEarned)}
            hint={`${formatNumber(pointsBack)} taken back by refunds.`} />
        </JumpTo>
      </KpiGrid>
      <div style={{ marginTop: 24 }}>
        <InsightsPanel insights={notes} />
      </div>
      <Anchor id="new-returning">
        <ReportSection title="New and returning customers" caption="New = first order ever is in this period. Returning = also ordered before it. Did not return = ordered before it but not during it.">
          <StackedBars data={trend} caption="Customers who bought each month" emptyText="No orders in this period."
            series={[{ key: 'fresh', label: 'New' }, { key: 'back', label: 'Returning' }]} />
          <div style={{ height: 16 }} />
          <SegmentedBar caption="Customers by type" emptyText="No customers match these filters."
            parts={typeRows.map((r) => ({ label: r.type, value: r.customers, color: r.type === 'No orders yet' ? 'muted' : undefined }))} />
          <div style={{ height: 16 }} />
          <Table rowKey="type" rows={typeRows} columns={[
            { key: 'type', label: 'Customer type' },
            { key: 'customers', label: 'Customers', numeric: true },
            { key: 'orders', label: 'Orders', numeric: true },
            { key: 'revenue', label: 'Revenue', numeric: true, render: (r) => formatMoney(r.revenue) },
            { key: 'avgOrder', label: 'Avg order', numeric: true, render: (r) => formatMoney(r.avgOrder) },
            { key: 'share', label: 'Share of revenue', numeric: true, render: (r) => formatPercent(r.share) },
          ]} />
          <p className="card-muted" style={{ marginTop: 8 }}>New plus Returning is the Active customers card. Retention rate = Returning / (Returning + Did not return).</p>
        </ReportSection>
      </Anchor>
      <Anchor id="members">
        <ReportSection title="Members and non-members" caption="A member is a customer who holds a tier today. Tiers are earned by buying, so members are expected to look better; this shows how far apart the two groups are.">
          <Table rowKey="group" rows={[mem, non]} columns={groupColumns} />
          <p className="card-muted" style={{ marginTop: 8 }}>Repeat rate = buyers with more than one order to date / buyers. Use the Loyalty tier filter to look at one tier.</p>
        </ReportSection>
      </Anchor>
      <Anchor id="categories">
        <ReportSection title="What customers buy" caption="Revenue by category for the customers shown, and how members and non-members split their spending.">
          <Table rowKey="category" rows={catRows} empty="No orders in this period." columns={[
            { key: 'category', label: 'Category' },
            { key: 'customers', label: 'Customers', numeric: true },
            { key: 'units', label: 'Units', numeric: true },
            { key: 'revenue', label: 'Revenue', numeric: true, render: (r) => formatMoney(r.revenue) },
            { key: 'share', label: 'Share of revenue', numeric: true, render: (r) => formatPercent(r.share) },
            { key: 'members', label: 'Of member spend', numeric: true, render: (r) => formatPercent(r.members) },
            { key: 'others', label: 'Of non-member spend', numeric: true, render: (r) => formatPercent(r.others) },
          ]} />
          {catRows.length > 0 && <p className="card-muted" style={{ marginTop: 8 }}>These category revenues add up to {formatMoney(now.revenue)}, the revenue of the customers shown.</p>}
        </ReportSection>
      </Anchor>
      <Anchor id="tier-rewards">
        <ReportSection title="Tier rewards" caption="Reaching a new tier gives the customer 15% off the next order. Redemption rate = rewards used / rewards issued up to the end date.">
          <Table rowKey="tier" rows={rewardRows} empty="No tier rewards have been issued to these customers yet." columns={[
            { key: 'tier', label: 'Tier' },
            { key: 'issued', label: 'Issued', numeric: true },
            { key: 'used', label: 'Used', numeric: true },
            { key: 'available', label: 'Not used yet', numeric: true },
            { key: 'expired', label: 'Expired', numeric: true },
            { key: 'rate', label: 'Redemption rate', numeric: true, render: (r) => formatPercent(r.rate) },
            { key: 'saved', label: 'Saved by customers', numeric: true, render: (r) => formatMoney(r.saved) },
          ]} />
          <p className="card-muted" style={{ marginTop: 8 }}>
            Points: {formatNumber(pointsEarned)} earned and {formatNumber(pointsBack)} taken back in this period, {formatNumber(pointsHeld)} held today by the customers shown.
          </p>
        </ReportSection>
      </Anchor>
      <div style={{ height: 24 }} />
      <Anchor id="customers">
        <RecordsTable
          title="Customers in this report"
          noun="customers"
          rows={rows}
          allCount={data.customers.length}
          columns={customerColumns}
          rowKey="customerId"
          totalLabel={`Total of ${rows.length} ${rows.length === 1 ? 'customer' : 'customers'}`}
          empty="No customers match these filters."
          csvName="customers-records.csv"
          note="These are the customers behind every number above. Orders and Spent cover the chosen dates; Orders to date also counts earlier orders. The total row matches the line under the filters and the Points earned card."
        />
      </Anchor>
      <div style={{ height: 24 }} />
      <Anchor id="orders">
        <RecordsTable
          title="Orders in this report"
          noun="orders"
          rows={orders}
          allCount={data.orders.length}
          columns={orderColumns}
          rowKey="orderId"
          totalLabel={`Total of ${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
          empty="No completed orders match these filters."
          csvName="customers-orders.csv"
          controls={(
            <Field label="Orders" as="select" value={orderKind} onChange={(e) => setOrderKind(e.target.value)}>
              <option value="All">All</option>
              <option value="First">First orders</option>
              <option value="Repeat">Repeat orders</option>
            </Field>
          )}
          note="Completed orders placed in the chosen dates by the customers shown. With Orders set to All, the total row matches the Orders and Spent totals of the customers table."
        />
      </Anchor>
    </>
  );
}
