// Inventory list with stock adjustment. Support can look; only managers can adjust.
import { useEffect, useState } from 'react';
import { api } from '../../shared/api.js';
import { useAuth } from '../../shared/auth.jsx';
import { Banner, Button, ErrorBanner, PageHeader, Spinner, Table } from '../../shared/ui.jsx';

export default function InventoryPage() {
  const { user } = useAuth();
  const isManager = user && user.role === 'manager';
  const [products, setProducts] = useState(null);   // null = still loading
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [forms, setForms] = useState({});            // per product: { change, reason }

  function load() {
    api.get('/api/manager/products')
      .then((body) => setProducts(body.products))
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
      const body = await api.post('/api/manager/adjustments', {
        productId,
        quantityChange: Number(f.change),
        reason: f.reason,
      });
      setMessage('Done. Stock is now ' + body.stock + '.');
      setForms({ ...forms, [productId]: { change: '', reason: '' } });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const header = <PageHeader title="Inventory" subtitle="Stock levels against each product's reorder level." />;

  if (products === null && error) return <>{header}<ErrorBanner>{error}</ErrorBanner></>;
  if (products === null) return <>{header}<Spinner /></>;

  const columns = [
    { key: 'name', label: 'Product' },
    { key: 'stock', label: 'Stock', numeric: true },
    { key: 'threshold', label: 'Reorder at', numeric: true },
    {
      key: 'status', label: 'Status',
      render: (p) => (p.stock <= p.threshold
        ? <strong style={{ color: 'var(--color-danger)' }}>Low</strong>
        : 'OK'),
    },
  ];

  if (isManager) {
    columns.push(
      {
        key: 'change', label: 'Change (+/-)',
        render: (p) => (
          <input type="number" style={{ width: 80 }} value={(forms[p.productId] || {}).change || ''}
            onChange={(e) => setField(p.productId, 'change', e.target.value)} />
        ),
      },
      {
        key: 'reason', label: 'Reason',
        render: (p) => (
          <input type="text" maxLength={200} value={(forms[p.productId] || {}).reason || ''}
            onChange={(e) => setField(p.productId, 'reason', e.target.value)} />
        ),
      },
      {
        key: 'adjust', label: '',
        render: (p) => <Button variant="secondary" onClick={() => adjust(p.productId)}>Adjust</Button>,
      },
    );
  }

  return (
    <>
      {header}
      {message && <Banner kind="success">{message}</Banner>}
      <ErrorBanner>{error}</ErrorBanner>
      <Table columns={columns} rows={products} rowKey="productId" empty="No products yet." />
    </>
  );
}