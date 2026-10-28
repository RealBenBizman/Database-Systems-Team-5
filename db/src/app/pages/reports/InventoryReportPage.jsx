// Inventory report: stock against reorder level, stock value, and supplier orders by status.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Card, ErrorBanner, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

const STATUSES = ['Pending', 'Ordered', 'Received', 'Cancelled'];

const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function InventoryReportPage() {
  const [report, setReport] = useState(null);   // null = still loading
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/reports/inventory')
      .then(setReport)
      .catch((e) => setError(e.message));
  }, []);

  const header = <PageHeader title="Inventory report" subtitle="Stock against reorder level, stock value, and supplier orders by status." />;

  if (error) return <>{header}<ErrorBanner>{error}</ErrorBanner></>;
  if (report === null) return <>{header}<Spinner /></>;

  const count = (status) => {
    const found = report.ordersByStatus.find((o) => o.status === status);
    return found ? found.orders : 0;
  };

  const columns = [
    { key: 'name', label: 'Product' },
    { key: 'category', label: 'Category' },
    { key: 'stock', label: 'Stock', numeric: true },
    { key: 'threshold', label: 'Reorder at', numeric: true },
    {
      key: 'level', label: 'Level',
      render: (p) => (p.level === 'OK'
        ? 'OK'
        : <strong style={{ color: 'var(--color-danger)' }}>{p.level}</strong>),
    },
    { key: 'valueAtCost', label: 'Value at cost', numeric: true, render: (p) => money(p.valueAtCost) },
    {
      key: 'alertAgeDays', label: 'Open alert for', numeric: true,
      render: (p) => (p.alertAgeDays == null ? '' : p.alertAgeDays + ' days'),
    },
  ];

  return (
    <>
      {header}
      <div className="grid" style={{ marginBottom: 24 }}>
        <Card title={money(report.totals.valueAtCost)}>
          <p className="card-muted">Stock value at cost</p>
        </Card>
        <Card title={String(report.totals.lowOrOut)}>
          <p className="card-muted">Products low or out of stock</p>
        </Card>
        {STATUSES.map((s) => (
          <Card key={s} title={String(count(s))}>
            <p className="card-muted">{s} supplier orders</p>
          </Card>
        ))}
      </div>
      <Table columns={columns} rows={report.products} rowKey="productId" empty="No products." />
    </>
  );
}
