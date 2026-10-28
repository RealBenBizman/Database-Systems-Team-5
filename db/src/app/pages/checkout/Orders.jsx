// "My orders" list. Written by Terry (Part 2).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { PageHeader, Spinner, ErrorBanner, Table } from '../../../shared/ui.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const day = (d) => (d ? String(d).slice(0, 10) : '');

export default function Orders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/orders').then((r) => setOrders(r.orders)).catch(setError);
  }, []);

  if (error) return <ErrorBanner error={error} />;
  if (!orders) return <Spinner label="Loading your orders..." />;

  return (
    <>
      <PageHeader title="My orders" />
      <Table rowKey="Transaction_id" rows={orders} empty="You have no orders yet." columns={[
        { key: 'Transaction_id', label: 'Order', render: (r) => <Link to={`/orders/${r.Transaction_id}`}>#{r.Transaction_id}</Link> },
        { key: 'Transaction_date', label: 'Date', render: (r) => day(r.Transaction_date) },
        { key: 'Items', label: 'Items', numeric: true },
        { key: 'Status', label: 'Status' },
        { key: 'Total', label: 'Total', numeric: true, render: (r) => money(r.Total) },
      ]} />
    </>
  );
}
