// Sales report (managers only). Written by Terry (Part 2).
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorBanner, Field, Table } from '../../../shared/ui.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const day = (d) => (d ? String(d).slice(0, 10) : '');

export default function SalesReport() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  function load(e) {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    api.get('/api/reports/sales', { from, to })
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const sum = (key) => (data ? data.days.reduce((s, d) => s + Number(d[key] || 0), 0) : 0);

  return (
    <>
      <PageHeader title="Sales report" subtitle="Completed sales only. Revenue is after discounts, before tax." />

      <form onSubmit={load} className="row">
        <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="submit" loading={loading}>Run report</Button>
      </form>

      <ErrorBanner error={error} />
      {loading && <Spinner label="Running the report..." />}

      {!loading && data && data.days.length === 0 && (
        <EmptyState title="No completed sales between these dates" />
      )}

      {!loading && data && data.days.length > 0 && (
        <>
          <div className="grid">
            <Card title="Orders"><p>{sum('Orders')}</p></Card>
            <Card title="Units sold"><p>{sum('Units')}</p></Card>
            <Card title="Net revenue"><p>{money(sum('Net_revenue'))}</p></Card>
            <Card title="Tax collected"><p>{money(sum('Tax_collected'))}</p></Card>
          </div>

          <Card title="By day">
            <Table rowKey="Sale_date" rows={data.days} columns={[
              { key: 'Sale_date', label: 'Date', render: (r) => day(r.Sale_date) },
              { key: 'Orders', label: 'Orders', numeric: true },
              { key: 'Units', label: 'Units', numeric: true },
              { key: 'Gross_revenue', label: 'Gross', numeric: true, render: (r) => money(r.Gross_revenue) },
              { key: 'Refunded_revenue', label: 'Refunded', numeric: true, render: (r) => money(r.Refunded_revenue) },
              { key: 'Net_revenue', label: 'Net', numeric: true, render: (r) => money(r.Net_revenue) },
            ]} />
          </Card>

          <Card title="By category">
            <Table rowKey="Category_name" rows={data.byCategory} columns={[
              { key: 'Category_name', label: 'Category' },
              { key: 'Units', label: 'Units', numeric: true },
              { key: 'Net_revenue', label: 'Net revenue', numeric: true, render: (r) => money(r.Net_revenue) },
            ]} />
          </Card>

          <Card title="Top products">
            <Table rowKey="Name" rows={data.topProducts} columns={[
              { key: 'Name', label: 'Product' },
              { key: 'Units', label: 'Units', numeric: true },
              { key: 'Revenue', label: 'Revenue', numeric: true, render: (r) => money(r.Revenue) },
            ]} />
          </Card>
        </>
      )}
    </>
  );
}
