/*
   Shared components. Import what you need:

     import { Button, Card, Table, Spinner, EmptyState, ErrorBanner, Field, PageHeader, ProductCard, Chip } from '../../shared/ui.jsx';

   Every screen should show: <Spinner/> while loading, <EmptyState/> when there
   is nothing to show, and <ErrorBanner/> when a call fails.
*/
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { coverGradient } from './cover.js';

const VARIANTS = { secondary: 'btn-secondary', danger: 'btn-danger', ghost: 'btn-ghost', accent: 'btn-accent', outline: 'btn-outline' };

/* variant: primary (default) | secondary | accent | outline | ghost | danger.   size: 'lg' for hero buttons. */
export function Button({ variant = 'primary', size, loading = false, block = false, disabled, children, to, className = '', ...rest }) {
  const classes = ['btn', VARIANTS[variant], size === 'lg' && 'btn-lg', block && 'btn-block', className].filter(Boolean).join(' ');
  if (to) return <Link to={to} className={classes} {...rest}>{children}</Link>;
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? 'Please wait...' : children}
    </button>
  );
}

/*
  `reveal` is for a card that opens when the manager presses a button on a row (an edit form, a remove question):
  the page scrolls up to it if it opened above or below the part of the page that is on screen. It scrolls again
  when the title changes (the same form opened for another row). Leave it off for cards that are always there.
*/
function useReveal(on, watch) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const { top, bottom } = el.getBoundingClientRect();
    const high = window.innerHeight;
    const topShown = top >= 0 && top <= high - 120;
    if (topShown && (bottom <= high || bottom - top > high)) return;   // on screen (or taller than the screen: its top is enough)
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // off screen: bring its top to the top of the page; only its lower part hidden: scroll just enough to show it all
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: topShown ? 'nearest' : 'start' });
  }, [on, watch]);
  return ref;
}

// The same thing for something that is not a card (an inline form or a confirm question inside a card).
export function Reveal({ children, watch }) {
  const ref = useReveal(true, watch);
  return <div ref={ref} style={{ scrollMarginTop: 16 }}>{children}</div>;
}

export function Card({ title, to, children, className = '', reveal = false }) {
  const ref = useReveal(reveal, title);
  const body = (
    <>
      {title && <h2>{title}</h2>}
      {children}
    </>
  );
  if (to) return <Link to={to} className={`card ${className}`}>{body}</Link>;
  return <section ref={ref} style={reveal ? { scrollMarginTop: 16 } : undefined} className={`card ${className}`}>{body}</section>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading...' }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ error, children }) {
  const message = children || (error && error.message);
  if (!message) return null;
  return <div className="banner banner-error" role="alert">{message}</div>;
}

export function Banner({ kind = 'info', children }) {
  return <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

/* A labelled input with optional hint and error text. Pass any <input> props. */
export function Field({ label, id, hint, error, as = 'input', children, ...inputProps }) {
  const inputId = id || `f-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined;
  const Tag = as;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <Tag id={inputId} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...inputProps}>
        {children}
      </Tag>
      {hint && <div className="hint" id={`${inputId}-hint`}>{hint}</div>}
      {error && <div className="error" id={`${inputId}-error`}>{error}</div>}
    </div>
  );
}

/*
   <Table
     columns={[{ key: 'name', label: 'Product' }, { key: 'price', label: 'Price', numeric: true, render: (row) => `$${row.price}` }]}
     rows={items}
     rowKey="id"
     empty="No products found."
   />
*/
export function Table({ columns, rows, rowKey = 'id', empty = 'No rows to show.' }) {
  if (!rows || rows.length === 0) return <div className="table-wrap"><EmptyState title={empty} /></div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.numeric ? 'num' : undefined} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row[rowKey] ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/*
   A product tile for lists and grids. Put <ProductCard/>s inside <div className="product-grid">.

     <ProductCard to={`/shop/${p.id}`} title={p.name} platform={p.platform} price="$59.99" seed={p.id} image={p.image}>
       <Button onClick={() => addToCart(p.id)}>Add to cart</Button>
     </ProductCard>

   `image` is optional; without it the cover is a generated gradient based on `seed`. `children` is the
   action area (usually the add-to-cart button). `wasPrice` shows a struck-through old price.
*/
export function ProductCard({ to, title, platform, price, wasPrice, image, seed, children }) {
  const cover = image ? { backgroundImage: `url(${image})` } : { backgroundImage: coverGradient(seed ?? title) };
  return (
    <article className="product-card">
      <Link to={to} aria-label={title}>
        <div className="product-cover" style={cover}>
          {platform && <span className="platform-tag">{platform}</span>}
        </div>
      </Link>
      <div className="product-body">
        <Link to={to}><div className="product-title">{title}</div></Link>
        <div className="product-foot">
          <span className="price">{price}{wasPrice && <s className="price-was">{wasPrice}</s>}</span>
          {children}
        </div>
      </div>
    </article>
  );
}

/* A filter pill, e.g. one per platform. `active` shows which one is selected. */
export function Chip({ active = false, children, ...rest }) {
  return <button type="button" className="chip" aria-pressed={active} {...rest}>{children}</button>;
}

/*
   The confirm step before removing something. Show it next to the thing being removed:

     {removing === item.id && (
       <ConfirmRemove
         label="Remove this product?"
         message="It will disappear from the shop and the inventory list."
         busy={busy}
         onConfirm={() => remove(item.id)}
         onCancel={() => setRemoving(null)} />
     )}

   Escape cancels. While busy is true both buttons are disabled, so a double click
   cannot send two requests. The server does the real work (lib/softDelete.js).
*/
export function ConfirmRemove({ label = 'Remove this item?', message, confirmText = 'Confirm removal', onConfirm, onCancel, busy = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy && onCancel) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="confirm-remove" role="group" aria-label="Confirm removal">
      <p><strong>{label}</strong></p>
      {message && <p className="card-muted">{message}</p>}
      <div className="confirm-remove-actions">
        <Button variant="danger" loading={busy} onClick={onConfirm}>{confirmText}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
