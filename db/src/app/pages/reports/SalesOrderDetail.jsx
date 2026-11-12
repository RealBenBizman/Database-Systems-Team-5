// One order, opened from an order number on the sales report (managers only). Written by Terry (Part 2).
// Uses the team's existing manager endpoint: GET /api/manager/orders/<id>
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Button, Card, PageHeader, Spinner, ErrorBanner, EmptyState, Table } from '../../../shared/ui.jsx';
import { KpiGrid, KpiCard, ReportSection, formatMoney, formatNumber } from '../../../shared/reports.jsx';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// small coloured label for the order status
function StatusPill({ status }) {
  const color = status === 'completed' ? '#199e70' : status === 'voided' ? 'var(--color-danger)' : '#c98500';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 14, fontWeight: 600,
      border: `1px solid ${color}`, color,
    }}>
      {cap(status)}
    </span>
  );
}

// one line of the totals box
function TotalRow({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '4px 0', fontWeight: strong ? 700 : 400, fontSize: strong ? 18 : 16 }}>
      <span style={{ color: strong ? 'inherit' : 'var(--color-muted)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function SalesOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/api/manager/orders/${id}`).then(setData).catch(setError);
  }, [id]);

  // back to the report, with its filters still set
  const back = <Button variant="ghost" onClick={() => navigate(-1)}>&larr; Sales report</Button>;

  if (error && error.status === 404) return <EmptyState title="Order not found" action={back} />;
  if (error) return <><ErrorBanner error={error} />{back}</>;
  if (!data) return <Spinner />;

  const { order: o, items, payments, points } = data;
  const units = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const saved = items.reduce((s, i) => s + Number(i.discountAmount || 0), 0);

  return (
    <>
      <div style={{ marginBottom: 8 }}>{back}</div>
      <PageHeader title={`Order #${o.orderId}`} subtitle={`${o.orderDate} · ${o.customerName}`}>
        <StatusPill status={o.status} />
      </PageHeader>

      <KpiGrid>
        <KpiCard label="Total paid" value={formatMoney(o.total)} />
        <KpiCard label="Items" value={formatNumber(units)} />
        <KpiCard label="Discounts saved" value={formatMoney(saved)} />
        <KpiCard label="Tax" value={formatMoney(o.tax)} />
        <KpiCard label="Points earned" value={formatNumber(points.pointsEarned)}
          hint={points.pointsTakenBack ? `${formatNumber(points.pointsTakenBack)} taken back by a refund` : undefined} />
      </KpiGrid>

      <ReportSection title="Items">
        <Table rowKey="productId" rows={items} empty="No items." columns={[
          { key: 'name', label: 'Product', render: (i) => <><div>{i.name}</div><small className="card-muted">{i.sku}</small></> },
          { key: 'quantity', label: 'Qty', numeric: true },
          { key: 'unitPrice', label: 'Price', numeric: true, render: (i) => formatMoney(i.unitPrice) },
          { key: 'discountAmount', label: 'Discount', render: (i) => (i.discountAmount > 0
            ? <><div>{i.discountName || 'Discount'}</div><small style={{ color: '#199e70' }}>-{formatMoney(i.discountAmount)}</small></>
            : '') },
          { key: 'lineTotal', label: 'Total', numeric: true, render: (i) => <strong>{formatMoney(i.lineTotal)}</strong> },
        ]} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <div style={{ minWidth: 260 }}>
            <TotalRow label="Subtotal" value={formatMoney(o.subtotal)} />
            {saved > 0 && <TotalRow label="Discounts" value={`-${formatMoney(saved)}`} />}
            <TotalRow label="Tax" value={formatMoney(o.tax)} />
            <div style={{ borderTop: '1px solid var(--color-muted)', marginTop: 6, paddingTop: 6 }}>
              <TotalRow label="Total" value={formatMoney(o.total)} strong />
            </div>
          </div>
        </div>
      </ReportSection>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 24 }}>
        <Card title="Customer">
          <p style={{ margin: 0, fontWeight: 600 }}>{o.customerName}</p>
          <p className="card-muted" style={{ overflowWrap: 'anywhere' }}>{o.email}</p>
        </Card>
        <Card title="Shipping">
          <p style={{ margin: 0 }}>
            {o.shipName || 'Not set'}<br />
            {o.shipStreet}{o.shipApt ? `, ${o.shipApt}` : ''}<br />
            {o.shipCity}{o.shipCity ? ', ' : ''}{o.shipState} {o.shipZip}
          </p>
          <p className="card-muted">
            {o.trackingNumber || 'No tracking'}<br />
            {o.estimatedArrival ? `Arrives ${o.estimatedArrival}` : ''}
          </p>
        </Card>
        <Card title="Payment">
          {payments.length === 0 ? <p className="card-muted">No payment on record.</p> : payments.map((p) => (
            <div key={p.paymentId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{cap(p.method)} •••• {p.cardLast4}</span>
              <strong>{formatMoney(p.amount)}</strong>
            </div>
          ))}
          {payments[0] && <p className="card-muted" style={{ marginTop: 8 }}>{payments[0].paidAt}</p>}
        </Card>
      </div>
    </>
  );
}