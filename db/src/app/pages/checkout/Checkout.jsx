// Checkout page. Written by Terry (Part 2).
// Added by the team: the cart comes from the same function as the cart page, so it shows
// the discounted prices, and the Place order button is disabled when an item is
// unavailable or short on stock.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { Button, Card, PageHeader, Spinner, EmptyState, ErrorBanner, Field, Table } from '../../../shared/ui.jsx';
import { BRAND_NAMES, cardLast4, cvvLength, detectBrand, digitsOnly, formatCardNumber, formatExpiry, validateCard } from '../../../shared/cardInput.js';
import './Checkout.css';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function Checkout() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [method, setMethod] = useState('credit');
  // The card details stay in the browser: only the last 4 digits are sent (see src/shared/cardInput.js).
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvv: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);

  // change one or more card fields and clear their error messages
  function update(patch) {
    setCard((old) => ({ ...old, ...patch }));
    setFieldErrors((old) => {
      const next = { ...old };
      Object.keys(patch).forEach((key) => delete next[key]);
      return next;
    });
  }

  useEffect(() => {
    api.get('/api/checkout').then(setData).catch(setLoadError);
  }, []);

  async function placeOrder(e) {
    e.preventDefault();
    setError(null);
    const problems = validateCard(card);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      setError(new Error('Check the card details and try again.'));
      return;
    }
    setPlacing(true);
    try {
      const r = await api.post('/api/checkout', { method, cardLast4: cardLast4(card.number) });
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
  const brand = detectBrand(card.number);

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
            <p className="pay-note">Card details are only used for this payment and are not saved. We keep only the last 4 digits.</p>
            <Field label="Name on card" autoComplete="cc-name" placeholder="Name as shown on the card" maxLength={100}
              value={card.name} error={fieldErrors.name}
              onChange={(e) => update({ name: e.target.value })} />
            <Field label="Card number" inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" maxLength={19}
              value={card.number} error={fieldErrors.number}
              hint={brand ? <span className="pay-brand">{BRAND_NAMES[brand]}</span> : undefined}
              onChange={(e) => {
                const number = formatCardNumber(e.target.value);
                // the security code length depends on the card (4 for American Express): drop extra digits
                update({ number, cvv: card.cvv.slice(0, cvvLength(detectBrand(number))) });
              }} />
            <div className="pay-grid">
              <Field label="Expiration date (MM/YY)" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={5}
                value={card.expiry} error={fieldErrors.expiry}
                onChange={(e) => update({ expiry: formatExpiry(e.target.value, card.expiry) })} />
              <Field label="Security code (CVV)" type="password" inputMode="numeric" autoComplete="cc-csc" placeholder="CVV"
                maxLength={cvvLength(brand)} value={card.cvv} error={fieldErrors.cvv}
                onChange={(e) => update({ cvv: digitsOnly(e.target.value).slice(0, cvvLength(brand)) })} />
            </div>
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
