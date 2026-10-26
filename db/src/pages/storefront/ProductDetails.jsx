import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../shared/api.js';
import { useAuth } from '../../shared/auth.jsx';
import { Banner, Button, Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner } from '../../shared/ui.jsx';
import { useLoad, ProductVisual, Price, Rating, Pagination, date } from './components.jsx';
import { addToCart } from './cartStore.js';
import './Storefront.css';

export default function ProductDetails() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [quantity, setQuantity] = useState('1');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ rating: '', comment: '', transactionId: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    setQuantity('1'); setPage(1); setForm({ rating: '', comment: '', transactionId: '' }); setNotice(''); setError(null);
  }, [id]);
  const product = useLoad(() => api.get(`/api/products/${id}`), [id]);
  const reviews = useLoad(() => api.get('/api/reviews', { productId: id, page }), [id, page]);
  const purchases = useLoad(() => user?.role === 'customer' ? api.get('/api/account/purchases', { productId: id }) : Promise.resolve({ purchases: [] }), [id, user?.id, user?.role]);

  async function add() {
    setBusy('cart'); setError(null); setNotice('');
    try { await addToCart(product.data.product, Number(quantity), user); setNotice('Added to your cart.'); }
    catch (err) { setError(err); }
    finally { setBusy(''); }
  }

  async function submit(event) {
    event.preventDefault(); setBusy('review'); setError(null); setNotice('');
    try {
      await api.post('/api/reviews', { productId: Number(id), rating: Number(form.rating), comment: form.comment, transactionId: form.transactionId ? Number(form.transactionId) : null });
      setForm({ rating: '', comment: '', transactionId: '' }); setNotice('Your review was posted.'); setPage(1); reviews.reload(); product.reload();
    } catch (err) { setError(err); }
    finally { setBusy(''); }
  }

  if (product.loading) return <Spinner label="Loading product..." />;
  if (product.error) return <><Link to="/shop">Back to shop</Link><ErrorBanner error={product.error} /><Button variant="secondary" onClick={product.reload}>Try again</Button></>;
  const item = product.data.product;

  return <div className="sf-page">
    <Link className="sf-back-link" to="/shop">Back to shop</Link>
    {notice && <Banner kind="success">{notice} {notice.startsWith('Added') && <Link to="/cart">View cart</Link>}</Banner>}
    <ErrorBanner error={error} />
    <div className="sf-detail-layout">
      <ProductVisual product={item} large />
      <section className="sf-product-info">
        <span className="tag">{item.category}</span><PageHeader title={item.name} />
        <Rating value={item.rating} count={item.reviewCount} /><Price product={item} />
        {item.discountName && <p className="sf-offer">{item.discountName}</p>}
        <dl className="sf-facts"><div><dt>Condition</dt><dd>{item.condition}</dd></div><div><dt>SKU</dt><dd>{item.sku}</dd></div><div><dt>Availability</dt><dd>{item.stock > 0 ? `${item.stock} in stock` : 'Out of stock'}</dd></div></dl>
        <p className="sf-description">{item.description || 'No additional description is available.'}</p>
        <div className="sf-buy-row"><Field label="Quantity" type="number" min="1" max={Math.max(item.stock, 1)} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <Button onClick={add} loading={busy === 'cart'} disabled={authLoading || !!busy || item.stock === 0 || !!user && user.role !== 'customer'}>Add to cart</Button></div>
        {!user && !authLoading && <p className="sf-muted sf-small">You can keep a cart while browsing. Sign in when you are ready to check out.</p>}
        {user && user.role !== 'customer' && <p className="sf-muted">Use a customer account to shop or write a review.</p>}
      </section>
    </div>
    <section className="sf-review-section" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Customer reviews</h2>
      <div className="sf-review-layout">
        <div>
          {reviews.loading ? <Spinner label="Loading reviews..." /> : reviews.error ? <><ErrorBanner error={reviews.error} /><Button variant="secondary" onClick={reviews.reload}>Retry reviews</Button></>
            : reviews.data?.reviews.length ? <div className="stack">{reviews.data.reviews.map((review) => <article key={review.id} className="card sf-review">
              <div className="sf-section-top"><strong>{review.author}</strong><span className="sf-muted sf-small">{date(review.date)}</span></div>
              <p aria-label={`${review.rating} out of 5 stars`} className="sf-review-stars">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</p>
              {review.verified && <span className="tag">Verified purchase</span>}
              {review.comment && <p className="sf-review-comment">{review.comment}</p>}
            </article>)}<Pagination page={page} pageSize={10} total={reviews.data.total} change={setPage} /></div>
              : <EmptyState title="No reviews yet">Be the first to share your thoughts.</EmptyState>}
        </div>
        <Card title="Write a review">
          {authLoading ? <Spinner /> : user?.role === 'customer' ? <form onSubmit={submit}>
            <Field label="Rating" as="select" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} required><option value="">Choose a rating</option>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}</Field>
            <Field label="Review (optional)" as="textarea" rows={4} maxLength={1000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            <Field label="Link a purchase (optional)" as="select" value={form.transactionId} onChange={(e) => setForm({ ...form, transactionId: e.target.value })} disabled={purchases.loading || !!purchases.error}>
              <option value="">No purchase link</option>{purchases.data?.purchases.map((purchase) => <option key={purchase.id} value={purchase.id}>Order {purchase.id} · {date(purchase.date)}</option>)}
            </Field>
            <ErrorBanner error={purchases.error} />
            <Button type="submit" loading={busy === 'review'} disabled={!!busy}>Post review</Button>
          </form> : <p>{user ? 'Reviews are available to customer accounts.' : <><Link to="/login" state={{ from: `/shop/${id}` }}>Sign in</Link> to leave a review.</>}</p>}
        </Card>
      </div>
    </section>
  </div>;
}
