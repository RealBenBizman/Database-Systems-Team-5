// My returns (customers): every return requested, newest first, with its items and where it stands.
// A return starts as "requested", then staff approve or deny it, and an approved one is refunded.
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Banner, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '../../../shared/ui.jsx';
import { date, money, useLoad } from '../storefront/components.jsx';
import { ReturnItems, StatusTag, statusText } from './returnParts.jsx';
import '../storefront/Storefront.css';
import '../checkout/Orders.css';
import './Returns.css';

export default function MyReturnsPage() {
  const location = useLocation();
  const resource = useLoad(() => api.get('/api/returns'), []);
  const requested = location.state && location.state.requested;

  if (resource.loading && !resource.data) return <Spinner label="Loading your returns..." />;
  if (resource.error && !resource.data) {
    return <><ErrorBanner error={resource.error} /><Button variant="secondary" onClick={resource.reload}>Try again</Button></>;
  }
  const { returns } = resource.data;

  return <div className="sf-page">
    <PageHeader title="My returns" subtitle="Items you have sent back, newest first." />
    {requested && <Banner kind="success">Your return #{requested} was sent. We will review it and update this page.</Banner>}
    {returns.length === 0
      ? <EmptyState title="No returns yet" action={<Button to="/orders">See my orders</Button>}>
        To return something, open the order and choose &ldquo;Return items from this order&rdquo;.
      </EmptyState>
      : <div className="rt-list">{returns.map((r) => <Card key={r.id}>
        <div className="rt-head">
          <h2>Return #{r.id}</h2>
          <StatusTag status={r.status} />
        </div>
        <p className="rt-meta">
          Requested {date(r.requestedAt)} &middot; From <Link to={`/orders/${r.orderId}`}>order #{r.orderId}</Link>
        </p>
        <blockquote className="rt-reason">{r.reason}</blockquote>
        <ReturnItems items={r.items} />
        <div className="rt-total">
          <span>{r.status === 'refunded' ? 'Refunded' : r.status === 'denied' ? 'Refund (not issued)' : 'Expected refund'}</span>
          <span>{money(r.refundTotal)}</span>
        </div>
        <p className="rt-note">{statusText(r)}</p>
      </Card>)}</div>}
  </div>;
}
