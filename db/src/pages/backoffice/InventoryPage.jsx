// Inventory list with stock adjustment.
// Managers can adjust; support can look but the API refuses their changes.
import { useEffect, useState } from 'react';

export default function InventoryPage() {
  const [products, setProducts] = useState(null);   // null = still loading
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [forms, setForms] = useState({});            // per product: { change, reason }

  function load() {
    fetch('/api/manager/products')
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Could not load products.');
        setProducts(body.products);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  function setField(productId, field, value) {
    setForms({ ...forms, [productId]: { ...forms[productId], [field]: value } });
  }

  async function adjust(productId) {
    const f = forms[productId] || {};
    setMessage('');
    setError('');
    try {
      const r = await fetch('/api/manager/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantityChange: Number(f.change), reason: f.reason }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Adjustment failed.');
      setMessage('Done. Stock is now ' + body.stock + '.');
      setForms({ ...forms, [productId]: { change: '', reason: '' } });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && products === null) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (products === null) return <p>Loading...</p>;

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Inventory</h1>
      {message && <p style={{ color: 'green' }}>{message}</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {products.length === 0 ? (
        <p>No products yet.</p>
      ) : (
        <table cellPadding="6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Product</th><th>Stock</th><th>Reorder at</th><th>Status</th>
              <th>Change (+/-)</th><th>Reason</th><th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const f = forms[p.productId] || {};
              const low = p.stock <= p.threshold;
              return (
                <tr key={p.productId} style={{ borderTop: '1px solid #ccc' }}>
                  <td>{p.name}</td>
                  <td>{p.stock}</td>
                  <td>{p.threshold}</td>
                  <td style={{ color: low ? 'crimson' : 'inherit', fontWeight: low ? 'bold' : 'normal' }}>
                    {low ? 'Low' : 'OK'}
                  </td>
                  <td>
                    <input type="number" style={{ width: 70 }} value={f.change || ''}
                      onChange={(e) => setField(p.productId, 'change', e.target.value)} />
                  </td>
                  <td>
                    <input type="text" maxLength={200} value={f.reason || ''}
                      onChange={(e) => setField(p.productId, 'reason', e.target.value)} />
                  </td>
                  <td><button onClick={() => adjust(p.productId)}>Adjust</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}