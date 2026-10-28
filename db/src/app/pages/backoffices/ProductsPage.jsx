// Products (managers): find, create and edit products, change a price, adjust stock.
// Prices go through /api/manager/prices (logs a PRICE_CHANGE row) and stock through
// /api/manager/adjustments (a trigger applies it), so the edit form changes neither.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Banner, Button, Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const CONDITIONS = ['New', 'Used', 'Refurbished'];
const money = (n) => '$' + Number(n || 0).toFixed(2);

function CategorySelect({ categories, value, onChange }) {
  return (
    <Field label="Category" as="select" value={value} onChange={onChange} required>
      <option value="">Choose...</option>
      {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
    </Field>
  );
}

function ProductForm({ product, categories, onSaved, onCancel }) {
  const editing = !!product;
  const [form, setForm] = useState(editing
    ? {
        name: product.name, description: product.description || '', categoryId: String(product.categoryId),
        productCondition: product.productCondition, costPrice: String(product.costPrice),
        threshold: String(product.threshold), isActive: !!product.isActive,
      }
    : { sku: '', name: '', description: '', categoryId: '', productCondition: 'New', costPrice: '', sellPrice: '', stock: '0', threshold: '5', isActive: true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        await api.put('/api/manager/product-catalog', { ...form, productId: product.productId });
        onSaved('Saved ' + form.name + '.');
      } else {
        await api.post('/api/manager/product-catalog', form);
        onSaved('Created ' + form.name + '.');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Card title={editing ? 'Edit ' + product.name : 'New product'}>
      <form onSubmit={submit}>
        <ErrorBanner>{error}</ErrorBanner>
        {!editing && <Field label="SKU" value={form.sku} onChange={set('sku')} maxLength={50} required />}
        {editing && <p className="card-muted">SKU {product.sku} cannot be changed.</p>}
        <Field label="Name" value={form.name} onChange={set('name')} maxLength={150} required />
        <Field label="Description" as="textarea" rows={3} value={form.description} onChange={set('description')} maxLength={2000} />
        <CategorySelect categories={categories} value={form.categoryId} onChange={set('categoryId')} />
        <Field label="Condition" as="select" value={form.productCondition} onChange={set('productCondition')}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Field>
        <Field label="Cost price ($)" type="number" min="0" step="0.01" value={form.costPrice} onChange={set('costPrice')} required />
        {!editing && <Field label="Sell price ($)" type="number" min="0" step="0.01" value={form.sellPrice} onChange={set('sellPrice')} required />}
        {!editing && <Field label="Starting stock" type="number" min="0" step="1" value={form.stock} onChange={set('stock')} hint="Later changes to stock go through Adjust stock." />}
        <Field label="Reorder at (units)" type="number" min="0" step="1" value={form.threshold} onChange={set('threshold')} required />
        {editing && (
          <div className="field">
            <label>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              {' '}Active (shown in the store)
            </label>
          </div>
        )}
        <div className="row">
          <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create product'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function PriceForm({ product, onSaved, onCancel }) {
  const [price, setPrice] = useState(String(product.sellPrice));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const out = await api.post('/api/manager/prices', { productId: product.productId, newPrice: price });
      onSaved(product.name + ': price changed from ' + money(out.oldPrice) + ' to ' + money(out.newPrice) + '.');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Card title={'Change price: ' + product.name}>
      <form onSubmit={submit}>
        <ErrorBanner>{error}</ErrorBanner>
        <p className="card-muted">Current price {money(product.sellPrice)}. The change is logged with your name.</p>
        <Field label="New price ($)" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
        <div className="row">
          <Button type="submit" loading={saving}>Change price</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function StockForm({ product, onSaved, onCancel }) {
  const [change, setChange] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const out = await api.post('/api/manager/adjustments', { productId: product.productId, quantityChange: change, reason });
      onSaved(product.name + ': stock is now ' + out.stock + '.');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Card title={'Adjust stock: ' + product.name}>
      <form onSubmit={submit}>
        <ErrorBanner>{error}</ErrorBanner>
        <p className="card-muted">In stock now: {product.stock}. Use a negative number to remove units. Stock cannot go below 0.</p>
        <Field label="Change (units)" type="number" step="1" value={change} onChange={(e) => setChange(e.target.value)} required />
        <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required hint="For example: recount, damaged, found in storage." />
        <div className="row">
          <Button type="submit" loading={saving}>Adjust stock</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState(null);   // null = still loading
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [panel, setPanel] = useState(null);         // { kind: 'new' | 'edit' | 'price' | 'stock', product }
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    Promise.all([
      api.get('/api/manager/product-catalog', { q: search }),
      api.get('/api/manager/categories'),
    ])
      .then(([p, c]) => { if (current) { setProducts(p.products); setCategories(c.categories); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [search, version]);

  function saved(text) {
    setMessage(text);
    setPanel(null);
    setVersion(version + 1);
  }

  function open(kind, product) {
    setMessage('');
    setPanel({ kind, product });
  }

  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product' },
    { key: 'category', label: 'Category' },
    { key: 'sellPrice', label: 'Price', numeric: true, render: (p) => money(p.sellPrice) },
    { key: 'costPrice', label: 'Cost', numeric: true, render: (p) => money(p.costPrice) },
    { key: 'stock', label: 'Stock', numeric: true },
    { key: 'threshold', label: 'Reorder at', numeric: true },
    { key: 'isActive', label: 'Active', render: (p) => (p.isActive ? 'Yes' : 'Paused') },
    {
      key: 'actions', label: '',
      render: (p) => (
        <div className="row">
          <Button type="button" variant="secondary" onClick={() => open('edit', p)}>Edit</Button>
          <Button type="button" variant="secondary" onClick={() => open('price', p)}>Price</Button>
          <Button type="button" variant="secondary" onClick={() => open('stock', p)}>Stock</Button>
        </div>
      ),
    },
  ];

  const header = <PageHeader title="Products" subtitle="Create and edit products, change prices and adjust stock." />;
  if (products === null && error) return <>{header}<ErrorBanner>{error}</ErrorBanner></>;
  if (products === null) return <>{header}<Spinner /></>;

  return (
    <>
      {header}
      <ErrorBanner>{error}</ErrorBanner>
      {message && <Banner kind="success">{message}</Banner>}

      <form className="row" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <div className="field" style={{ margin: 0, minWidth: 260 }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or SKU" aria-label="Search products" />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
        <Button type="button" onClick={() => open('new', null)}>New product</Button>
      </form>

      {panel && (
        <div style={{ marginBottom: 16 }}>
        {panel && panel.kind === 'new' && <ProductForm categories={categories} onSaved={saved} onCancel={() => setPanel(null)} />}
        {panel && panel.kind === 'edit' && <ProductForm key={panel.product.productId} product={panel.product} categories={categories} onSaved={saved} onCancel={() => setPanel(null)} />}
        {panel && panel.kind === 'price' && <PriceForm key={panel.product.productId} product={panel.product} onSaved={saved} onCancel={() => setPanel(null)} />}
        {panel && panel.kind === 'stock' && <StockForm key={panel.product.productId} product={panel.product} onSaved={saved} onCancel={() => setPanel(null)} />}
        </div>
      )}

      <Table columns={columns} rows={products} rowKey="productId" empty="No products found." />
    </>
  );
}
