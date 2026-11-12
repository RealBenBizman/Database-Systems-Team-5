
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import {
  Button, Card, PageHeader, Spinner,
  EmptyState, ErrorBanner, Field, Table
} from '../../../shared/ui.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const day = (d) => (d ? String(d).slice(0, 10) : '');

export default function ReturnsReportPage() {
  const [from, setFrom] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  );
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  function load(e) {
    if (e) e.preventDefault();

    setLoading(true);
    setError(null);

    api.get('/api/reports/returns', {
      from, to, status, search
    })
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const summary = data?.summary || {};
  const transactions = data?.transactions || [];

  return (
    <>
      <PageHeader
        title="Returns and refunds report"
        subtitle="Analyze return requests, refunds, and transaction history."
      />

      {/* Report filters */}
      <form onSubmit={load} className="row">
        <Field
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />

        <Field
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />

        <label>
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="requested">Requested</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>

        <Field
          label="Search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Product or return ID"
        />

        <Button type="submit" loading={loading}>
          Run report
        </Button>
      </form>

      <ErrorBanner error={error} />

      {loading && <Spinner label="Loading returns report..." />}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid">
            <Card title="Total returns">
              <p>{summary.Total_Returns || 0}</p>
            </Card>

            <Card title="Refunded cash">
              <p>{money(summary.Total_Refunded_Cash)}</p>
            </Card>

            <Card title="Requested">
              <p>{summary.Requested_Returns || 0}</p>
            </Card>

            <Card title="Approved">
              <p>{summary.Approved_Returns || 0}</p>
            </Card>

            <Card title="Refunded">
              <p>{summary.Refunded_Returns || 0}</p>
            </Card>

            <Card title="Denied">
              <p>{summary.Denied_Returns || 0}</p>
            </Card>
          </div>

          {/* Transaction table */}
          <Card title="Return transactions">
            {transactions.length === 0 ? (
              <EmptyState title="No returns match these filters" />
            ) : (
              <Table
                rowKey="Return_id"
                rows={transactions}
                columns={[
                  {
                    key: 'Return_id',
                    label: 'Return ID'
                  },
                  {
                    key: 'Transaction_id',
                    label: 'Sale ID'
                  },
                  {
                    key: 'Product_name',
                    label: 'Product'
                  },
                  {
                    key: 'Request_date',
                    label: 'Date',
                    render: (r) => day(r.Request_date)
                  },
                  {
                    key: 'Reason',
                    label: 'Reason'
                  },
                  {
                    key: 'Quantity',
                    label: 'Qty',
                    numeric: true
                  },
                  {
                    key: 'Refund_amount',
                    label: 'Refund',
                    numeric: true,
                    render: (r) => money(r.Refund_amount)
                  },
                  {
                    key: 'Status',
                    label: 'Status',
                    render: (r) =>
                      r.Status.charAt(0).toUpperCase() +
                      r.Status.slice(1)
                  }
                ]}
              />
            )}
          </Card>
        </>
      )}
    </>
  );
}
