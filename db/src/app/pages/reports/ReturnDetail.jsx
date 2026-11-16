// One return, opened from a return number on the returns report (managers only).
// Uses the team's existing endpoint: GET /api/returns/<id> (the return, its items, the customer and who handled it).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Button, Card, PageHeader, Spinner, ErrorBanner, EmptyState, Table } from '../../../shared/ui.jsx';
import { KpiGrid, KpiCard, ReportSection, formatMoney, formatNumber, shortDate } from '../../../shared/reports.jsx';
import { STATUS_LABEL } from './returnsMetrics.js';

const STATUS_COLOR = {
  requested: '#c98500',
  approved: '#4a8fe0',
  refunded: '#199e70',
  denied: 'var(--color-danger)',
};

// small coloured label for the return status
function StatusPill({ status }) {
  const color = STATUS_COLOR[status] || 'var(--color-muted)';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 14, fontWeight: 600,
      border: `1px solid ${color}`, color,
    }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// whole calendar days from one date to another (dates as 'YYYY-MM-DD...' text)
function daysBetween(from, to) {
  const a = Date.parse(String(from).slice(0, 10));
  const b = Date.parse(String(to).slice(0, 10));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86400000)) : null;
}

export default function ReturnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.get(`/api/returns/${id}`).then(setData).catch(setError);
  }, [id]);

  // back to the report this return was opened from, with its filters still set
  const back = <Button variant="ghost" onClick={() => navigate(-1)}>&larr; Back to the report</Button>;

  if (error && error.status === 404) return <EmptyState title="Return not found" action={back} />;
  if (error) return <><ErrorBanner error={error} />{back}</>;
  if (!data) return <Spinner />;

  const r = data.return;
  const items = r.items || [];
  const units = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const open = daysBetween(r.requestedAt, r.refundedAt || today);
  const openLabel = r.status === 'denied' ? 'Closed' : r.status === 'refunded' ? 'Days to refund' : 'Days waiting';

  return (
    <>
      <div style={{ marginBottom: 8 }}>{back}</div>
      <PageHeader title={`Return #${r.id}`} subtitle={`Requested ${shortDate(r.requestedAt, true)} · ${r.customerName}`}>
        <StatusPill status={r.status} />
      </PageHeader>

      <KpiGrid>
        <KpiCard label="Refund amount" value={formatMoney(r.refundTotal)}
          hint={r.status === 'refunded' ? 'Refunded, tax included.' : r.status === 'denied' ? 'Denied, nothing refunded.' : 'Not refunded yet.'} />
        <KpiCard label="Units" value={formatNumber(units)} hint={r.status === 'denied' ? 'Not counted as returned.' : undefined} />
        <KpiCard label={openLabel} value={r.status === 'denied' ? 'Denied' : (open === null ? '-' : formatNumber(open))} />
      </KpiGrid>

      <ReportSection title="Items returned">
        <Table rowKey="productId" rows={items} empty="No items." columns={[
          { key: 'name', label: 'Product' },
          { key: 'quantity', label: 'Qty', numeric: true },
          { key: 'refundAmount', label: 'Refund', numeric: true, render: (i) => formatMoney(i.refundAmount) },
        ]} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <strong>Total refund {formatMoney(r.refundTotal)}</strong>
        </div>
      </ReportSection>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 24 }}>
        <Card title="What the customer wrote">
          <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{r.reason || 'No reason given.'}</p>
        </Card>
        <Card title="Order and customer">
          <p style={{ margin: 0 }}>
            Order <Link to={`/staff/reports/sales/orders/${r.orderId}`}>#{r.orderId}</Link>
          </p>
          <p style={{ margin: '4px 0 0' }}>
            Customer <Link to={`/staff/reports/customers/${r.customerId}`}>{r.customerName}</Link>
          </p>
        </Card>
        <Card title="Handling">
          <p style={{ margin: 0 }}>{r.handledBy ? `Handled by ${r.handledBy}` : 'Not handled yet'}</p>
          <p className="card-muted">{r.refundedAt ? `Refunded ${shortDate(r.refundedAt, true)}` : STATUS_LABEL[r.status]}</p>
        </Card>
      </div>
    </>
  );
}
