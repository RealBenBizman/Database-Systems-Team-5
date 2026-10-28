// Checkout page. Written by Terry (Part 2).
// Added by the team: the cart comes from the same function as the cart page, so it shows
// the discounted prices, and the Place order button is disabled when an item is
// unavailable or short on stock.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorBanner, Field, Table } from '../../../shared/ui.jsx';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function Checkout() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [method, setMethod] = useState('credit');
  const [cardLast4, setCardLast4] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/checkout').then(setData).catch(setLoadError);
  }, []);

  async function placeOrder(e) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(cardLast4)) {
      setError(new Error('Enter the last 4 digits of the card.'));
      return;
    }
    setPlacing(true);
    try {
      const r = await api.post('/api/checkout', { method, cardLast4 });
      navigate(`/checkout/confirmation/${r.transactionId}`, { replace: true });
    } catch (err) {
      setError(err);
      setPlacing(false);
    }
  }

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!data) return <Spinner label="Loading your cart..." />;
  if (data.items.length === 0) {
    return <EmptyState title="Your cart is empty" action={<Button to="/shop">Browse the shop</Button>} />;
  }

  const a = data.address;
  const itemsOk = data.items.every((i) => i.available);

  return (
    <>
      <PageHeader title="Checkout" subtitle="Review your order and pay." />
      <ErrorBanner error={error} />
      {!itemsOk && (
        <ErrorBanner>Some items are no longer available in the quantity you chose. Update your cart before paying.</ErrorBanner>
      )}

      <Card title="Items">
        <Table rowKey="id" rows={data.items} columns={[
          { key: 'name', label: 'Product' },
          { key: 'quantity', label: 'Qty', numeric: true },
          { key: 'price', label: 'Price', numeric: true, render: (r) => money(r.price) },
          { key: 'discountAmount', label: 'Discount', numeric: true, render: (r) => money(r.discountAmount) },
          { key: 'lineTotal', label: 'Total', numeric: true, render: (r) => money(r.lineTotal) },
        ]} />
        <p>Cart subtotal: <strong>{money(data.subtotal)}</strong></p>
        <p className="card-muted">Tax is added when you place the order.</p>
      </Card>

      <Card title="Ship to">
        {a ? (
          <p>{a.Recipient_name}<br />{a.Street}{a.Apt ? `, ${a.Apt}` : ''}<br />{a.City}, {a.State} {a.Zip}</p>
        ) : (
          <EmptyState title="No default address" action={<Button to="/account">Add an address</Button>}>
            Add a default shipping address in your account first.
          </EmptyState>
        )}
      </Card>

      {a && (
        <Card title="Payment">
          <form onSubmit={placeOrder}>
            <Field label="Card type" as="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </Field>
            <Field label="Last 4 digits of card" inputMode="numeric" value={cardLast4}
              onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              hint="We only keep the last 4 digits." />
            <div className="row">
              <Button type="submit" loading={placing} disabled={!itemsOk}>Place order</Button>
              <Button variant="secondary" to="/cart">Back to cart</Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
