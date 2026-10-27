import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.js';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorBanner, Field, Table } from '../../shared/ui.jsx';

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

  const cartTotal = data.items.reduce((sum, i) => sum + Number(i.Line_total), 0);
  const a = data.address;

  return (
    <>
      <PageHeader title="Checkout" subtitle="Review your order and pay." />
      <ErrorBanner error={error} />

      <Card title="Items">
        <Table rowKey="Product_id" rows={data.items} columns={[
          { key: 'Product_name', label: 'Product' },
          { key: 'Quantity', label: 'Qty', numeric: true },
          { key: 'Sell_price', label: 'Price', numeric: true, render: (r) => money(r.Sell_price) },
          { key: 'Line_total', label: 'Total', numeric: true, render: (r) => money(r.Line_total) },
        ]} />
        <p>Cart subtotal: <strong>{money(cartTotal)}</strong></p>
        <p className="card-muted">Discounts and tax are applied when you place the order.</p>
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
            <Field label="Last 4 digits of card" inputMode="numeric" maxLength={4} value={cardLast4}
              onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ''))}
              hint="We only keep the last 4 digits." />
            <div className="row">
              <Button type="submit" loading={placing}>Place order</Button>
              <Button variant="secondary" to="/cart">Back to cart</Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}