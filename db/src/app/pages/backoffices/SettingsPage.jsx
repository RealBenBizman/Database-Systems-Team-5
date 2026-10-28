// Settings (managers): categories, tax rates and reward programs. Nothing is deleted.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Banner, Button, Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const pct = (rate) => (Number(rate) * 100).toFixed(2) + '%';

// loads a list from the API; reload() fetches it again
function useLoad(url) {
  const [data, setData] = useState(null);   // null = still loading
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    api.get(url)
      .then((d) => { if (current) { setData(d); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [url, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

// shared "save" helper for the three forms
function useSave(onDone) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(action, message) {
    setError('');
    setSaving(true);
    try {
      await action();
      onDone(message);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }
  return { error, saving, save };
}

/* ---------------------------------------------------------------- categories */
function CategoryForm({ item, onDone, onCancel }) {
  const [form, setForm] = useState({ name: item ? item.name : '', description: item && item.description ? item.description : '' });
  const { error, saving, save } = useSave(onDone);
  return (
    <Card title={item ? 'Edit category' : 'New category'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        save(
          () => (item ? api.put('/api/manager/categories', { ...form, categoryId: item.categoryId }) : api.post('/api/manager/categories', form)),
          'Category saved.',
        );
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required />
        <Field label="Description" as="textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function CategoriesSection({ say }) {
  const { data, error, reload } = useLoad('/api/manager/categories');
  const [panel, setPanel] = useState(null);   // null | { item }  (item null = new)
  if (error && !data) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <Spinner />;
  return (
    <>
      <p><Button type="button" onClick={() => setPanel({ item: null })}>New category</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><CategoryForm key={panel.item ? panel.item.categoryId : 'new'} item={panel.item} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); reload(); }} /></div>}
      <Table
        columns={[
          { key: 'name', label: 'Category' },
          { key: 'description', label: 'Description', render: (c) => c.description || '' },
          { key: 'productCount', label: 'Products', numeric: true },
          { key: 'edit', label: '', render: (c) => <Button type="button" variant="secondary" onClick={() => setPanel({ item: c })}>Edit</Button> },
        ]}
        rows={data.categories} rowKey="categoryId" empty="No categories yet."
      />
    </>
  );
}

/* ----------------------------------------------------------------- tax rates */
function TaxRateForm({ item, categories, onDone, onCancel }) {
  const [form, setForm] = useState(item
    ? { ratePercent: String(+(item.rate * 100).toFixed(2)), effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo || '' }
    : { categoryId: '', state: '', ratePercent: '', effectiveFrom: '', effectiveTo: '' });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const rate = form.ratePercent === '' ? '' : Number(form.ratePercent) / 100;
  return (
    <Card title={item ? 'Edit tax rate: ' + item.category + ' in ' + item.state : 'New tax rate'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const dates = { effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo };
        save(
          () => (item
            ? api.put('/api/manager/tax-rates', { taxRateId: item.taxRateId, rate, ...dates })
            : api.post('/api/manager/tax-rates', { categoryId: form.categoryId, state: form.state, rate, ...dates })),
          'Tax rate saved.',
        );
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        {!item && (
          <>
            <Field label="Category" as="select" value={form.categoryId} onChange={set('categoryId')} required>
              <option value="">Choose...</option>
              {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
            </Field>
            <Field label="State" value={form.state} onChange={set('state')} maxLength={2} placeholder="TX" required hint="Two-letter code of the ship-to state." />
          </>
        )}
        <Field label="Tax rate (%)" type="number" min="0" max="100" step="0.01" value={form.ratePercent} onChange={set('ratePercent')} required hint="For example 8.25" />
        <Field label="Starts on" type="date" value={form.effectiveFrom} onChange={set('effectiveFrom')} required />
        <Field label="Ends on" type="date" value={form.effectiveTo} onChange={set('effectiveTo')} hint="Leave empty for no end date." />
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function TaxRatesSection({ say }) {
  const rates = useLoad('/api/manager/tax-rates');
  const cats = useLoad('/api/manager/categories');
  const [panel, setPanel] = useState(null);
  if ((rates.error && !rates.data) || (cats.error && !cats.data)) return <ErrorBanner>{rates.error || cats.error}</ErrorBanner>;
  if (!rates.data || !cats.data) return <Spinner />;
  return (
    <>
      <Banner kind="info">
        Checkout looks up the rate by product category, ship-to state and sale date. If a category has no rate for a state, checkout fails for that
        order, so end a rate only when a new one starts. Finished orders keep the tax they were charged.
      </Banner>
      <p><Button type="button" onClick={() => setPanel({ item: null })}>New tax rate</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><TaxRateForm key={panel.item ? panel.item.taxRateId : 'new'} item={panel.item} categories={cats.data.categories} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); rates.reload(); }} /></div>}
      <Table
        columns={[
          { key: 'category', label: 'Category' },
          { key: 'state', label: 'State' },
          { key: 'rate', label: 'Rate', numeric: true, render: (r) => pct(r.rate) },
          { key: 'effectiveFrom', label: 'From' },
          { key: 'effectiveTo', label: 'To', render: (r) => r.effectiveTo || 'no end' },
          { key: 'edit', label: '', render: (r) => <Button type="button" variant="secondary" onClick={() => setPanel({ item: r })}>Edit</Button> },
        ]}
        rows={rates.data.taxRates} rowKey="taxRateId" empty="No tax rates yet."
      />
    </>
  );
}

/* ------------------------------------------------------------ reward programs */
function ProgramForm({ item, onDone, onCancel }) {
  const [form, setForm] = useState(item
    ? { programName: item.programName, pointsPerDollar: String(item.pointsPerDollar), effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo || '' }
    : { programName: '', pointsPerDollar: '', effectiveFrom: '', effectiveTo: '' });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card title={item ? 'Edit reward program' : 'New reward program'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        save(
          () => (item ? api.put('/api/manager/reward-programs', { ...form, programId: item.programId }) : api.post('/api/manager/reward-programs', form)),
          'Reward program saved.',
        );
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Program name" value={form.programName} onChange={set('programName')} maxLength={100} required />
        <Field label="Points per dollar" type="number" min="0" step="0.01" value={form.pointsPerDollar} onChange={set('pointsPerDollar')} required />
        <Field label="Starts on" type="date" value={form.effectiveFrom} onChange={set('effectiveFrom')} required />
        <Field label="Ends on" type="date" value={form.effectiveTo} onChange={set('effectiveTo')} hint="Leave empty for no end date." />
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function ProgramsSection({ say }) {
  const { data, error, reload } = useLoad('/api/manager/reward-programs');
  const [panel, setPanel] = useState(null);
  if (error && !data) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <Spinner />;
  return (
    <>
      <Banner kind="info">
        Two programs cannot overlap, and there must be exactly one program on every sale date (no gap), because each order earns points under the
        program of its date. To change the rate, end the old program and start a new one the next day.
      </Banner>
      <p><Button type="button" onClick={() => setPanel({ item: null })}>New reward program</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><ProgramForm key={panel.item ? panel.item.programId : 'new'} item={panel.item} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); reload(); }} /></div>}
      <Table
        columns={[
          { key: 'programName', label: 'Program' },
          { key: 'pointsPerDollar', label: 'Points per $', numeric: true },
          { key: 'effectiveFrom', label: 'From' },
          { key: 'effectiveTo', label: 'To', render: (p) => p.effectiveTo || 'no end' },
          { key: 'tierCount', label: 'Tiers', numeric: true },
          { key: 'edit', label: '', render: (p) => <Button type="button" variant="secondary" onClick={() => setPanel({ item: p })}>Edit</Button> },
        ]}
        rows={data.programs} rowKey="programId" empty="No reward programs yet."
      />
    </>
  );
}

/* ---------------------------------------------------------------------- page */
const TABS = [['categories', 'Categories'], ['tax', 'Tax rates'], ['rewards', 'Reward programs']];

export default function SettingsPage() {
  const [tab, setTab] = useState('categories');
  const [message, setMessage] = useState('');
  const say = (m) => setMessage(m);
  return (
    <>
      <PageHeader title="Settings" subtitle="Categories, tax rates and reward programs." />
      <div className="row" style={{ marginBottom: 16 }}>
        {TABS.map(([key, label]) => (
          <Button key={key} type="button" variant={tab === key ? 'primary' : 'secondary'} onClick={() => { setTab(key); setMessage(''); }}>{label}</Button>
        ))}
      </div>
      {message && <Banner kind="success">{message}</Banner>}
      {tab === 'categories' && <CategoriesSection say={say} />}
      {tab === 'tax' && <TaxRatesSection say={say} />}
      {tab === 'rewards' && <ProgramsSection say={say} />}
    </>
  );
}
