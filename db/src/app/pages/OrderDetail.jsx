import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../shared/api.js';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorBanner, Table } from '../../shared/ui.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const day = (d) => (d ? String(d).slice(0, 10) : '');

export default function OrderDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/api/orders/${id}`).then(setData).catch(setError);
  }, [id]);

  if (error && error.status === 404) {
    return <EmptyState title="Order not found" action={<Button to="/orders">Back to my orders</Button>} />;
  }
  if (error) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading order..." />;
  const o = data.order;

  return (
    <>
      <PageHeader title={`Order #${o.Transaction_id}`} subtitle={`Placed ${day(o.Transaction_date)} · ${o.Status}`} />

      <Card title="Items">
        <Table rowKey="Name" rows={data.items} columns={[
          { key: 'Name', label: 'Product' },
          { key: 'Quantity', label: 'Qty', numeric: true },
          { key: 'Unit_price', label: 'Price', numeric: true, render: (r) => money(r.Unit_price) },
          { key: 'Discount_amount', label: 'Discount', numeric: true, render: (r) => money(r.Discount_amount) },
          { key: 'Line_total', label: 'Total', numeric: true, render: (r) => money(r.Line_total) },
        ]} />
        <p>Subtotal: {money(o.Subtotal)}<br />Tax: {money(o.Tax_amount)}<br /><strong>Total: {money(o.Total)}</strong></p>
      </Card>

      <Card title="Shipping">
        <p>{o.Ship_name}<br />{o.Ship_street}{o.Ship_apt ? `, ${o.Ship_apt}` : ''}<br />{o.Ship_city}, {o.Ship_state} {o.Ship_zip}</p>
        <p>Tracking: {o.Tracking_number}<br />Estimated arrival: {day(o.Estimated_arrival)}</p>
      </Card>

      <Card title="Payment">
        {data.payments.map((p, i) => (
          <p key={i}>{p.Method} card ending {p.Card_last4}: {money(p.Amount)}</p>
        ))}
      </Card>

      <div className="row">
        <Button variant="secondary" to="/orders">Back to my orders</Button>
        {o.Status === 'completed' && <Button to={`/returns/new?order=${o.Transaction_id}`}>Request a return</Button>}
      </div>
    </>
  );
}