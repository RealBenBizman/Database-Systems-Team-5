// Rewards (customers): points balance, tier, progress to the next tier, and the points history.
// Points are earned and taken back by the database (sales and refunds); this page only shows them.
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';
import { date, useLoad } from '../storefront/components.jsx';
import '../storefront/Storefront.css';
import '../checkout/Orders.css';
import './Returns.css';

const count = (n) => Number(n || 0).toLocaleString('en-US');
const signed = (n) => (Number(n) > 0 ? `+${count(n)}` : count(n));

export default function RewardsPage() {
  const resource = useLoad(() => api.get('/api/rewards'), []);

  if (resource.loading && !resource.data) return <Spinner label="Loading your rewards..." />;
  if (resource.error && !resource.data) {
    return <><ErrorBanner error={resource.error} /><Button variant="secondary" onClick={resource.reload}>Try again</Button></>;
  }
  const { points, tier, nextTier, program, tiers, history } = resource.data;

  // progress from the current tier's minimum (or 0) to the next tier's minimum
  const from = tier ? Number(tier.minPoints) : 0;
  const percent = nextTier ? Math.max(0, Math.min(100, Math.round(((points - from) / (Number(nextTier.minPoints) - from)) * 100))) : 100;
  const perDollar = program ? Number(program.pointsPerDollar) : null;

  const tierColumns = [
    { key: 'name', label: 'Tier' },
    { key: 'minPoints', label: 'Points needed', numeric: true, render: (t) => count(t.minPoints) },
    { key: 'perk', label: 'Perk', render: (t) => t.perk || '' },
    { key: 'status', label: '', render: (t) => (tier && t.name === tier.name ? <span className="tag rw-tag-current">Your tier</span>
      : nextTier && t.name === nextTier.name ? <span className="tag rw-tag-next">Next</span> : (t.reached ? 'Reached' : '')) },
  ];
  const historyColumns = [
    { key: 'date', label: 'Date', render: (h) => date(h.date) },
    { key: 'reason', label: 'Activity', render: (h) => (h.orderId ? <>{h.reason} (<Link to={`/orders/${h.orderId}`}>order #{h.orderId}</Link>)</> : h.reason) },
    { key: 'points', label: 'Points', numeric: true, render: (h) => <span className={Number(h.points) < 0 ? 'rw-neg' : 'rw-pos'}>{signed(h.points)}</span> },
    { key: 'balanceAfter', label: 'Balance', numeric: true, render: (h) => count(h.balanceAfter) },
  ];

  return <div className="sf-page">
    <PageHeader title="Rewards" subtitle={perDollar === null ? 'Earn points on every order.'
      : `Earn ${perDollar} ${perDollar === 1 ? 'point' : 'points'} for every $1 you spend (after discounts, before tax).`} />

    <div className="rw-hero">
      <Card title="Your points">
        <div className="rw-points">{count(points)}</div>
        <p className="card-muted">{tier ? <>Current tier: <strong>{tier.name}</strong>{tier.perk ? ` - ${tier.perk}` : ''}</> : 'No tier yet'}</p>
      </Card>
      <Card title={nextTier ? `Next tier: ${nextTier.name}` : (tiers.length ? 'Top tier reached' : 'Tiers')}>
        {nextTier ? <>
          <div className="rw-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`Progress to ${nextTier.name}`}><span style={{ width: `${percent}%` }} /></div>
          <p className="card-muted"><strong>{count(nextTier.pointsToGo)}</strong> more {nextTier.pointsToGo === 1 ? 'point' : 'points'} to reach {nextTier.name}{nextTier.perk ? ` (${nextTier.perk})` : ''}.</p>
        </> : <p className="card-muted">{tiers.length ? 'You have reached the highest tier. Thank you for shopping with us!' : 'There are no reward tiers at the moment.'}</p>}
      </Card>
    </div>

    {tiers.length > 0 && <section className="co-section" aria-label="Tiers">
      <h2>Tiers</h2>
      <div className="co-nowrap"><Table columns={tierColumns} rows={tiers} rowKey="name" /></div>
    </section>}

    <section className="co-section" aria-label="Points history">
      <h2>Points history</h2>
      {history.length === 0
        ? <EmptyState title="No points yet" action={<Button to="/shop">Browse the shop</Button>}>Points show up here after your first order.</EmptyState>
        : <>
          <div className="co-nowrap"><Table columns={historyColumns} rows={history} rowKey="id" /></div>
          <p className="rt-note">When you return items, the points you earned on them are taken back once the refund is issued. Showing your latest 100 entries.</p>
        </>}
    </section>
  </div>;
}
