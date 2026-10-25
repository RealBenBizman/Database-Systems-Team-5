// Supplier orders: start an order from a low-stock alert, then move it along.
import { useEffect, useState } from 'react';

// the only buttons we offer for each status
const NEXT = { Pending: ['Ordered', 'Cancelled'], Ordered: ['Received', 'Cancelled'] };

async function api(url, options) {
  const r = await fetch(url, options);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

function post(url, data) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export default function SupplierOrdersPage() {
  const [alerts, setAlerts] = useState(null);     // null = still loading
  const [orders, setOrders] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [picks, setPicks] = useState({});         // per alert: { supplierId, quantity }
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    Promise.all([
      api('/api/manager/alerts'),
      api('/api/manager/supplier-orders'),
      api('/api/manager/suppliers'),
    ])
      .then(([a, o, s]) => {
        setAlerts(a.alerts);
        setOrders(o.orders);
        setSuppliers(s.suppliers);
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
      const body = await post('/api/manager/supplier-orders', {
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
      const body = await post('/api/manager/supplier-order-status', { orderId, status });
      setMessage('Order ' + orderId + ' is now ' + body.status + '.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && alerts === null) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (alerts === null || orders === null) return <p>Loading...</p>;

  const needOrder = alerts.filter((a) => a.orderId === null);

  return (
    <section style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Supplier orders</h1>
      {message && <p style={{ color: 'green' }}>{message}</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <h2>Low-stock alerts without an order</h2>
      {needOrder.length === 0 ? (
        <p>No alerts need an order.</p>
      ) : (
        <table cellPadding="6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Product</th><th>Stock</th><th>Reorder at</th><th>Supplier</th><th>Quantity</th><th></th>
            </tr>
          </thead>
          <tbody>
            {needOrder.map((a) => {
              const p = picks[a.alertId] || {};
              return (
                <tr key={a.alertId} style={{ borderTop: '1px solid #ccc' }}>
                  <td>{a.name}</td>
                  <td>{a.stock}</td>
                  <td>{a.threshold}</td>
                  <td>
                    <select value={p.supplierId || ''}
                      onChange={(e) => setPick(a.alertId, 'supplierId', e.target.value)}>
                      <option value="">Choose supplier</option>
                      {suppliers.map((s) => (
                        <option key={s.supplierId} value={s.supplierId}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" min="1" style={{ width: 70 }} value={p.quantity || ''}
                      onChange={(e) => setPick(a.alertId, 'quantity', e.target.value)} />
                  </td>
                  <td><button onClick={() => createOrder(a.alertId)}>Order</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>All orders</h2>
      {orders.length === 0 ? (
        <p>No orders yet.</p>
      ) : (
        <table cellPadding="6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Order</th><th>Supplier</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.orderId} style={{ borderTop: '1px solid #ccc' }}>
                <td>{o.orderId}</td>
                <td>{o.supplier}</td>
                <td>{String(o.orderDate).slice(0, 10)}</td>
                <td>{o.itemCount}</td>
                <td>${Number(o.totalCost).toFixed(2)}</td>
                <td>{o.status}</td>
                <td>
                  {(NEXT[o.status] || []).map((next) => (
                    <button key={next} style={{ marginRight: 6 }}
                      onClick={() => changeStatus(o.orderId, next)}>
                      {next}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}