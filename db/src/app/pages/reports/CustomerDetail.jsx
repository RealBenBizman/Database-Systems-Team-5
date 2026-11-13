// One customer, opened from a customer name on the customer behavior report or a return (managers only).
// Uses the team's existing manager endpoint: GET /api/manager/customers/<id> (profile, contact, points and orders).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Button, Card, PageHeader, Spinner, ErrorBanner, EmptyState, Table } from '../../../shared/ui.jsx';
import { KpiGrid, KpiCard, ReportSection, formatMoney, formatNumber, shortDate } from '../../../shared/reports.jsx';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.get(`/api/manager/customers/${id}`).then(setData).catch(setError);
  }, [id]);

  // back to the page this customer was opened from, with its filters still set
  const back = <Button variant="ghost" onClick={() => navigate(-1)}>&larr; Back to the report</Button>;

  if (error && error.status === 404) return <EmptyState title="Customer not found" action={back} />;
  if (error) return <><ErrorBanner error={error} />{back}</>;
  if (!data) return <Spinner />;

  const { customer: c, addresses, phones, pointsHistory, orders } = data;
  const completed = orders.filter((o) => o.status === 'completed');
  const spent = completed.reduce((s, o) => s + Number(o.total || 0), 0);
  const home = addresses.find((a) => a.isDefault) || addresses[0];

  return (
    <>
      <div style={{ marginBottom: 8 }}>{back}</div>
      <PageHeader title={`${c.firstName} ${c.lastName}`} subtitle={`Customer #${c.customerId} · member since ${shortDate(c.createdDate, true)}`} />

      <KpiGrid>
        <KpiCard label="Loyalty tier" value={c.tier || 'No tier'} />
        <KpiCard label="Points held" value={formatNumber(c.points)} />
        <KpiCard label="Completed orders" value={formatNumber(completed.length)} />
        <KpiCard label="Total spent" value={formatMoney(spent)} hint="Completed orders, tax included." />
      </KpiGrid>

      <ReportSection title="Orders" caption={orders.length >= 100 ? 'The 100 most recent orders.' : undefined}>
        <Table rowKey="orderId" rows={orders} empty="This customer has no orders." columns={[
          { key: 'orderId', label: 'Order', render: (o) => <Link to={`/staff/reports/sales/orders/${o.orderId}`}>#{o.orderId}</Link> },
          { key: 'orderDate', label: 'Date', render: (o) => shortDate(o.orderDate, true) },
          { key: 'status', label: 'Status', render: (o) => cap(o.status) },
          { key: 'total', label: 'Total', numeric: true, render: (o) => formatMoney(o.total) },
        ]} />
      </ReportSection>

      <ReportSection title="Points history" caption={pointsHistory.length >= 50 ? 'The 50 most recent changes.' : undefined}>
        <Table rowKey="txnId" rows={pointsHistory} empty="No points yet." columns={[
          { key: 'createdAt', label: 'Date', render: (p) => shortDate(p.createdAt, true) },
          { key: 'reason', label: 'Reason' },
          { key: 'orderId', label: 'Order', render: (p) => (p.orderId ? <Link to={`/staff/reports/sales/orders/${p.orderId}`}>#{p.orderId}</Link> : '') },
          { key: 'pointsChange', label: 'Points', numeric: true, render: (p) => `${p.pointsChange > 0 ? '+' : ''}${formatNumber(p.pointsChange)}` },
        ]} />
      </ReportSection>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 24 }}>
        <Card title="Contact">
          <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{c.email}</p>
          <p className="card-muted">{phones.length ? phones.join(', ') : 'No phone on record.'}</p>
        </Card>
        <Card title="Address">
          {home ? (
            <p style={{ margin: 0 }}>
              {home.recipient}<br />
              {home.street}{home.apt ? `, ${home.apt}` : ''}<br />
              {home.city}, {home.state} {home.zip}
            </p>
          ) : <p className="card-muted">No address on record.</p>}
        </Card>
      </div>
    </>
  );
}
