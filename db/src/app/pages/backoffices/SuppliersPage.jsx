// Suppliers (managers): add, edit and remove suppliers, and say which products each one sells
// (supplier SKU, unit cost, lead time). Supplier orders are on /staff/suppliers.
import { useState } from 'react';
import { api } from '../../../shared/api.js';
import { RemoveCard, useLoad, useSave } from '../../../shared/manage.jsx';
import { Banner, Button, Card, ConfirmRemove, ErrorBanner, Field, PageHeader, Reveal, Spinner, Table } from '../../../shared/ui.jsx';

const money = (n) => '$' + Number(n || 0).toFixed(2);

function SupplierForm({ supplier, onDone, onCancel }) {
  const editing = !!supplier;
  const [form, setForm] = useState(editing
    ? { name: supplier.name, email: supplier.email, phone: supplier.phone, street: supplier.street, apt: supplier.apt || '', city: supplier.city, state: supplier.state, zip: supplier.zip }
    : { name: '', email: '', phone: '', street: '', apt: '', city: '', state: '', zip: '' });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card reveal title={editing ? 'Edit ' + supplier.name : 'New supplier'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        save(
          () => (editing ? api.put('/api/manager/supplier-directory', { ...form, supplierId: supplier.supplierId }) : api.post('/api/manager/supplier-directory', form)),
          'Saved ' + form.name + '.',
        );
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Name" value={form.name} onChange={set('name')} maxLength={100} required />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} maxLength={100} required hint="Each supplier needs its own email. A removed supplier's email cannot be used again." />
        <Field label="Phone" value={form.phone} onChange={set('phone')} maxLength={14} required hint="10 digits." />
        <Field label="Street" value={form.street} onChange={set('street')} maxLength={200} required />
        <Field label="Apt" value={form.apt} onChange={set('apt')} maxLength={10} />
        <Field label="City" value={form.city} onChange={set('city')} maxLength={50} required />
        <Field label="State" value={form.state} onChange={set('state')} maxLength={2} placeholder="TX" required />
        <Field label="Zip code" value={form.zip} onChange={set('zip')} maxLength={10} required hint="Digits only, 5 to 10." />
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function LinkForm({ supplier, link, products, onDone, onCancel }) {
  const editing = !!link;
  const [form, setForm] = useState(editing
    ? { productId: String(link.productId), supplierSku: link.supplierSku, unitCost: String(link.unitCost), leadTimeDays: String(link.leadTimeDays) }
    : { productId: '', supplierSku: '', unitCost: '', leadTimeDays: '7' });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const body = { ...form, supplierId: supplier.supplierId };
      save(() => (editing ? api.put('/api/manager/supplier-products', body) : api.post('/api/manager/supplier-products', body)), 'Link saved.');
    }}>
      <ErrorBanner>{error}</ErrorBanner>
      {!editing && (
        <Field label="Product" as="select" value={form.productId} onChange={set('productId')} required>
          <option value="">Choose...</option>
          {products.map((p) => <option key={p.productId} value={p.productId}>{p.name} ({p.sku})</option>)}
        </Field>
      )}
      {editing && <p className="card-muted">{link.name} ({link.sku})</p>}
      <Field label="Supplier SKU" value={form.supplierSku} onChange={set('supplierSku')} maxLength={50} required hint="How this supplier names the product." />
      <Field label="Unit cost" type="number" min="0" step="0.01" value={form.unitCost} onChange={set('unitCost')} required />
      <Field label="Lead time (days)" type="number" min="0" max="365" step="1" value={form.leadTimeDays} onChange={set('leadTimeDays')} required hint="Days from order to delivery." />
      <div className="row">
        <Button type="submit" loading={saving}>Save link</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// The products one supplier sells
function ProductLinks({ supplier, onClose, onChanged }) {
  const { data, error, reload } = useLoad('/api/manager/supplier-products?supplierId=' + supplier.supplierId);
  const [form, setForm] = useState(null);          // null | { link } (link null = new)
  const [removing, setRemoving] = useState(null);  // the link being removed
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function removeLink(link) {
    setBusy(true);
    setProblem('');
    try {
      await api.delete('/api/manager/supplier-products?supplierId=' + supplier.supplierId + '&productId=' + link.productId);
      setRemoving(null);
      reload();
      onChanged();
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  }

  return (
    <Card reveal title={'Products sold by ' + supplier.name}>
      {error && !data && <ErrorBanner>{error}</ErrorBanner>}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <ErrorBanner>{problem}</ErrorBanner>
          <Table
            columns={[
              { key: 'name', label: 'Product', render: (l) => l.name + ' (' + l.sku + ')' },
              { key: 'supplierSku', label: 'Supplier SKU' },
              { key: 'unitCost', label: 'Unit cost', numeric: true, render: (l) => money(l.unitCost) },
              { key: 'leadTimeDays', label: 'Lead time (days)', numeric: true },
              {
                key: 'actions', label: '',
                render: (l) => (
                  <div className="row">
                    <Button type="button" variant="secondary" onClick={() => { setRemoving(null); setForm({ link: l }); }}>Edit</Button>
                    <Button type="button" variant="secondary" onClick={() => { setForm(null); setRemoving(l); }}>Remove</Button>
                  </div>
                ),
              },
            ]}
            rows={data.links} rowKey="productId" empty="No products linked yet."
          />
          {removing && (
            <Reveal watch={removing.productId}>
            <ConfirmRemove
              label={'Stop buying ' + removing.name + ' from ' + supplier.name + '?'}
              message="Only the link is removed. The product and past orders stay. You can add the link again later."
              busy={busy}
              onConfirm={() => removeLink(removing)}
              onCancel={() => setRemoving(null)} />
            </Reveal>
          )}
          <div className="row" style={{ margin: '16px 0' }}>
            <Button type="button" onClick={() => { setRemoving(null); setForm({ link: null }); }}>Link a product</Button>
            <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          </div>
          {form && (
            <Reveal watch={form.link ? form.link.productId : 'new'}>
              <LinkForm
                key={form.link ? form.link.productId : 'new'}
                supplier={supplier} link={form.link} products={data.products}
                onCancel={() => setForm(null)}
                onDone={() => { setForm(null); reload(); onChanged(); }} />
            </Reveal>
          )}
        </>
      )}
    </Card>
  );
}

