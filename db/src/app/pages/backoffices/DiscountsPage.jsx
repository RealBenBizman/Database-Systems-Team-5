// Discounts (managers): create, edit, pause, link to products or categories, and remove. Sale events group discounts.
// Remove flags the row (nothing is deleted). The server refuses it while a product or category still uses the discount.
import { useState } from 'react';
import { api } from '../../../shared/api.js';
import { RemoveCard, useLoad, useSave } from '../../../shared/manage.jsx';
import { Banner, Button, Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const money = (n) => '$' + Number(n || 0).toFixed(2);
const amountText = (d) => (d.amountType === 'percent' ? Number(d.amount) + '% off' : money(d.amount) + ' off, once per line');
const TYPES = ['product sale', 'category sale', 'fixed amount'];

/* ----------------------------------------------------------- discount form */
function DiscountForm({ item, events, onDone, onCancel }) {
  const [form, setForm] = useState(item
    ? { name: item.name, type: item.type, amountType: item.amountType, amount: String(item.amount), startDate: item.startDate, endDate: item.endDate, saleEventId: item.saleEventId || '', isActive: !!item.isActive }
    : { name: '', type: 'category sale', amountType: 'percent', amount: '', startDate: '', endDate: '', saleEventId: '', isActive: true });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card reveal title={item ? 'Edit ' + item.name : 'New discount'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const body = { ...form };
        save(
          () => (item ? api.put('/api/manager/discounts', { ...body, discountId: item.discountId }) : api.post('/api/manager/discounts', body)),
          'Discount saved.',
        );
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Name" value={form.name} onChange={set('name')} maxLength={100} required />
        <Field label="Type" as="select" value={form.type} onChange={set('type')}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Field>
        <Field label="Amount type" as="select" value={form.amountType} onChange={set('amountType')}>
          <option value="percent">Percent</option>
          <option value="fixed">Fixed amount (dollars)</option>
        </Field>
        <Field
          label={form.amountType === 'percent' ? 'Percent off' : 'Dollars off'} type="number" min="0.01" step="0.01"
          max={form.amountType === 'percent' ? '100' : undefined} value={form.amount} onChange={set('amount')} required
          hint={form.amountType === 'fixed' ? 'A fixed amount is taken once per line, not once per unit.' : 'For example 15 for 15% off.'} />
        <Field label="Starts on" type="date" value={form.startDate} onChange={set('startDate')} required />
        <Field label="Ends on" type="date" value={form.endDate} onChange={set('endDate')} required />
        <Field label="Sale event" as="select" value={form.saleEventId} onChange={set('saleEventId')}>
          <option value="">None</option>
          {events.map((ev) => <option key={ev.saleEventId} value={ev.saleEventId}>{ev.name}</option>)}
        </Field>
        {item && (
          <Field label="Status" as="select" value={form.isActive ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'yes' })}
            hint="Paused discounts are not applied at checkout.">
            <option value="yes">Active</option>
            <option value="no">Paused</option>
          </Field>
        )}
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------ links panel */
function LinksPanel({ discount, links, products, categories, say, reload, onClose }) {
  const mine = links.filter((l) => l.discountId === discount.discountId);
  const [kind, setKind] = useState('category');
  const [targetId, setTargetId] = useState('');
  const { error, saving, save } = useSave((m) => { say(m); reload(); });
  const options = kind === 'product'
    ? products.map((p) => ({ id: p.productId, name: p.name }))
    : categories.map((c) => ({ id: c.categoryId, name: c.name }));
  const patch = (action, k, id, message) => save(
    () => api.patch('/api/manager/discounts', { discountId: discount.discountId, action, targetKind: k, targetId: id }), message);
  return (
    <Card reveal title={'Where ' + discount.name + ' applies'}>
      <ErrorBanner>{error}</ErrorBanner>
      {mine.length === 0
        ? <p className="card-muted">Not linked to any product or category yet, so it changes no prices.</p>
        : (
          <ul>
            {mine.map((l) => (
              <li key={l.kind + l.targetId}>
                {l.name} ({l.kind}){' '}
                <Button type="button" variant="secondary" loading={saving} onClick={() => patch('unlink', l.kind, l.targetId, 'Unlinked ' + l.name + '.')}>Unlink</Button>
              </li>
            ))}
          </ul>
        )}
      <form onSubmit={(e) => { e.preventDefault(); if (targetId) patch('link', kind, targetId, 'Linked.'); }}>
        <Field label="Link to a" as="select" value={kind} onChange={(e) => { setKind(e.target.value); setTargetId(''); }}>
          <option value="category">Category</option>
          <option value="product">Product</option>
        </Field>
        <Field label={kind === 'product' ? 'Product' : 'Category'} as="select" value={targetId} onChange={(e) => setTargetId(e.target.value)} required
          hint="Each product or category uses one discount at a time.">
          <option value="">Choose...</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Field>
        <div className="row">
          <Button type="submit" loading={saving}>Link</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </form>
    </Card>
  );
}

/* ---------------------------------------------------------------- sections */
function DiscountsSection({ say, events }) {
  const list = useLoad('/api/manager/discounts');
  const prods = useLoad('/api/manager/product-catalog');
  const cats = useLoad('/api/manager/categories');
  const [panel, setPanel] = useState(null);   // { kind: 'form' | 'links' | 'remove', item }
  if ((list.error && !list.data) || (prods.error && !prods.data) || (cats.error && !cats.data)) return <ErrorBanner>{list.error || prods.error || cats.error}</ErrorBanner>;
  if (!list.data || !prods.data || !cats.data) return <Spinner />;
  const open = (kind, item) => setPanel({ kind, item });
  const close = () => setPanel(null);
  const count = (d) => list.data.links.filter((l) => l.discountId === d.discountId).length;
  return (
    <>
      <Banner kind="info">
        A discount does nothing until it is linked to a product or a category. Removing one is only allowed once it is unlinked. Past orders keep the discount they used.
      </Banner>
      <p><Button type="button" onClick={() => open('form', null)}>New discount</Button></p>
      {panel && panel.kind === 'form' && (
        <div style={{ marginBottom: 16 }}>
          <DiscountForm key={panel.item ? panel.item.discountId : 'new'} item={panel.item} events={events} onCancel={close}
            onDone={(m) => { say(m); close(); list.reload(); }} />
        </div>
      )}
      {panel && panel.kind === 'links' && (
        <div style={{ marginBottom: 16 }}>
          <LinksPanel key={panel.item.discountId} discount={panel.item} links={list.data.links} products={prods.data.products} categories={cats.data.categories}
            say={say} reload={list.reload} onClose={close} />
        </div>
      )}
      {panel && panel.kind === 'remove' && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={panel.item.discountId}
            title={'Remove ' + panel.item.name}
            label={'Remove the discount ' + panel.item.name + '?'}
            message="Unlink it from every product and category first. Orders that already used it keep their prices."
            url={'/api/manager/discounts?id=' + panel.item.discountId}
            done={'Removed ' + panel.item.name + '.'}
            onRemoved={(m) => { say(m); close(); list.reload(); }}
            onCancel={close} />
        </div>
      )}
      <Table
        columns={[
          { key: 'name', label: 'Discount' },
          { key: 'amount', label: 'Amount', render: amountText },
          { key: 'dates', label: 'Dates', render: (d) => d.startDate + ' to ' + d.endDate },
          { key: 'status', label: 'Status' },
          { key: 'saleEvent', label: 'Sale event', render: (d) => d.saleEvent || '' },
          { key: 'links', label: 'Used by', numeric: true, render: count },
          {
            key: 'actions', label: '',
            render: (d) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => open('form', d)}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => open('links', d)}>Links</Button>
                <Button type="button" variant="secondary" onClick={() => open('remove', d)}>Remove</Button>
              </div>
            ),
          },
        ]}
        rows={list.data.discounts} rowKey="discountId" empty="No discounts yet."
      />
    </>
  );
}

