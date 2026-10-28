// Request a return (customers): choose items and quantities from one order, give a reason, send it.
// The order comes from the link on the order page: /returns/new?order=<id>.
// What can still be returned, and the exact refund for each quantity, come from GET /api/returns/eligibility
// (the same formula as the database guard), so nothing is calculated here.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Banner, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner } from '../../../shared/ui.jsx';
import { date, money, useLoad } from '../storefront/components.jsx';
import '../storefront/Storefront.css';
import '../checkout/Orders.css';
import './Returns.css';

const BLOCKED = {
  expired: (order) => `The 30-day return window for this order ended on ${date(order.deadline)}.`,
  voided: () => 'Voided orders cannot be returned.',
  nothing_left: () => 'Everything in this order is already on a return.',
};

export default function RequestReturnPage() {
  const [params] = useSearchParams();
  const orderId = params.get('order') || '';
  const navigate = useNavigate();
  const resource = useLoad(() => (orderId ? api.get('/api/returns/eligibility', { order: orderId }) : Promise.resolve(null)), [orderId]);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  if (!orderId) {
    return <EmptyState title="Choose an order first" action={<Button to="/orders">Go to my orders</Button>}>
      Open one of your orders and use &ldquo;Return items from this order&rdquo;.
    </EmptyState>;
  }
  if (resource.loading && !resource.data) return <Spinner label="Loading your order..." />;
  if (resource.error && !resource.data) {
    if (resource.error.status === 404 || resource.error.status === 400) {
      return <EmptyState title="Order not found" action={<Button to="/orders">Back to my orders</Button>}>We could not find that order in your account.</EmptyState>;
    }
    return <><ErrorBanner error={resource.error} /><Button variant="secondary" onClick={resource.reload}>Try again</Button></>;
  }

  const { order, items } = resource.data;
  const quantityOf = (item) => quantities[item.productId] || 0;
  const chosen = items.filter((item) => quantityOf(item) > 0);
  const total = Math.round(chosen.reduce((sum, item) => sum + item.refunds[quantityOf(item) - 1] * 100, 0)) / 100;
  const canSend = order.canReturn && chosen.length > 0 && reason.trim().length > 0 && !sending;

  async function submit(event) {
    event.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.post('/api/returns', {
        orderId: Number(orderId),
        reason: reason.trim(),
        items: chosen.map((item) => ({ productId: item.productId, quantity: quantityOf(item) })),
      });
      navigate('/returns', { state: { requested: result.returnId } });
    } catch (err) {
      setError(err);
      setQuantities({});
      resource.reload(); // what is left to return may have changed
    } finally {
      setSending(false);
    }
  }

  return <div className="sf-page">
    <PageHeader title={`Return items from order #${order.id}`} subtitle={`Placed ${date(order.date)}`} />
    {order.canReturn
      ? <Banner kind="info">
        {order.daysLeft === 0 ? 'Today is the last day' : `You have ${order.daysLeft} ${order.daysLeft === 1 ? 'day' : 'days'} left`} to return items from this order (until {date(order.deadline)}).
      </Banner>
      : <Banner kind="error">{BLOCKED[order.blockedReason](order)}</Banner>}
    <ErrorBanner error={error} />

    <form className="co-layout" onSubmit={submit} noValidate>
      <div className="co-main">
        <Card title="Choose what to return">
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th scope="col">Product</th><th scope="col" className="num">Bought</th>
                <th scope="col" className="num">Already returned</th><th scope="col">Return</th><th scope="col" className="num">Refund</th>
              </tr></thead>
              <tbody>
                {items.map((item) => <tr key={item.productId}>
                  <td><Link to={`/shop/${item.productId}`}>{item.name}</Link></td>
                  <td className="num">{item.purchased}</td>
                  <td className="num">{item.returned}</td>
                  <td>{item.available > 0 && order.canReturn
                    ? <select className="rt-qty" value={quantityOf(item)} aria-label={`How many of ${item.name} to return`}
                      onChange={(event) => setQuantities({ ...quantities, [item.productId]: Number(event.target.value) })}>
                      {Array.from({ length: item.available + 1 }, (_, q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                    : <span className="rt-done">{item.available === 0 ? 'Already returned' : '-'}</span>}
                  </td>
                  <td className="num">{quantityOf(item) > 0 ? money(item.refunds[quantityOf(item) - 1]) : ''}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Why are you returning these items?">
          <Field label="Reason" id="return-reason" as="textarea" rows={3} maxLength={200} value={reason}
            disabled={!order.canReturn} onChange={(event) => setReason(event.target.value)}
            hint={`${reason.length} of 200 characters`} />
        </Card>
      </div>

      <aside className="co-side" aria-label="Your refund">
        <Card title="Your refund">
          <dl className="co-summary">
            <div><dt>Items</dt><dd>{chosen.reduce((sum, item) => sum + quantityOf(item), 0)}</dd></div>
            <div className="co-total"><dt>Refund</dt><dd>{money(total)}</dd></div>
          </dl>
          <Button type="submit" block loading={sending} disabled={!canSend}>Request return</Button>
          {order.canReturn && chosen.length === 0 && <p className="rt-note">Choose at least one item.</p>}
          {order.canReturn && chosen.length > 0 && reason.trim().length === 0 && <p className="rt-note">Tell us why you are returning them.</p>}
        </Card>
        <Card title="How returns work">
          <ul className="rt-policy">
            <li>Return requests must be made within 30 days of the order.</li>
            <li>The refund includes the tax you paid on those items.</li>
            <li>Our team reviews every request. Once it is refunded, the loyalty points you earned on those items are taken back.</li>
          </ul>
        </Card>
        <div className="co-links"><Link to={`/orders/${order.id}`}>Back to the order</Link><Link to="/returns">My returns</Link></div>
      </aside>
    </form>
  </div>;
}
