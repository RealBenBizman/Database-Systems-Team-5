// Employee dashboard: three counts. Each box links to the screen that deals with it.
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api.js';
import { useAuth } from '../../../shared/auth.jsx';
import { Card, ErrorBanner, PageHeader, Spinner } from '../../../shared/ui.jsx';

export default function DashboardPage() {
  const [counts, setCounts] = useState(null);   // null = still loading
  const [error, setError] = useState('');
  const { user } = useAuth();
  // supplier orders are manager-only; support gets the read-only inventory report instead
  const ordersLink = user && user.role === 'manager' ? '/staff/suppliers' : '/staff/reports/inventory';

  useEffect(() => {
    api.get('/api/manager/dashboard')
      .then(setCounts)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What needs attention right now." />
      <ErrorBanner>{error}</ErrorBanner>
      {counts === null && !error && <Spinner />}
      {counts && (
        <div className="grid">
          <Card title={String(counts.openAlerts)} to="/staff/inventory">
            <p className="card-muted">Open low-stock alerts</p>
          </Card>
          <Card title={String(counts.pendingOrders)} to={ordersLink}>
            <p className="card-muted">Pending supplier orders</p>
          </Card>
          <Card title={String(counts.returnsWaiting)} to="/staff/returns">
            <p className="card-muted">Returns waiting</p>
          </Card>
        </div>
      )}
    </>
  );
}