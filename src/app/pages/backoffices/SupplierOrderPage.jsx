// Supplier orders: start an order from a low-stock alert, then move it along.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Banner, Button, ErrorBanner, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

// the only buttons we offer for each status
const NEXT = { Pending: ['Ordered', 'Cancelled'], Ordered: ['Received', 'Cancelled'] };

export default function SupplierOrdersPage() {
  const [alerts, setAlerts] = useState(null);     // null = still loading
  const [orders, setOrders] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [links, setLinks] = useState([]);         // which supplier sells which product
  const [picks, setPicks] = useState({});         // per alert: { supplierId, quantity }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    Promise.all([
      api.get('/api/manager/alerts'),
      api.get('/api/manager/supplier-orders'),
      api.get('/api/manager/suppliers'),
    ])
      .then(([a, o, s]) => {
        setAlerts(a.alerts);
        setOrders(o.orders);
        setSuppliers(s.suppliers);
        setLinks(s.links || []);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  function setPick(alertId, field, value) {
    setPicks({ ...picks, [alertId]: { ...picks[alertId], [field]: value } });
  }

  async function createOrder(alertId) {
    const p = picks[alertId] || {};
    setMessage('');
    setError('');
    try {
      const body = await api.post('/api/manager/supplier-orders', {
        alertId,
        supplierId: Number(p.supplierId),
        quantity: Number(p.quantity),
      });
      setMessage('Order ' + body.orderId + ' created.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function changeStatus(orderId, status) {
    setMessage('');
    setError('');
    try {
      const body = await api.post('/api/manager/supplier-order-status', { orderId, status });
      setMessage('Order ' + orderId + ' is now ' + body.status + '.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  // the suppliers that sell this product, with what they charge
  const offersFor = (productId) => links
    .filter((l) => l.productId === productId)
    .map((l) => ({ ...l, name: (suppliers.find((s) => s.supplierId === l.supplierId) || {}).name }))
    .filter((l) => l.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const header = <PageHeader title="Supplier orders" subtitle="Order stock for low-stock alerts, then receive it." />;

  if (alerts === null && error) return <>{header}<ErrorBanner>{error}</ErrorBanner></>;
  if (alerts === null || orders === null) return <>{header}<Spinner /></>;

  const alertColumns = [
    { key: 'name', label: 'Product' },
    { key: 'stock', label: 'Stock', numeric: true },
    { key: 'threshold', label: 'Reorder at', numeric: true },
    {
      key: 'supplier', label: 'Supplier',
      render: (a) => {
        const offers = offersFor(a.productId);
        if (offers.length === 0) return <span className="card-muted">No supplier sells this product. Link one in Suppliers.</span>;
        return (
          <select value={(picks[a.alertId] || {}).supplierId || ''}
            onChange={(e) => setPick(a.alertId, 'supplierId', e.target.value)}>
            <option value="">Choose supplier</option>
            {offers.map((o) => (
              <option key={o.supplierId} value={o.supplierId}>
                {o.name} - ${Number(o.unitCost).toFixed(2)} each, {o.leadTimeDays} {o.leadTimeDays === 1 ? 'day' : 'days'}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: 'quantity', label: 'Quantity',
      render: (a) => (
        <input type="number" min="1" style={{ width: 80 }} value={(picks[a.alertId] || {}).quantity || ''}
          onChange={(e) => setPick(a.alertId, 'quantity', e.target.value)} />
      ),
    },
    {
      key: 'order', label: '',
      render: (a) => <Button disabled={offersFor(a.productId).length === 0} onClick={() => createOrder(a.alertId)}>Order</Button>,
    },
  ];

  const orderColumns = [
    { key: 'orderId', label: 'Order' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'orderDate', label: 'Date', render: (o) => String(o.orderDate).slice(0, 10) },
    { key: 'itemCount', label: 'Items', numeric: true },
    { key: 'totalCost', label: 'Total', numeric: true, render: (o) => '$' + Number(o.totalCost).toFixed(2) },
    { key: 'status', label: 'Status' },
    {
      key: 'actions', label: '',
      render: (o) => (
        <div className="row">
          {(NEXT[o.status] || []).map((next) => (
            <Button key={next} variant={next === 'Cancelled' ? 'danger' : 'secondary'}
              onClick={() => changeStatus(o.orderId, next)}>
              {next}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      {header}
      {message && <Banner kind="success">{message}</Banner>}
      <ErrorBanner>{error}</ErrorBanner>

      <h2>Low-stock alerts without an order</h2>
      <Table columns={alertColumns} rows={alerts.filter((a) => a.orderId === null)}
        rowKey="alertId" empty="No alerts need an order." />

      <h2 style={{ marginTop: 24 }}>All orders</h2>
      <Table columns={orderColumns} rows={orders} rowKey="orderId" empty="No orders yet." />
    </>
  );
}