export default function SuppliersPage() {
  const { data, error, reload } = useLoad('/api/manager/supplier-directory');
  const [panel, setPanel] = useState(null);   // { kind: 'new' | 'edit' | 'products' | 'remove', supplier }
  const [message, setMessage] = useState('');

  const header = <PageHeader title="Suppliers" subtitle="Add suppliers and say which products they sell and how long delivery takes." />;
  if (error && !data) return <>{header}<ErrorBanner>{error}</ErrorBanner></>;
  if (!data) return <>{header}<Spinner /></>;

  const open = (kind, supplier) => { setMessage(''); setPanel({ kind, supplier }); };
  const done = (text) => { setMessage(text); setPanel(null); reload(); };

  return (
    <>
      {header}
      {message && <Banner kind="success">{message}</Banner>}
      <p><Button type="button" onClick={() => open('new', null)}>New supplier</Button></p>

      {panel && (
        <div style={{ marginBottom: 16 }}>
          {panel.kind === 'new' && <SupplierForm onDone={done} onCancel={() => setPanel(null)} />}
          {panel.kind === 'edit' && <SupplierForm key={panel.supplier.supplierId} supplier={panel.supplier} onDone={done} onCancel={() => setPanel(null)} />}
          {panel.kind === 'products' && <ProductLinks key={panel.supplier.supplierId} supplier={panel.supplier} onClose={() => setPanel(null)} onChanged={reload} />}
          {panel.kind === 'remove' && (
            <RemoveCard
              key={panel.supplier.supplierId}
              title={'Remove ' + panel.supplier.name}
              label={'Remove ' + panel.supplier.name + '?'}
              message="Its past supplier orders stay in the history. A supplier with an order that is still Pending or Ordered cannot be removed. Its email cannot be used again."
              url={'/api/manager/supplier-directory?id=' + panel.supplier.supplierId}
              done={'Removed ' + panel.supplier.name + '.'}
              onRemoved={done}
              onCancel={() => setPanel(null)} />
          )}
        </div>
      )}

      <Table
        columns={[
          { key: 'name', label: 'Supplier' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'location', label: 'Location', render: (s) => s.city + ', ' + s.state },
          { key: 'productCount', label: 'Products', numeric: true },
          { key: 'openOrders', label: 'Open orders', numeric: true },
          {
            key: 'actions', label: '',
            render: (s) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => open('edit', s)}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => open('products', s)}>Products</Button>
                <Button type="button" variant="secondary" onClick={() => open('remove', s)}>Remove</Button>
              </div>
            ),
          },
        ]}
        rows={data.suppliers} rowKey="supplierId" empty="No suppliers yet. Add one, then link the products it sells."
      />
    </>
  );
}
