// Settings (managers): categories, tax rates, reward programs and their tiers.
// Remove flags the row (nothing is deleted); the server refuses it when something still depends on it.
import { useState } from 'react';
import { api } from '../../../shared/api.js';
import { RemoveCard, useLoad, useSave } from '../../../shared/manage.jsx';
import { Banner, Button, Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const pct = (rate) => (Number(rate) * 100).toFixed(2) + '%';

/* ---------------------------------------------------------------- categories */
function CategoryForm({ item, onDone, onCancel }) {
  const [form, setForm] = useState({ name: item ? item.name : '', description: item && item.description ? item.description : '' });
  const { error, saving, save } = useSave(onDone);
  return (
    <Card reveal title={item ? 'Edit category' : 'New category'}>
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
  const [removing, setRemoving] = useState(null);
  if (error && !data) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <Spinner />;
  return (
    <>
      <p><Button type="button" onClick={() => { setRemoving(null); setPanel({ item: null }); }}>New category</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><CategoryForm key={panel.item ? panel.item.categoryId : 'new'} item={panel.item} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); reload(); }} /></div>}
      {removing && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={removing.categoryId}
            title={'Remove ' + removing.name}
            label={'Remove the category ' + removing.name + '?'}
            message="A category that still has products cannot be removed. Its name cannot be used again."
            url={'/api/manager/categories?id=' + removing.categoryId}
            done={'Removed ' + removing.name + '.'}
            onRemoved={(m) => { say(m); setRemoving(null); reload(); }}
            onCancel={() => setRemoving(null)} />
        </div>
      )}
      <Table
        columns={[
          { key: 'name', label: 'Category' },
          { key: 'description', label: 'Description', render: (c) => c.description || '' },
          { key: 'productCount', label: 'Products', numeric: true },
          {
            key: 'edit', label: '',
            render: (c) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => { setRemoving(null); setPanel({ item: c }); }}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => { setPanel(null); setRemoving(c); }}>Remove</Button>
              </div>
            ),
          },
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
    <Card reveal title={item ? 'Edit tax rate: ' + item.category + ' in ' + item.state : 'New tax rate'}>
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
  const [removing, setRemoving] = useState(null);
  if ((rates.error && !rates.data) || (cats.error && !cats.data)) return <ErrorBanner>{rates.error || cats.error}</ErrorBanner>;
  if (!rates.data || !cats.data) return <Spinner />;
  return (
    <>
      <Banner kind="info">
        Checkout looks up the rate by product category, ship-to state and sale date. If a category has no rate for a state, checkout fails for that
        order, so end a rate only when a new one starts. Finished orders keep the tax they were charged.
      </Banner>
      <p><Button type="button" onClick={() => { setRemoving(null); setPanel({ item: null }); }}>New tax rate</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><TaxRateForm key={panel.item ? panel.item.taxRateId : 'new'} item={panel.item} categories={cats.data.categories} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); rates.reload(); }} /></div>}
      {removing && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={removing.taxRateId}
            title={'Remove the ' + removing.category + ' rate in ' + removing.state}
            label={'Remove this ' + pct(removing.rate) + ' tax rate?'}
            message="If it is the only rate in force for products of this category, the server refuses: checkout would fail for that state. Add a replacement first, or give this rate an end date."
            url={'/api/manager/tax-rates?id=' + removing.taxRateId}
            done="Tax rate removed."
            onRemoved={(m) => { say(m); setRemoving(null); rates.reload(); }}
            onCancel={() => setRemoving(null)} />
        </div>
      )}
      <Table
        columns={[
          { key: 'category', label: 'Category' },
          { key: 'state', label: 'State' },
          { key: 'rate', label: 'Rate', numeric: true, render: (r) => pct(r.rate) },
          { key: 'effectiveFrom', label: 'From' },
          { key: 'effectiveTo', label: 'To', render: (r) => r.effectiveTo || 'no end' },
          {
            key: 'edit', label: '',
            render: (r) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => { setRemoving(null); setPanel({ item: r }); }}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => { setPanel(null); setRemoving(r); }}>Remove</Button>
              </div>
            ),
          },
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
    <Card reveal title={item ? 'Edit reward program' : 'New reward program'}>
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
  const [removing, setRemoving] = useState(null);
  if (error && !data) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <Spinner />;
  return (
    <>
      <Banner kind="info">
        Two programs cannot overlap, and there must be exactly one program on every sale date (no gap), because each order earns points under the
        program of its date. To change the rate, end the old program and start a new one the next day.
      </Banner>
      <p><Button type="button" onClick={() => { setRemoving(null); setPanel({ item: null }); }}>New reward program</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><ProgramForm key={panel.item ? panel.item.programId : 'new'} item={panel.item} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); reload(); }} /></div>}
      {removing && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={removing.programId}
            title={'Remove ' + removing.programName}
            label={'Remove the program ' + removing.programName + '?'}
            message="A program that customers earned points under stays as history (give it an end date instead), and the program in force today cannot be removed."
            url={'/api/manager/reward-programs?id=' + removing.programId}
            done={'Removed ' + removing.programName + '.'}
            onRemoved={(m) => { say(m); setRemoving(null); reload(); }}
            onCancel={() => setRemoving(null)} />
        </div>
      )}
      <Table
        columns={[
          { key: 'programName', label: 'Program' },
          { key: 'pointsPerDollar', label: 'Points per $', numeric: true },
          { key: 'effectiveFrom', label: 'From' },
          { key: 'effectiveTo', label: 'To', render: (p) => p.effectiveTo || 'no end' },
          { key: 'tierCount', label: 'Tiers', numeric: true },
          {
            key: 'edit', label: '',
            render: (p) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => { setRemoving(null); setPanel({ item: p }); }}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => { setPanel(null); setRemoving(p); }}>Remove</Button>
              </div>
            ),
          },
        ]}
        rows={data.programs} rowKey="programId" empty="No reward programs yet."
      />
    </>
  );
}

