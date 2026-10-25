// Employee dashboard: three counts. Support and managers can see it.
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const [counts, setCounts] = useState(null);   // null = still loading
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/manager/dashboard')
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Could not load the dashboard.');
        setCounts(body);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>;
  if (counts === null) return <p>Loading...</p>;

  const box = { border: '1px solid #ccc', borderRadius: 8, padding: 16, minWidth: 160 };
  return (
    <section style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Dashboard</h1>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={box}><h2>{counts.openAlerts}</h2><p>Open low-stock alerts</p></div>
        <div style={box}><h2>{counts.pendingOrders}</h2><p>Pending supplier orders</p></div>
        <div style={box}><h2>{counts.returnsWaiting}</h2><p>Returns waiting</p></div>
      </div>
    </section>
  );
}