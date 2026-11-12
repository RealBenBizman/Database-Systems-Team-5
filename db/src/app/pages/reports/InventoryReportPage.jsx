// Inventory report: filters, a summary, and every number shown next to the rows it comes from.
// The report ends with the records behind it: the products shown, then the supplier orders.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { Card, ErrorBanner, Field, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';
import { BackToReports } from '../../../shared/reports.jsx';
import RecordsTable from './RecordsTable.jsx';

const STATUSES = ['Pending', 'Ordered', 'Received', 'Cancelled'];
const FAST_30 = 3;   // sold at least this many units in 30 days = Fast

const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const day = (d) => (d ? String(d).slice(0, 10) : '');
const cents = (n) => Math.round(Number(n || 0) * 100);

// how fast a product sells, worked out from units sold
function movement(p) {
  if (p.sold30 >= FAST_30) return 'Fast';
  if (p.sold30 > 0) return 'Normal';
  if (p.sold90 > 0) return 'Slow';
  return p.stock > 0 ? 'Unsold 90+ days' : 'No sales';
}

export default function InventoryReportPage() {
  const [report, setReport] = useState(null);   // null = still loading
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');
  const [level, setLevel] = useState('All');
  const [move, setMove] = useState('All');
  const [search, setSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('All');

  useEffect(() => {
    api.get('/api/reports/inventory')
      .then(setReport)
      .catch((e) => setError(e.message));
  }, []);

  const header = (
    <>
      <BackToReports />
      <PageHeader title="Inventory report" subtitle="Stock, sales speed and supplier orders. Every number comes from the rows shown below it." />
    </>
  );

  if (error) return <>{header}<ErrorBanner>{error}</ErrorBanner></>;
  if (report === null) return <>{header}<Spinner /></>;

  const count = (status) => {
    const found = report.ordersByStatus.find((o) => o.status === status);
    return found ? found.orders : 0;
  };

  // the filters
  const categories = [...new Set(report.products.map((p) => p.category))].sort();
  const text = search.trim().toLowerCase();
  const rows = report.products
    .filter((p) => category === 'All' || p.category === category)
    .filter((p) => level === 'All' || p.level === level)
    .filter((p) => !text || p.name.toLowerCase().includes(text) || String(p.sku || '').toLowerCase().includes(text))
    .map((p) => ({
      ...p,
      daysLeft: p.sold30 > 0 ? Math.floor(p.stock / (p.sold30 / 30)) : null,
      movement: movement(p),
    }))
    .filter((p) => move === 'All' || p.movement === move);

  // the numbers, worked out from the rows that are shown
  const totalValue = rows.reduce((sum, p) => sum + cents(p.valueAtCost), 0) / 100;
  const totalUnits = rows.reduce((sum, p) => sum + p.stock, 0);
  const totalSold30 = rows.reduce((sum, p) => sum + p.sold30, 0);
  const lowOrOut = rows.filter((p) => p.level !== 'OK').length;

  // value by category: these rows add up to the stock value card
  const catRows = [...new Set(rows.map((p) => p.category))].sort().map((c) => {
    const items = rows.filter((p) => p.category === c);
    const value = items.reduce((sum, p) => sum + cents(p.valueAtCost), 0) / 100;
    return {
      category: c,
      products: items.length,
      units: items.reduce((sum, p) => sum + p.stock, 0),
      value,
      share: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
    };
  });

  // supplier orders, filtered by status
  const orders = report.orders.filter((o) => orderStatus === 'All' || o.status === orderStatus);
  const orderUnits = orders.reduce((sum, o) => sum + Number(o.units || 0), 0);
  const orderTotal = orders.reduce((sum, o) => sum + cents(o.total), 0) / 100;

  // supplier performance: days between ordering and receiving, from the received orders
  const supplierRows = [...new Set(report.orders.map((o) => o.supplier))].sort().map((name) => {
    const mine = report.orders.filter((o) => o.supplier === name);
    const received = mine.filter((o) => o.status === 'Received' && o.receivedDate);
    const days = received.map((o) => (new Date(day(o.receivedDate)) - new Date(day(o.orderDate))) / 86400000);
    return {
      supplier: name,
      orders: mine.length,
      received: received.length,
      cancelled: mine.filter((o) => o.status === 'Cancelled').length,
      avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      spent: received.reduce((sum, o) => sum + cents(o.total), 0) / 100,
    };
  });

  // "what this means": plain sentences worked out from the rows above
  const notes = [];
  const outNow = rows.filter((p) => p.level === 'Out of stock');
  if (outNow.length) notes.push(`${outNow.length} product(s) are out of stock: ${outNow.map((p) => p.name).join(', ')}.`);
  const soon = rows.filter((p) => p.daysLeft != null && p.daysLeft <= 14 && p.stock > 0);
  if (soon.length) notes.push(`${soon.length} product(s) will sell out within 14 days at their current sales speed: ${soon.map((p) => p.name).join(', ')}.`);
  const noOrder = rows.filter((p) => p.level !== 'OK' && p.alertOrderId == null);
  if (noOrder.length) notes.push(`${noOrder.length} low or out-of-stock product(s) have no supplier order yet. Place one on Supplier orders.`);
  const unsold = rows.filter((p) => p.movement === 'Unsold 90+ days');
  if (unsold.length) {
    const tied = unsold.reduce((sum, p) => sum + cents(p.valueAtCost), 0) / 100;
    notes.push(`${unsold.length} product(s) have not sold in 90 days. ${money(tied)} is tied up in them.`);
  }
  if (notes.length === 0) notes.push('Nothing needs attention for the products shown.');

  // the records: one row per product shown, with a total row under the numeric columns
  const productColumns = [
    { key: 'name', label: 'Product' },
    { key: 'category', label: 'Category' },
    { key: 'stock', label: 'Stock', numeric: true, total: totalUnits },
    { key: 'threshold', label: 'Reorder at', numeric: true },
    { key: 'costPrice', label: 'Cost each', numeric: true, render: (p) => money(p.costPrice) },
    { key: 'valueAtCost', label: 'Value at cost', numeric: true, render: (p) => money(p.valueAtCost), total: money(totalValue) },
    { key: 'sold30', label: 'Sold 30d', numeric: true, total: totalSold30 },
    {
      key: 'daysLeft', label: 'Days left', numeric: true,
      render: (p) => (p.daysLeft == null ? 'No sales' : p.daysLeft > 180 ? '180+ days' : p.daysLeft + ' days'),
    },
    { key: 'movement', label: 'Movement' },
    {
      key: 'level', label: 'Level',
      render: (p) => (p.level === 'OK'
        ? 'OK'
        : <strong style={{ color: 'var(--color-danger)' }}>{p.level}</strong>),
    },
    {
      key: 'lastSale', label: 'Last sale',
      render: (p) => (p.lastSale ? day(p.lastSale) : 'None on record'),
      sortValue: (p) => (p.lastSale ? day(p.lastSale) : null),
    },
    {
      key: 'alertAgeDays', label: 'Open alert for', numeric: true,
      render: (p) => (p.alertAgeDays == null ? '' : p.alertAgeDays + ' days'),
    },
  ];

  // the supplier orders: promised lead time against what really happened
  const orderColumns = [
    { key: 'orderId', label: 'Order' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'orderDate', label: 'Ordered', render: (o) => day(o.orderDate), sortValue: (o) => day(o.orderDate) },
    { key: 'receivedDate', label: 'Received', render: (o) => day(o.receivedDate), sortValue: (o) => day(o.receivedDate) },
    {
      key: 'promisedDays', label: 'Promised', numeric: true,
      render: (o) => (o.promisedDays == null ? 'None on file' : o.promisedDays + ' days'),
    },
    {
      key: 'daysLate', label: 'Days late', numeric: true,
      render: (o) => {
        if (o.daysLate == null) return o.status === 'Cancelled' ? '' : 'No promise to compare';
        if (o.daysLate === 0) return o.open ? 'Within promise' : 'On time';
        return <strong style={{ color: 'var(--color-danger)' }}>{o.daysLate} days {o.open ? 'overdue' : 'late'}</strong>;
      },
    },
    { key: 'units', label: 'Units', numeric: true, total: orderUnits },
    { key: 'total', label: 'Total', numeric: true, render: (o) => money(o.total), total: money(orderTotal) },
    { key: 'status', label: 'Status' },
  ];

  return (
    <>
      {header}
      <div className="row">
        <Field label="Category" as="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Field>
        <Field label="Stock level" as="select" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="All">All</option>
          <option value="OK">OK</option>
          <option value="Low">Low</option>
          <option value="Out of stock">Out of stock</option>
        </Field>
        <Field label="Movement" as="select" value={move} onChange={(e) => setMove(e.target.value)}>
          <option value="All">All</option>
          <option value="Fast">Fast</option>
          <option value="Normal">Normal</option>
          <option value="Slow">Slow</option>
          <option value="Unsold 90+ days">Unsold 90+ days</option>
          <option value="No sales">No sales</option>
        </Field>
        <Field label="Search" type="text" placeholder="Product name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="card-muted" style={{ marginBottom: 16 }}>
        Showing {rows.length} of {report.products.length} products. {lowOrOut} of them are low or out of stock,
        and {money(totalValue)} is tied up in the stock shown.
      </p>
      <Card title="What this means">
        <ul>
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Card>
      <div className="grid" style={{ marginTop: 24, marginBottom: 24 }}>
        <Card title={money(totalValue)}>
          <p className="card-muted">Stock value at cost</p>
          <p className="card-muted">Stock x cost each, added up for the {rows.length} products below.</p>
        </Card>
        <Card title={String(totalUnits)}>
          <p className="card-muted">Units in stock</p>
          <p className="card-muted">The Stock column added up.</p>
        </Card>
        <Card title={String(lowOrOut)}>
          <p className="card-muted">Products low or out of stock</p>
          <p className="card-muted">Stock at or below Reorder at.</p>
        </Card>
        {STATUSES.map((s) => (
          <Card key={s} title={String(count(s))}>
            <p className="card-muted">{s} supplier orders</p>
          </Card>
        ))}
      </div>
      <Card title="Stock value by category">
        <Table rowKey="category" rows={catRows} empty="No products match these filters." columns={[
          { key: 'category', label: 'Category' },
          { key: 'products', label: 'Products', numeric: true },
          { key: 'units', label: 'Units', numeric: true },
          { key: 'value', label: 'Value at cost', numeric: true, render: (r) => money(r.value) },
          { key: 'share', label: 'Share of total', numeric: true, render: (r) => r.share + '%' },
        ]} />
        <p className="card-muted">These category values add up to {money(totalValue)}, the Stock value at cost card.</p>
      </Card>
      <div style={{ height: 24 }} />
      <Card title="Supplier performance">
        <Table rowKey="supplier" rows={supplierRows} empty="No supplier orders yet." columns={[
          { key: 'supplier', label: 'Supplier' },
          { key: 'orders', label: 'Orders', numeric: true },
          { key: 'received', label: 'Received', numeric: true },
          { key: 'cancelled', label: 'Cancelled', numeric: true },
          { key: 'avgDays', label: 'Avg days to deliver', numeric: true, render: (s) => (s.avgDays == null ? 'No data' : s.avgDays) },
          { key: 'spent', label: 'Spent (received)', numeric: true, render: (s) => money(s.spent) },
        ]} />
        <p className="card-muted">Days to deliver = received date minus order date, averaged over received orders.</p>
      </Card>
      <div style={{ height: 24 }} />
      <RecordsTable
        title="Products in this report"
        noun="products"
        rows={rows}
        allCount={report.products.length}
        columns={productColumns}
        rowKey="productId"
        totalLabel={`Total of ${rows.length} ${rows.length === 1 ? 'product' : 'products'}`}
        empty="No products match these filters."
        note="These are the products behind every number above. The total row matches the Stock value at cost and Units in stock cards."
      />
      <div style={{ height: 24 }} />
      <RecordsTable
        title="Supplier orders in this report"
        noun="supplier orders"
        rows={orders}
        allCount={report.orders.length}
        columns={orderColumns}
        rowKey="orderId"
        totalLabel={`Total of ${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
        empty="No supplier orders with this status."
        controls={(
          <Field label="Status" as="select" value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)}>
            <option value="All">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Field>
        )}
        note="Promised is the longest lead time the supplier lists for the products on the order. The status cards above count every order; this table follows the Status filter."
      />
    </>
  );
}
