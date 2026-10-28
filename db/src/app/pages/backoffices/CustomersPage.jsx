// Customer lookup (managers, read only): find a customer or an order and see the details.
// Nothing here can change data. Password hashes are never sent by the server.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Button, Card, ErrorBanner, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const money = (n) => '$' + Number(n || 0).toFixed(2);

function SearchPanel({ kind, onOpen }) {
  const customers = kind === 'customers';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);   // null = still loading
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    api.get(customers ? '/api/manager/customers' : '/api/manager/orders', { q: search })
      .then((d) => { if (current) { setRows(customers ? d.customers : d.orders); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [kind, search, customers]);

  const columns = customers
    ? [
        { key: 'customerId', label: 'ID' },
        { key: 'name', label: 'Name', render: (c) => c.firstName + ' ' + c.lastName },
        { key: 'email', label: 'Email' },
        { key: 'tier', label: 'Tier', render: (c) => c.tier || 'No tier' },
        { key: 'points', label: 'Points', numeric: true },
        { key: 'view', label: '', render: (c) => <Button type="button" variant="secondary" onClick={() => onOpen('customer', c.customerId)}>View</Button> },
      ]
    : [
        { key: 'orderId', label: 'Order' },
        { key: 'orderDate', label: 'Date' },
        { key: 'customerName', label: 'Customer' },
        { key: 'status', label: 'Status' },
        { key: 'trackingNumber', label: 'Tracking', render: (o) => o.trackingNumber || '' },
        { key: 'total', label: 'Total', numeric: true, render: (o) => money(o.total) },
        { key: 'view', label: '', render: (o) => <Button type="button" variant="secondary" onClick={() => onOpen('order', o.orderId)}>View</Button> },
      ];

  return (
    <>
      <form className="row" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <div className="field" style={{ margin: 0, minWidth: 340 }}>
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
            placeholder={customers ? 'Name, email or 7-digit customer id' : 'Order id, tracking number, customer name or email'}
          />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <ErrorBanner>{error}</ErrorBanner>
      {rows === null && !error ? <Spinner /> : <Table columns={columns} rows={rows || []} rowKey={customers ? 'customerId' : 'orderId'} empty={customers ? 'No customers found.' : 'No orders found.'} />}
      <p className="card-muted" style={{ marginTop: 8 }}>Shows up to 50 results, newest first.</p>
    </>
  );
}

function Loaded({ url, children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setData(null);
    setError('');
    api.get(url).then((d) => { if (current) setData(d); }).catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [url]);
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (data === null) return <Spinner />;
  return children(data);
}

function CustomerDetail({ id, onOpen }) {
  return (
    <Loaded url={'/api/manager/customers/' + id}>
      {({ customer: c, addresses, phones, pointsHistory, orders }) => (
        <div className="stack">
          <Card title={c.firstName + ' ' + c.lastName}>
            <p>{c.email}</p>
            <p className="card-muted">
              Customer {c.customerId} since {c.createdDate} | {c.points} points | {c.tier || 'No tier'} |
              {' '}offers {c.notifyOffers ? 'on' : 'off'}, cart reminders {c.notifyCart ? 'on' : 'off'}
            </p>
            <p className="card-muted">Phones: {phones.length ? phones.join(', ') : 'none'}</p>
          </Card>

          <h3>Addresses</h3>
          <Table
            columns={[
              { key: 'recipient', label: 'Recipient' },
              { key: 'street', label: 'Street', render: (a) => a.street + (a.apt ? ', ' + a.apt : '') },
              { key: 'city', label: 'City' },
              { key: 'state', label: 'State' },
              { key: 'zip', label: 'Zip' },
              { key: 'isDefault', label: 'Default', render: (a) => (a.isDefault ? 'Yes' : '') },
            ]}
            rows={addresses} rowKey="addressId" empty="No addresses."
          />

          <h3>Orders</h3>
          <Table
            columns={[
              { key: 'orderId', label: 'Order' },
              { key: 'orderDate', label: 'Date' },
              { key: 'status', label: 'Status' },
              { key: 'total', label: 'Total', numeric: true, render: (o) => money(o.total) },
              { key: 'view', label: '', render: (o) => <Button type="button" variant="secondary" onClick={() => onOpen('order', o.orderId)}>View</Button> },
            ]}
            rows={orders} rowKey="orderId" empty="No orders."
          />

          <h3>Points history (latest 50)</h3>
          <Table
            columns={[
              { key: 'createdAt', label: 'Date' },
              { key: 'reason', label: 'Reason' },
              { key: 'orderId', label: 'Order', render: (p) => p.orderId || '' },
              { key: 'pointsChange', label: 'Points', numeric: true, render: (p) => (p.pointsChange > 0 ? '+' : '') + p.pointsChange },
            ]}
            rows={pointsHistory} rowKey="txnId" empty="No points yet."
          />
        </div>
      )}
    </Loaded>
  );
}

function OrderDetail({ id, onOpen }) {
  return (
    <Loaded url={'/api/manager/orders/' + id}>
      {({ order: o, items, payments, points }) => (
        <div className="stack">
          <Card title={'Order ' + o.orderId + ' (' + o.status + ')'}>
            <p>{o.orderDate} | <Button type="button" variant="secondary" onClick={() => onOpen('customer', o.customerId)}>{o.customerName}</Button> {o.email}</p>
            <p className="card-muted">
              Ship to: {o.shipName ? [o.shipName, o.shipStreet, o.shipApt, o.shipCity, o.shipState, o.shipZip].filter(Boolean).join(', ') : 'not set yet'}
            </p>
            <p className="card-muted">
              Tracking: {o.trackingNumber || 'none'}{o.estimatedArrival ? ' | arrives ' + o.estimatedArrival : ''}
              {o.employeeName ? ' | handled by ' + o.employeeName : ''}
            </p>
            <p>Subtotal {money(o.subtotal)} + tax {money(o.tax)} = <strong>{money(o.total)}</strong></p>
            <p className="card-muted">Points earned: {points.pointsEarned}{points.pointsTakenBack ? ' | taken back by a refund: ' + points.pointsTakenBack : ''}</p>
          </Card>

          <h3>Items</h3>
          <Table
            columns={[
              { key: 'sku', label: 'SKU' },
              { key: 'name', label: 'Product' },
              { key: 'quantity', label: 'Qty', numeric: true },
              { key: 'unitPrice', label: 'Unit price', numeric: true, render: (i) => money(i.unitPrice) },
              { key: 'discountName', label: 'Discount', render: (i) => (i.discountAmount > 0 ? (i.discountName || 'Discount') + ' (-' + money(i.discountAmount) + ')' : '') },
              { key: 'lineTotal', label: 'Line total', numeric: true, render: (i) => money(i.lineTotal) },
            ]}
            rows={items} rowKey="productId" empty="No items."
          />

          <h3>Payments</h3>
          <Table
            columns={[
              { key: 'paidAt', label: 'Date' },
              { key: 'method', label: 'Method' },
              { key: 'cardLast4', label: 'Card', render: (p) => (p.cardLast4 ? '**** ' + p.cardLast4 : '') },
              { key: 'amount', label: 'Amount', numeric: true, render: (p) => money(p.amount) },
            ]}
            rows={payments} rowKey="paymentId" empty="No payments."
          />
        </div>
      )}
    </Loaded>
  );
}

export default function CustomersPage() {
  const [tab, setTab] = useState('customers');   // 'customers' | 'orders'
  const [detail, setDetail] = useState(null);    // { kind: 'customer' | 'order', id }

  function open(kind, id) {
    setTab(kind === 'customer' ? 'customers' : 'orders');
    setDetail({ kind, id });
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <PageHeader title="Customer lookup" subtitle="Find a customer or an order. Read only." />
      <div className="row" style={{ marginBottom: 16 }}>
        <Button type="button" variant={tab === 'customers' ? 'primary' : 'secondary'} onClick={() => { setTab('customers'); setDetail(null); }}>Customers</Button>
        <Button type="button" variant={tab === 'orders' ? 'primary' : 'secondary'} onClick={() => { setTab('orders'); setDetail(null); }}>Orders</Button>
      </div>

      {detail ? (
        <>
          <p><Button type="button" variant="secondary" onClick={() => setDetail(null)}>Back to search</Button></p>
          {detail.kind === 'customer'
            ? <CustomerDetail id={detail.id} onOpen={open} />
            : <OrderDetail id={detail.id} onOpen={open} />}
        </>
      ) : (
        <SearchPanel key={tab} kind={tab} onOpen={open} />
      )}
    </>
  );
}
