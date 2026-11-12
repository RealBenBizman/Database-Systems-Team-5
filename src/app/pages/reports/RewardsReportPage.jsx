// Rewards report (managers): how many points are out there, who holds them, and the top earners.
// The numbers come from GET /api/reports/rewards, built on the rewards report view (all time).
import { useState } from 'react';
import { api } from '../../../shared/api.js';
import { Button, Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';
import { date, money, useLoad } from '../storefront/components.jsx';
import '../checkout/Orders.css';
import '../returns/Returns.css';

const count = (n) => Number(n || 0).toLocaleString('en-US');

export default function RewardsReportPage() {
  const [top, setTop] = useState('10');
  const report = useLoad(() => api.get('/api/reports/rewards', { top }), [top]);
  const shown = report.data;

  const header = <PageHeader title="Rewards report" subtitle="Loyalty points across all customers, all time. Spent amounts are after discounts and before tax." />;
  if (report.loading && !shown) return <>{header}<Spinner label="Loading the report..." /></>;
  if (report.error && !shown) return <>{header}<ErrorBanner error={report.error} /><Button variant="secondary" onClick={report.reload}>Try again</Button></>;

  const { totals, tiers, topEarners } = shown;
  const biggest = Math.max(1, ...tiers.map((t) => Number(t.customers)));

  const tierColumns = [
    { key: 'tier', label: 'Tier' },
    { key: 'minPoints', label: 'Points needed', numeric: true, render: (t) => (t.minPoints === null || t.minPoints === undefined ? '' : count(t.minPoints)) },
    { key: 'customers', label: 'Customers', numeric: true, render: (t) => count(t.customers) },
    { key: 'share', label: 'Share', render: (t) => <span className="rw-share-cell"><span className="rw-share" style={{ width: `${Math.round((Number(t.customers) / biggest) * 100)}%` }} /></span> },
    { key: 'points', label: 'Points held', numeric: true, render: (t) => count(t.points) },
  ];
  const earnerColumns = [
    { key: 'name', label: 'Customer' },
    { key: 'tier', label: 'Tier', render: (e) => e.tier || 'No tier' },
    { key: 'orders', label: 'Orders', numeric: true, render: (e) => count(e.orders) },
    { key: 'totalSpent', label: 'Spent', numeric: true, render: (e) => money(e.totalSpent) },
    { key: 'pointsEarned', label: 'Earned', numeric: true, render: (e) => count(e.pointsEarned) },
    { key: 'pointsTakenBack', label: 'Taken back', numeric: true, render: (e) => count(e.pointsTakenBack) },
    { key: 'balance', label: 'Balance', numeric: true, render: (e) => count(e.balance) },
    { key: 'lastActivity', label: 'Last activity', render: (e) => (e.lastActivity ? date(e.lastActivity) : '') },
  ];

  return <>
    {header}
    <ErrorBanner error={report.error} />
    <div className="co-kpis">
      <Card title={count(totals.customers)}><p className="card-muted">Customers</p></Card>
      <Card title={count(totals.pointsOutstanding)}><p className="card-muted">Points outstanding</p></Card>
      <Card title={count(totals.pointsIssued)}><p className="card-muted">Points issued</p></Card>
      <Card title={count(totals.pointsTakenBack)}><p className="card-muted">Taken back by refunds</p></Card>
      <Card title={money(totals.totalSpent)}><p className="card-muted">Total spent</p></Card>
    </div>

    <section className="co-section" aria-label="Customers by tier">
      <h2>Customers by tier</h2>
      <div className="co-nowrap"><Table columns={tierColumns} rows={tiers} rowKey="tier" empty="No tiers to show." /></div>
    </section>

    <section className="co-section" aria-label="Top earners">
      <h2>Top earners</h2>
      <div className="co-report-form">
        <Field label="Show" id="rewards-top" as="select" value={top} onChange={(event) => setTop(event.target.value)}>
          {['5', '10', '25', '50'].map((n) => <option key={n} value={n}>Top {n}</option>)}
        </Field>
      </div>
      <div className="co-nowrap"><Table columns={earnerColumns} rows={topEarners} rowKey="customerId" empty="No customers have earned points yet." /></div>
    </section>
  </>;
}
