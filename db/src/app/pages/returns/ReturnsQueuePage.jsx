// Returns queue (support and managers): review customer returns.
// Requested -> approve or deny. Approved -> refund. The database does the rest when a return is refunded
// (items go back into stock, the points earned on them are taken back); this page only sends the decision.
import { useState } from 'react';
import { api } from '../../../shared/api.js';
import { Banner, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '../../../shared/ui.jsx';
import { date, money, useLoad } from '../storefront/components.jsx';
import { ReturnItems, STATUS_LABELS, StatusTag } from './returnParts.jsx';
import '../storefront/Storefront.css';
import '../checkout/Orders.css';
import './Returns.css';

const TABS = ['requested', 'approved', 'refunded', 'denied', 'all'];
const TAB_LABELS = { ...STATUS_LABELS, requested: 'To review', all: 'All' };
const DONE = { approve: 'approved', deny: 'denied', refund: 'refunded' };
const CONFIRM = {
  deny: (r) => `Deny return #${r.id}? The customer will not be refunded.`,
  refund: (r) => `Refund ${money(r.refundTotal)} for return #${r.id}? The items go back into stock and the points the customer earned on them are taken back. This cannot be undone.`,
};

export default function ReturnsQueuePage() {
  const [status, setStatus] = useState('requested');
  const resource = useLoad(() => api.get('/api/returns', { status }), [status]);
  const [confirming, setConfirming] = useState(null); // { id, action }
  const [working, setWorking] = useState(null);       // id being updated
  const [error, setError] = useState(null);
  const [done, setDone] = useState('');

  async function act(r, action) {
    setWorking(r.id);
    setError(null);
    setDone('');
    try {
      await api.patch(`/api/returns/${r.id}`, { action });
      setDone(`Return #${r.id} was ${DONE[action]}.`);
    } catch (err) {
      setError(err); // for example 409: another employee handled it first
    } finally {
      setConfirming(null);
      setWorking(null);
      resource.reload();
    }
  }

  const shown = resource.data;
  const counts = shown ? shown.counts : null;
  const header = <PageHeader title="Returns queue" subtitle="Review the returns customers have requested. Oldest first." />;

  if (resource.loading && !shown) return <>{header}<Spinner label="Loading returns..." /></>;
  if (resource.error && !shown) return <>{header}<ErrorBanner error={resource.error} /><Button variant="secondary" onClick={resource.reload}>Try again</Button></>;

  const { returns } = shown;
  const button = (r, action, label, variant) => <Button variant={variant} loading={working === r.id}
    disabled={working !== null} onClick={() => (action === 'approve' ? act(r, action) : setConfirming({ id: r.id, action }))}>{label}</Button>;

  return <div className="sf-page">
    {header}
    <div className="rt-tabs" role="group" aria-label="Filter by status">
      {TABS.map((tab) => <Button key={tab} variant={tab === status ? 'primary' : 'secondary'} aria-pressed={tab === status}
        onClick={() => { setStatus(tab); setConfirming(null); setError(null); setDone(''); }}>
        {TAB_LABELS[tab]}{counts && tab !== 'all' ? ` (${counts[tab]})` : ''}
      </Button>)}
    </div>
    {done && <Banner kind="success">{done}</Banner>}
    <ErrorBanner error={error} />
    <ErrorBanner error={resource.error} />

    {returns.length === 0
      ? <EmptyState title={status === 'requested' ? 'No returns waiting' : 'No returns here'}>
        {status === 'requested' ? 'Every request has been reviewed.' : 'Nothing matches this filter.'}
      </EmptyState>
      : <div className="rt-list">{returns.map((r) => <Card key={r.id}>
        <div className="rt-head">
          <h2>Return #{r.id}</h2>
          <StatusTag status={r.status} />
        </div>
        <p className="rt-meta">
          {r.customerName} &middot; Requested {date(r.requestedAt)} &middot; From order #{r.orderId}
          {r.handledBy ? <> &middot; Handled by {r.handledBy}</> : null}
        </p>
        <blockquote className="rt-reason">{r.reason}</blockquote>
        <ReturnItems items={r.items} />
        <div className="rt-total"><span>Refund</span><span>{money(r.refundTotal)}</span></div>
        {r.status === 'refunded' && <p className="rt-note">Refunded on {date(r.refundedAt)}.</p>}

        {confirming && confirming.id === r.id
          ? <div className="rt-confirm" role="alertdialog" aria-label="Confirm">
            <p>{CONFIRM[confirming.action](r)}</p>
            <div className="rt-actions">
              <Button variant={confirming.action === 'deny' ? 'danger' : 'primary'} loading={working === r.id} onClick={() => act(r, confirming.action)}>
                {confirming.action === 'deny' ? 'Yes, deny' : 'Yes, refund'}
              </Button>
              <Button variant="secondary" disabled={working !== null} onClick={() => setConfirming(null)}>Cancel</Button>
            </div>
          </div>
          : <div className="rt-actions">
            {r.status === 'requested' && <>{button(r, 'approve', 'Approve', 'primary')}{button(r, 'deny', 'Deny', 'secondary')}</>}
            {r.status === 'approved' && button(r, 'refund', 'Issue refund', 'primary')}
          </div>}
      </Card>)}</div>}
  </div>;
}