/* ------------------------------------------------------------- reward tiers */
function TierForm({ item, programId, onDone, onCancel }) {
  const [form, setForm] = useState(item
    ? { tierName: item.tierName, minPoints: String(item.minPoints), perk: item.perk || '' }
    : { tierName: '', minPoints: '', perk: '' });
  const { error, saving, save } = useSave(onDone);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Card reveal title={item ? 'Edit tier ' + item.tierName : 'New tier'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        save(
          () => (item ? api.put('/api/manager/reward-tiers', { ...form, tierId: item.tierId }) : api.post('/api/manager/reward-tiers', { ...form, programId })),
          'Tier saved.',
        );
      }}>
        <ErrorBanner>{error}</ErrorBanner>
        <Field label="Tier name" value={form.tierName} onChange={set('tierName')} maxLength={50} required />
        <Field label="Minimum points" type="number" min="0" step="1" value={form.minPoints} onChange={set('minPoints')} required hint="Customers reach the tier at this many points. Two tiers of a program cannot start at the same number." />
        <Field label="Perk" value={form.perk} onChange={set('perk')} maxLength={200} />
        <div className="row">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function TiersSection({ say }) {
  const programs = useLoad('/api/manager/reward-programs');
  const [programId, setProgramId] = useState('');
  const [panel, setPanel] = useState(null);
  const [removing, setRemoving] = useState(null);
  if (programs.error && !programs.data) return <ErrorBanner>{programs.error}</ErrorBanner>;
  if (!programs.data) return <Spinner />;
  return (
    <>
      <Banner kind="info">
        Customers get their tier from their points, automatically. Here you only define the tiers. A tier that customers hold right now cannot be removed.
      </Banner>
      <Field label="Reward program" as="select" value={programId} onChange={(e) => { setProgramId(e.target.value); setPanel(null); setRemoving(null); }}>
        <option value="">Choose...</option>
        {programs.data.programs.map((p) => <option key={p.programId} value={p.programId}>{p.programName} ({p.effectiveFrom} to {p.effectiveTo || 'no end'})</option>)}
      </Field>
      {programId && <TierList key={programId} programId={Number(programId)} say={say} panel={panel} setPanel={setPanel} removing={removing} setRemoving={setRemoving} />}
    </>
  );
}

function TierList({ programId, say, panel, setPanel, removing, setRemoving }) {
  const { data, error, reload } = useLoad('/api/manager/reward-tiers?programId=' + programId);
  if (error && !data) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <Spinner />;
  return (
    <>
      <p><Button type="button" onClick={() => { setRemoving(null); setPanel({ item: null }); }}>New tier</Button></p>
      {panel && <div style={{ marginBottom: 16 }}><TierForm key={panel.item ? panel.item.tierId : 'new'} item={panel.item} programId={programId} onCancel={() => setPanel(null)} onDone={(m) => { say(m); setPanel(null); reload(); }} /></div>}
      {removing && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={removing.tierId}
            title={'Remove ' + removing.tierName}
            label={'Remove the tier ' + removing.tierName + '?'}
            message="Its minimum points cannot be used again by another tier of this program."
            url={'/api/manager/reward-tiers?id=' + removing.tierId}
            done={'Removed ' + removing.tierName + '.'}
            onRemoved={(m) => { say(m); setRemoving(null); reload(); }}
            onCancel={() => setRemoving(null)} />
        </div>
      )}
      <Table
        columns={[
          { key: 'tierName', label: 'Tier' },
          { key: 'minPoints', label: 'From points', numeric: true },
          { key: 'perk', label: 'Perk', render: (t) => t.perk || '' },
          { key: 'customers', label: 'Customers', numeric: true },
          {
            key: 'edit', label: '',
            render: (t) => (
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => { setRemoving(null); setPanel({ item: t }); }}>Edit</Button>
                <Button type="button" variant="secondary" onClick={() => { setPanel(null); setRemoving(t); }}>Remove</Button>
              </div>
            ),
          },
        ]}
        rows={data.tiers} rowKey="tierId" empty="This program has no tiers yet."
      />
    </>
  );
}

/* ---------------------------------------------------------------------- page */
const TABS = [['categories', 'Categories'], ['tax', 'Tax rates'], ['rewards', 'Reward programs'], ['tiers', 'Reward tiers']];

export default function SettingsPage() {
  const [tab, setTab] = useState('categories');
  const [message, setMessage] = useState('');
  const say = (m) => setMessage(m);
  return (
    <>
      <PageHeader title="Settings" subtitle="Categories, tax rates, reward programs and tiers." />
      <div className="row" style={{ marginBottom: 16 }}>
        {TABS.map(([key, label]) => (
          <Button key={key} type="button" variant={tab === key ? 'primary' : 'secondary'} onClick={() => { setTab(key); setMessage(''); }}>{label}</Button>
        ))}
      </div>
      {message && <Banner kind="success">{message}</Banner>}
      {tab === 'categories' && <CategoriesSection say={say} />}
      {tab === 'tax' && <TaxRatesSection say={say} />}
      {tab === 'rewards' && <ProgramsSection say={say} />}
      {tab === 'tiers' && <TiersSection say={say} />}
    </>
  );
}
