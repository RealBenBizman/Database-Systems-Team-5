import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui.jsx';

export const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
export const date = (value) => value ? new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

export function useLoad(loader, dependencies = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((old) => ({ ...old, loading: true, error: null }));
    Promise.resolve().then(loader)
      .then((data) => { if (alive) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (alive) setState((old) => ({ ...old, loading: false, error })); });
    return () => { alive = false; };
  }, [...dependencies, version]);
  return { ...state, reload: () => setVersion((value) => value + 1) };
}

export function ProductVisual({ product, large = false }) {
  return <div className={`sf-product-art ${large ? 'sf-product-art-large' : ''}`} aria-hidden="true">
    <span className="sf-art-category">{product.category}</span>
    <svg width="100" height="78" viewBox="0 0 100 78" fill="none">
      <rect x="13" y="10" width="74" height="49" rx="7" stroke="currentColor" strokeWidth="3" />
      <path d="M33 69H67M50 59V69M30 33H44M37 26V40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="65" cy="29" r="3" fill="currentColor" /><circle cx="73" cy="38" r="3" fill="currentColor" />
    </svg>
    <span className="sf-art-condition">{product.condition}</span>
  </div>;
}

export function Price({ product }) {
  return <span className="sf-price"><strong>{money(product.effectivePrice)}</strong>
    {Number(product.effectivePrice) < Number(product.price) && <del>{money(product.price)}</del>}
  </span>;
}

export function Rating({ value, count }) {
  return <span className="sf-rating">{count ? <><span aria-hidden="true">★</span> {Number(value).toFixed(1)} <span className="sf-muted">({count} {count === 1 ? 'review' : 'reviews'})</span></> : <span className="sf-muted">No reviews yet</span>}</span>;
}

export function ProductCard({ product, add, busy, disabled }) {
  return <article className="card sf-product-card">
    <Link to={`/shop/${product.id}`} className="sf-product-link"><ProductVisual product={product} />
      <span className="sf-muted sf-small">{product.category}</span><h2>{product.name}</h2></Link>
    <Rating value={product.rating} count={product.reviewCount} />
    <Price product={product} />
    <span className={`sf-stock ${product.stock === 0 ? 'sf-muted' : ''}`}>{product.stock > 0 ? 'In stock' : 'Out of stock'}</span>
    <Button onClick={() => add(product)} loading={busy} disabled={disabled || product.stock === 0} aria-label={`Add ${product.name} to cart`}>Add to cart</Button>
  </article>;
}

export function Pagination({ page, pageSize, total, change }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1 && page === 1) return null;
  return <nav className="sf-pagination" aria-label="Pagination">
    <Button variant="secondary" disabled={page <= 1} onClick={() => change(page - 1)}>Previous</Button>
    <span>Page {page} of {pages}</span>
    <Button variant="secondary" disabled={page >= pages} onClick={() => change(page + 1)}>Next</Button>
  </nav>;
}
