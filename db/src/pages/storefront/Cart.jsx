import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api.js';
import { isStaff, useAuth } from '../../shared/auth.jsx';
import { Banner, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '../../shared/ui.jsx';
import { money } from './components.jsx';
import { readGuestCart, saveGuestCart, watchGuestCart } from './cartStore.js';
import './Storefront.css';

export default function Cart() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [guest, setGuest] = useState(readGuestCart);
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [rejected, setRejected] = useState([]);
  const [busy, setBusy] = useState(null);
  const [version, setVersion] = useState(0);
  const [drafts, setDrafts] = useState({});
  const attempted = useRef('');
  const signature = JSON.stringify(guest);
  useEffect(() => watchGuestCart(() => setGuest(readGuestCart())), []);
  useEffect(() => {
    if (authLoading) return;
    if (isStaff(user)) { setLoading(false); setCart(null); return; }
    let alive = true;
    setLoading(true); setError(null);
    async function load() {
      if (!user) return api.post('/api/cart/preview', { items: guest });
      const mergeKey = `${user.id}:${signature}`;
      if (guest.length && attempted.current !== mergeKey) {
        const result = await api.post('/api/cart/merge', { items: guest });
        attempted.current = mergeKey;
        if (alive) {
          setRejected(result.rejected);
          setNotice('Your visitor cart was checked against your saved cart. For matching products, the larger quantity was kept.');
          saveGuestCart(result.rejected.map(({ productId, quantity }) => ({ productId, quantity })));
        }
        return result;
      }
      return api.get('/api/cart');
    }
    load().then((data) => { if (alive) { setCart(data); setDrafts({}); } })
      .catch((err) => { if (alive) setError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user?.id, user?.role, authLoading, signature, version]);

  async function update(productId, removing = false) {
    const item = cart.items.find((entry) => entry.id === productId);
    const value = drafts[productId] ?? item.quantity;
    if (!removing && String(value).trim() === '') { setError(new Error('Enter a quantity, or use Remove to delete the item.')); return; }
    const quantity = removing ? 0 : Number(value);
    if (!Number.isInteger(quantity) || quantity < 0) { setError(new Error('Choose a whole-number quantity of zero or more.')); return; }
    if (quantity > item.stock && quantity !== 0) { setError(new Error(`Only ${item.stock} are in stock.`)); return; }
    setBusy(productId); setError(null); setNotice('');
    try {
      if (user) {
        const result = quantity === 0 ? await api.delete(`/api/cart?productId=${productId}`) : await api.patch('/api/cart', { productId, quantity });
        setCart(result); setDrafts({});
      } else {
        saveGuestCart(quantity === 0 ? guest.filter((entry) => entry.productId !== productId)
          : guest.map((entry) => entry.productId === productId ? { ...entry, quantity } : entry));
      }
      setNotice(quantity === 0 ? 'Item removed from your cart.' : 'Cart quantity updated.');
    } catch (err) { setError(err); }
    finally { setBusy(null); }
  }

  function removeMissing(productId) {
    try { saveGuestCart(guest.filter((entry) => entry.productId !== productId)); setError(null); }
    catch (err) { setError(err); }
  }

  if (authLoading) return <Spinner label="Checking your cart..." />;
  if (isStaff(user)) return <EmptyState title="Customer cart" action={<Button to="/staff">Go to staff dashboard</Button>}>Use a customer account to make a purchase.</EmptyState>;
  const items = cart?.items || [];
  const missing = cart?.missing || [];
  const blocked = items.some((item) => !item.available) || missing.length > 0;
  const unsaved = items.some((item) => drafts[item.id] !== undefined && String(drafts[item.id]) !== String(item.quantity));

  return <div className="sf-page">
    <PageHeader title="Your cart" subtitle={user ? 'Your saved items, with current prices and availability.' : 'Your cart is saved in this browser until you sign in.'} />
    {notice && <Banner kind="success">{notice}</Banner>}<ErrorBanner error={error} />
    {rejected.length > 0 && <Banner>Some visitor items could not be saved: {rejected.map((entry) => `Product ${entry.productId}: ${entry.reason}`).join(' ')}{' '}
      <button className="sf-text-button" type="button" onClick={() => { try { saveGuestCart([]); setRejected([]); } catch (err) { setError(err); } }}>Discard those visitor items</button></Banner>}
    {loading ? <Spinner label="Loading cart..." /> : error && !cart ? <Button variant="secondary" onClick={() => setVersion((value) => value + 1)}>Try again</Button>
      : !items.length && !missing.length ? <EmptyState title="Your cart is empty" action={<Button to="/shop">Browse the shop</Button>}>Find something you like and add it to your cart.</EmptyState>
        : <div className="sf-cart-layout">
          <section className="stack" aria-label="Cart items">
            {items.map((item) => <article className="card sf-cart-item" key={item.id}>
              <div className="sf-cart-item-details"><span className="sf-muted sf-small">{item.category} · {item.condition}</span>
                <h2><Link to={`/shop/${item.id}`}>{item.name}</Link></h2><p>{money(item.price)} each before discounts</p>
                {Number(item.discountAmount) > 0 && <p className="sf-offer">{item.discountName}: save {money(item.discountAmount)} on this line</p>}
                {!item.available && <p className="sf-error-text">{!item.isActive ? 'This product is no longer available. Remove it to continue.' : item.stock === 0 ? 'Out of stock. Remove this item to continue.' : `Only ${item.stock} are in stock. Reduce the quantity to continue.`}</p>}
              </div>
              <div className="sf-cart-item-actions">
                <label className="sf-quantity-label" htmlFor={`quantity-${item.id}`}>Quantity</label>
                <input id={`quantity-${item.id}`} type="number" min="0" step="1" value={drafts[item.id] ?? item.quantity} disabled={busy !== null} onChange={(event) => setDrafts({ ...drafts, [item.id]: event.target.value })} />
                <Button variant="secondary" loading={busy === item.id} disabled={busy !== null || String(drafts[item.id] ?? item.quantity) === String(item.quantity)} onClick={() => update(item.id)}>Update</Button>
                <button className="sf-text-button" type="button" disabled={busy !== null} onClick={() => update(item.id, true)}>Remove</button>
              </div>
              <strong className="sf-line-total">{money(item.lineTotal)}</strong>
            </article>)}
            {missing.map((item) => <Card key={item.productId} title="Unavailable product"><p>Product {item.productId} is no longer in the shop.</p><Button variant="secondary" onClick={() => removeMissing(item.productId)}>Remove unavailable item</Button></Card>)}
            <Link to="/shop">Continue shopping</Link>
          </section>
          <aside className="card sf-cart-summary" aria-label="Order summary"><h2>Order summary</h2>
            <dl className="sf-summary"><div><dt>Items</dt><dd>{cart.itemCount}</dd></div><div><dt>Subtotal</dt><dd>{money(cart.subtotal)}</dd></div><div><dt>Shipping</dt><dd>Free</dd></div></dl>
            <p className="sf-muted sf-small">Tax is calculated at checkout using your delivery address. Prices and stock are checked again before purchase.</p>
            {user ? <Button block disabled={blocked || unsaved || busy !== null || rejected.length > 0} onClick={() => navigate('/checkout')}>Continue to checkout</Button>
              : <Button to="/login" state={{ from: '/cart' }} block>Sign in to checkout</Button>}
            {blocked && <p className="sf-error-text sf-small">Update or remove unavailable items before continuing.</p>}
            {unsaved && <p className="sf-muted sf-small">Update your changed quantities before continuing.</p>}
          </aside>
        </div>}
  </div>;
}