function EventForm({ item, onDone, onCancel }) {
  const [form, setForm] = useState(item
    ? { name: item.name, description: item.description || '', startDate: item.startDate, endDate: item.endDate, isActive: !!item.isActive }
    : { name: '', description: '', startDate: '', endDate: '', isActive: true });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card reveal title={item ? 'Edit ' + item.name : 'New sale event'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        save(() => (item ? api.put('/api/manager/sale-events', { ...form, saleEventId: item.saleEventId }) : api.post('/api/manager/sale-events', form)), 'Sale event saved.');
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Name" value={form.name} onChange={set('name')} maxLength={100} required />
        <Field label="Description" as="textarea" rows={2} value={form.description} onChange={set('description')} maxLength={500} />
        <Field label="Starts on" type="date" value={form.startDate} onChange={set('startDate')} required />
        <Field label="Ends on" type="date" value={form.endDate} onChange={set('endDate')} required />
        {item && (
          <Field label="Status" as="select" value={form.isActive ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, isActive: e.target.value === 'yes' })}>
            <option value="yes">Active</option>
            <option value="no">Paused</option>
          </Field>
        )}
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function EventsSection({ say, events, reload, onChanged }) {
  const [panel, setPanel] = useState(null);
  const open = (kind, item) => setPanel({ kind, item });
  const close = () => setPanel(null);
  return (
    <>
      <p><Button type="button" onClick={() => open('form', null)}>New sale event</Button></p>
      {panel && panel.kind === 'form' && (
        <div style={{ marginBottom: 16 }}>
          <EventForm key={panel.item ? panel.item.saleEventId : 'new'} item={panel.item} onCancel={close} onDone={(m) => { say(m); close(); reload(); onChanged(); }} />
        </div>
      )}
      {panel && panel.kind === 'remove' && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={panel.item.saleEventId}
            title={'Remove ' + panel.item.name}
            label={'Remove the sale event ' + panel.item.name + '?'}
            message="A sale event that still has discounts cannot be removed. Move or remove those discounts first."
            url={'/api/manager/sale-events?id=' + panel.item.saleEventId}
            done={'Removed ' + panel.item.name + '.'}
            onRemoved={(m) => { say(m); close(); reload(); onChanged(); }}
            onCancel={close} />
        </div>
      )}
      <Table
        columns={[
          { key: 'name', label: 'Sale event' },
          { key: 'dates', label: 'Dates', render: (e) => e.startDate + ' to ' + e.endDate },
          { key: 'status', label: 'Status' },
          { key: 'discountCount', label: 'Discounts', numeric: true },
          {
            key: 'actions', label: '',
            render: (e) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => open('form', e)}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => open('remove', e)}>Remove</Button>
              </div>
            ),
          },
        ]}
        rows={events} rowKey="saleEventId" empty="No sale events yet."
      />
    </>
  );
}

export default function DiscountsPage() {
  const [tab, setTab] = useState('discounts');
  const [notice, setNotice] = useState('');
  const events = useLoad('/api/manager/sale-events');
  const say = (m) => setNotice(m);
  return (
    <>
      <PageHeader title="Discounts" subtitle="Create sales, link them to products or categories, and group them in sale events." />
      {notice && <Banner kind="success">{notice}</Banner>}
      <div className="row" style={{ marginBottom: 16 }}>
        <Button type="button" variant={tab === 'discounts' ? 'primary' : 'secondary'} onClick={() => { setTab('discounts'); setNotice(''); }}>Discounts</Button>
        <Button type="button" variant={tab === 'events' ? 'primary' : 'secondary'} onClick={() => { setTab('events'); setNotice(''); }}>Sale events</Button>
      </div>
      {events.error && !events.data && <ErrorBanner>{events.error}</ErrorBanner>}
      {!events.data && !events.error && <Spinner />}
      {events.data && tab === 'discounts' && <DiscountsSection say={say} events={events.data.saleEvents} />}
      {events.data && tab === 'events' && <EventsSection say={say} events={events.data.saleEvents} reload={events.reload} onChanged={() => {}} />}
    </>
  );
}
