import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../shared/api.js';
import { Button, Card, PageHeader, Spinner, ErrorBanner } from '../../shared/ui.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const day = (d) => (d ? String(d).slice(0, 10) : '');

export default function OrderConfirmation() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/api/orders/${id}`).then(setData).catch(setError);
  }, [id]);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading your order..." />;
  const o = data.order;

  return (
    <>
      <PageHeader title="Thank you for your order!" subtitle={`Order #${o.Transaction_id}`} />
      <Card title="Summary">
        <p>Total paid: <strong>{money(o.Total)}</strong></p>
        <p>Tracking number: {o.Tracking_number}</p>
        <p>Estimated arrival: {day(o.Estimated_arrival)}</p>
      </Card>
      <div className="row">
        <Button to={`/orders/${o.Transaction_id}`}>View order details</Button>
        <Button variant="secondary" to="/shop">Keep shopping</Button>
      </div>
    </>
  );
}