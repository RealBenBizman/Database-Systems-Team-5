import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { useAuth } from '../../../shared/auth.jsx';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '../../../shared/ui.jsx';
import { date, Pagination, useLoad } from './components.jsx';
import './Storefront.css';

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const resource = useLoad(() => api.get('/api/account/notifications', { unread, page }), [user?.id, unread, page]);
  useEffect(() => { if (resource.data && page > 1 && !resource.data.notifications.length) setPage(1); }, [resource.data, page]);

  async function mark(item, open = false) {
    setBusy(item ? item.id : 'all'); setError(null);
    try {
      await api.patch('/api/account/notifications', item ? { id: item.id } : { all: true });
      if (open) navigate(item.type === 'cart reminder' ? '/cart' : item.discountId ? `/shop?discountId=${item.discountId}` : '/shop');
      else resource.reload();
    } catch (err) { setError(err); }
    finally { setBusy(null); }
  }

  return <div className="sf-page sf-notifications-page">
    <PageHeader title="Notifications" subtitle="Your cart reminders and offers, all in one place." />
    <div className="sf-toolbar"><div className="row"><Button variant={unread ? 'secondary' : 'primary'} aria-pressed={!unread} onClick={() => { setUnread(false); setPage(1); }}>All</Button><Button variant={unread ? 'primary' : 'secondary'} aria-pressed={unread} onClick={() => { setUnread(true); setPage(1); }}>Unread{resource.data ? ` (${resource.data.unread})` : ''}</Button></div>
      <Button variant="secondary" loading={busy === 'all'} disabled={busy !== null || resource.loading || !resource.data?.unread} onClick={() => mark(null)}>Mark all read</Button></div>
    <p className="sf-muted sf-small">Manage your <Link to="/account">notification preferences</Link> in your account.</p>
    <ErrorBanner error={error || resource.error} />
    {resource.loading ? <Spinner label="Loading notifications..." /> : resource.error ? <Button variant="secondary" onClick={resource.reload}>Try again</Button>
      : resource.data.notifications.length ? <div className="stack">{resource.data.notifications.map((item) => <article key={item.id} className={`card sf-notification ${item.readAt ? '' : 'sf-notification-unread'}`}>
        <div className="sf-section-top"><h2>{item.type === 'cart reminder' ? 'Your cart is waiting' : 'An offer for you'}</h2><span className="sf-muted sf-small">{date(item.createdAt)}</span></div>
        {!item.readAt && <span className="tag">Unread</span>}<p>{item.message}</p>
        <div className="row"><Button variant="secondary" disabled={busy !== null} onClick={() => mark(item, true)}>{item.type === 'cart reminder' ? 'View cart' : 'Shop offer'}</Button>
          {!item.readAt && <button className="sf-text-button" type="button" disabled={busy !== null} onClick={() => mark(item)}>Mark read</button>}</div>
      </article>)}<Pagination page={page} pageSize={20} total={resource.data.total} change={setPage} /></div>
        : <EmptyState title={unread ? 'You are all caught up' : 'No notifications yet'}>New offers and cart reminders will appear here.</EmptyState>}
  </div>;
}
